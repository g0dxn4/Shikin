import {
  assertOrdinaryCorrection,
  assertSplitReplacementAllowed,
  type ConsumptionEvidence,
  type CorrectionTransaction,
} from '@shikin/finance-core/corrections'
import { query, withTransaction } from '@/lib/database'
import type { TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import type { TransactionSplitWithCategory } from '@/types/database'
import {
  activeFrontendEvidence,
  assertFrontendActivePaymentCapacity,
  auditFrontendCorrection,
  readFrontendConsumptionEvidence,
} from '@/lib/transaction-evidence'

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
