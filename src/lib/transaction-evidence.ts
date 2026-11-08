import {
  assertBucketSourcePreserved,
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
import type { ClassificationTypeRevision } from '@shikin/finance-core'
import type { TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'

export async function readFrontendConsumptionEvidence(
  tx: TransactionClient
): Promise<ConsumptionEvidence> {
  const [transactions, splits, classifications, typeRevisions] = await Promise.all([
    tx.query<CorrectionTransaction>('SELECT * FROM transactions'),
    tx.query<CorrectionSplit>('SELECT * FROM transaction_splits'),
    tx.query<ConsumptionClassification>('SELECT * FROM transaction_consumption_classifications'),
    tx.query<ClassificationTypeRevision>('SELECT * FROM classification_type_revisions'),
  ])
  return { transactions, splits, classifications, typeRevisions }
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

// These schedules intentionally differ: concurrent corrections versus sequential card actions.
// Preserve request order and rejection precedence rather than sharing a scheduling flag.
export async function readFrontendPaymentEvidence(tx: TransactionClient): Promise<PaymentEvidence> {
  const [accounts, transactions, splits, classifications, typeRevisions, activeLinks] =
    await Promise.all([
      tx.query<PaymentAccount>(
        'SELECT id, type, currency, account_mode, is_archived FROM accounts'
      ),
      tx.query<PaymentTransaction>('SELECT * FROM transactions'),
      tx.query<CorrectionSplit>('SELECT * FROM transaction_splits'),
      tx.query<ConsumptionClassification>('SELECT * FROM transaction_consumption_classifications'),
      tx.query<ClassificationTypeRevision>('SELECT * FROM classification_type_revisions'),
      tx.query<ActivePaymentLink>(
        'SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL'
      ),
    ])
  return { accounts, transactions, splits, classifications, typeRevisions, activeLinks }
}

export async function readFrontendPaymentEvidenceSequential(
  tx: TransactionClient
): Promise<PaymentEvidence> {
  const accounts = await tx.query<PaymentAccount>(
    'SELECT id, type, currency, account_mode, is_archived FROM accounts'
  )
  const transactions = await tx.query<PaymentTransaction>('SELECT * FROM transactions')
  const splits = await tx.query<CorrectionSplit>('SELECT * FROM transaction_splits')
  const classifications = await tx.query<ConsumptionClassification>(
    'SELECT * FROM transaction_consumption_classifications'
  )
  const typeRevisions = await tx.query<ClassificationTypeRevision>(
    'SELECT * FROM classification_type_revisions'
  )
  const activeLinks = await tx.query<ActivePaymentLink>(
    'SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL'
  )
  return { accounts, transactions, splits, classifications, typeRevisions, activeLinks }
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
