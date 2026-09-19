import {
  assertBucketSourcePreserved,
  assertOrdinaryCorrection,
  assertSplitReplacementAllowed,
  assertEvidenceMutationAllowed,
  financialFieldsChanged,
  validateConsumptionEvidence,
  type ConsumptionEvidence,
  type ConsumptionClassification,
  type CorrectionSplit,
  type CorrectionTransaction,
} from '@shikin/finance-core/corrections'
import {
  assertPaymentLinkCapacity,
  resolvePaymentEvidence,
  type ActivePaymentLink,
  type PaymentAccount,
  type PaymentEvidence,
  type PaymentTransaction,
} from '@shikin/finance-core/payments'
import { query, withTransaction } from '@/lib/database'
import type { TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import type { TransactionSplitWithCategory } from '@/types/database'

export interface SplitInput {
  categoryId: string
  subcategoryId?: string | null
  amount: number // centavos
  notes?: string | null
}

/**
 * Create splits for a transaction.
 * Validates that split amounts sum exactly to the transaction total.
 */
export async function createSplits(
  transactionId: string,
  splits: SplitInput[],
  transactionAmountCentavos: number,
  tx?: TransactionClient
): Promise<void> {
  const splitsTotal = splits.reduce((sum, split) => sum + split.amount, 0)
  if (
    !splits.length ||
    splits.some((split) => !Number.isSafeInteger(split.amount) || split.amount <= 0) ||
    !Number.isSafeInteger(splitsTotal) ||
    splitsTotal !== transactionAmountCentavos
  )
    throw new Error('Positive safe split amounts must equal the transaction total.')
  if (!tx)
    return withTransaction((client) =>
      createSplits(transactionId, splits, transactionAmountCentavos, client)
    )
  const evidence = await readFrontendConsumptionEvidence(tx)
  const owner = evidence.transactions.find((row) => row.id === transactionId)
  if (!owner || owner.amount !== transactionAmountCentavos)
    throw new Error('Split owner or amount changed.')
  assertOrdinaryCorrection(owner)
  await assertSplitWorkflow(tx, owner, evidence)
  for (const split of splits) {
    if (!split.categoryId.trim()) throw new Error('A split category is required.')
    const category = await tx.query<{ type: string }>('SELECT type FROM categories WHERE id = ?', [
      split.categoryId,
    ])
    if (!category.length) throw new Error('Category not found.')
    if (category[0].type !== owner.type)
      throw new Error('Category direction must match the transaction direction.')
    if (
      split.subcategoryId &&
      !(
        await tx.query('SELECT id FROM subcategories WHERE id = ? AND category_id = ?', [
          split.subcategoryId,
          split.categoryId,
        ])
      ).length
    )
      throw new Error('Subcategory must belong to the selected category.')
  }
  const before = evidence.splits.filter((split) => split.transaction_id === transactionId)
  await assertFrontendActivePaymentCapacity(tx, transactionId, {
    splits: [
      ...evidence.splits.filter((split) => split.transaction_id !== transactionId),
      ...splits.map((split, index) => ({
        id: `payment-preview-${index}`,
        transaction_id: transactionId,
        category_id: split.categoryId,
        amount: split.amount,
      })),
    ],
  })
  await tx.execute('DELETE FROM transaction_splits WHERE transaction_id = ?', [transactionId])

  for (const split of splits) {
    const id = generateId()
    await tx.execute(
      `INSERT INTO transaction_splits (id, transaction_id, category_id, subcategory_id, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        transactionId,
        split.categoryId,
        split.subcategoryId ?? null,
        split.amount,
        split.notes ?? null,
      ]
    )
  }
  await auditFrontendCorrection(tx, transactionId, 'replace-splits', before, splits)
}

/**
 * Get all splits for a transaction with joined category names.
 */
export async function getSplits(transactionId: string): Promise<TransactionSplitWithCategory[]> {
  return query<TransactionSplitWithCategory>(
    `SELECT ts.*, c.name as category_name, c.color as category_color, sc.name as subcategory_name
     FROM transaction_splits ts
     LEFT JOIN categories c ON ts.category_id = c.id
     LEFT JOIN subcategories sc ON ts.subcategory_id = sc.id
     WHERE ts.transaction_id = ?
     ORDER BY ts.amount DESC`,
    [transactionId]
  )
}

/**
 * Delete all splits for a transaction.
 */
export async function deleteSplits(transactionId: string, tx?: TransactionClient): Promise<void> {
  if (!tx) return withTransaction((client) => deleteSplits(transactionId, client))
  const evidence = await readFrontendConsumptionEvidence(tx)
  const owner = evidence.transactions.find((row) => row.id === transactionId)
  if (!owner) throw new Error('Transaction not found.')
  assertOrdinaryCorrection(owner)
  await assertSplitWorkflow(tx, owner, evidence)
  await assertFrontendActivePaymentCapacity(tx, transactionId, {
    splits: evidence.splits.filter((split) => split.transaction_id !== transactionId),
  })
  await tx.execute('DELETE FROM transaction_splits WHERE transaction_id = ?', [transactionId])
  await auditFrontendCorrection(
    tx,
    transactionId,
    'clear-splits',
    evidence.splits.filter((split) => split.transaction_id === transactionId),
    []
  )
}

/**
 * Check if a transaction has splits.
 */
export async function isSplit(transactionId: string): Promise<boolean> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM transaction_splits WHERE transaction_id = ?',
    [transactionId]
  )
  return rows.length > 0 && rows[0].count > 0
}

/**
 * Get split-category membership for all transactions in one query.
 */
export async function getSplitCategoryMembership(): Promise<Map<string, Set<string>>> {
  const rows = await query<{ transaction_id: string; category_id: string | null }>(
    'SELECT transaction_id, category_id FROM transaction_splits'
  )
  const membership = new Map<string, Set<string>>()
  for (const row of rows) {
    const categories = membership.get(row.transaction_id) ?? new Set<string>()
    if (row.category_id) categories.add(row.category_id)
    membership.set(row.transaction_id, categories)
  }
  return membership
}

/**
 * Get all transaction IDs that have splits (for batch checking).
 */
export async function getSplitTransactionIds(): Promise<Set<string>> {
  const membership = await getSplitCategoryMembership()
  return new Set(membership.keys())
}

export async function readFrontendConsumptionEvidence(
  tx: TransactionClient
): Promise<ConsumptionEvidence> {
  const [transactions, splits, classifications] = await Promise.all([
    tx.query<CorrectionTransaction>('SELECT * FROM transactions'),
    tx.query<CorrectionSplit>('SELECT * FROM transaction_splits'),
    tx.query<ConsumptionClassification>('SELECT * FROM transaction_consumption_classifications'),
  ])
  return { transactions, splits, classifications }
}
export async function activeFrontendEvidence(tx: TransactionClient, id: string) {
  const payments = await tx.query(
    'SELECT id FROM card_statement_payment_links WHERE transaction_id = ? AND voided_at IS NULL LIMIT 1',
    [id]
  )
  const buckets = await tx.query<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM cashflow_bucket_allocations WHERE transaction_id = ?',
    [id]
  )
  return { payments: payments.length > 0, buckets: (buckets[0]?.total ?? 0) > 0 }
}
async function assertSplitWorkflow(
  tx: TransactionClient,
  owner: CorrectionTransaction,
  evidence: ConsumptionEvidence
) {
  if (
    (await tx.query('SELECT id FROM receivables WHERE matched_transaction_id = ?', [owner.id]))
      .length ||
    (
      await tx.query('SELECT id FROM account_reconciliations WHERE adjustment_transaction_id = ?', [
        owner.id,
      ])
    ).length
  )
    throw new Error('Protected financial provenance requires its dedicated workflow.')
  const active = await activeFrontendEvidence(tx, owner.id)
  assertSplitReplacementAllowed(owner.id, evidence, false, active.buckets)
}

export async function readFrontendPaymentEvidence(tx: TransactionClient): Promise<PaymentEvidence> {
  const [accounts, transactions, splits, classifications, activeLinks] = await Promise.all([
    tx.query<PaymentAccount>('SELECT id, type, currency, account_mode, is_archived FROM accounts'),
    tx.query<PaymentTransaction>('SELECT * FROM transactions'),
    tx.query<CorrectionSplit>('SELECT * FROM transaction_splits'),
    tx.query<ConsumptionClassification>('SELECT * FROM transaction_consumption_classifications'),
    tx.query<ActivePaymentLink>(
      'SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL'
    ),
  ])
  return { accounts, transactions, splits, classifications, activeLinks }
}

export async function assertFrontendActivePaymentCapacity(
  tx: TransactionClient,
  transactionId: string,
  overrides: Partial<Pick<PaymentEvidence, 'transactions' | 'splits' | 'classifications'>> = {}
) {
  const current = await readFrontendPaymentEvidence(tx)
  const currentRow = current.transactions.find((row) => row.id === transactionId)
  const canonicalIds = new Set([transactionId])
  if (currentRow?.matched_transaction_id) canonicalIds.add(currentRow.matched_transaction_id)
  for (const row of current.transactions)
    if (row.matched_transaction_id === transactionId) canonicalIds.add(row.id)
  const relevant = (
    await tx.query<{ transaction_id: string; account_id: string }>(
      `SELECT DISTINCT l.transaction_id, s.account_id
       FROM card_statement_payment_links l
       JOIN credit_card_statements s ON s.id = l.statement_id
       WHERE l.voided_at IS NULL`
    )
  ).filter((item) => canonicalIds.has(item.transaction_id))
  if (!relevant.length) return
  const evidence = { ...current, ...overrides }
  for (const item of relevant) {
    try {
      const resolved = resolvePaymentEvidence({
        transactionId: item.transaction_id,
        cardAccountId: item.account_id,
        explicitRepaymentConfirmation: true,
        evidence,
      })
      assertPaymentLinkCapacity({ resolved, activeLinks: evidence.activeLinks })
    } catch (error) {
      throw Object.assign(
        new Error(
          `Unlink active payments before invalidating their evidence or eligible capacity: ${error instanceof Error ? error.message : String(error)}`
        ),
        { cause: error }
      )
    }
  }
}

export async function guardFrontendEvidence(
  tx: TransactionClient,
  before: CorrectionTransaction,
  after: CorrectionTransaction | null
) {
  const active = await activeFrontendEvidence(tx, before.id)
  const changed = !after || financialFieldsChanged(before, after)
  if (changed) {
    const paymentEvidence = await readFrontendPaymentEvidence(tx)
    await assertFrontendActivePaymentCapacity(tx, before.id, {
      transactions: after
        ? paymentEvidence.transactions.map((row) => (row.id === before.id ? after : row))
        : paymentEvidence.transactions.filter((row) => row.id !== before.id),
    })
  }
  assertEvidenceMutationAllowed(changed, false, false)
  if (changed && active.buckets)
    assertBucketSourcePreserved(
      before,
      after,
      await tx.query<{ currency: string; total: number }>(
        'SELECT currency, SUM(amount) AS total FROM cashflow_bucket_allocations WHERE transaction_id = ? GROUP BY currency',
        [before.id]
      )
    )
  if (!changed) return
  const evidence = await readFrontendConsumptionEvidence(tx)
  if (!after && evidence.classifications.some((item) => item.transaction_id === before.id))
    throw new Error('Clear classifications before deleting this transaction.')
  if (after)
    validateConsumptionEvidence({
      ...evidence,
      transactions: evidence.transactions.map((row) => (row.id === before.id ? after : row)),
    })
}
export async function auditFrontendCorrection(
  tx: TransactionClient,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
  auditSource = 'frontend-transaction-correction',
  auditNote?: string
) {
  await tx.execute(
    'INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      generateId(),
      'transaction',
      id,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      auditSource,
      auditNote ?? null,
      new Date().toISOString(),
    ]
  )
}
