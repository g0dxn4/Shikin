import {
  applyMetadataCorrection,
  assertBucketSourcePreserved,
  assertEvidenceMutationAllowed,
  assertSplitReplacementAllowed,
  financialFieldsChanged,
  validateConsumptionEvidence,
  type ConsumptionEvidence,
  type ConsumptionClassification,
  type CorrectionTransaction,
  type CorrectionSplit,
  type MetadataCorrection,
} from '@shikin/finance-core/corrections'
import {
  query,
  execute,
  transaction,
  generateId,
  writeAuditLog,
  z,
  type ToolDefinition,
} from './tools/shared.js'
import { consumptionRoles } from '@shikin/finance-core/corrections'

export function readConsumptionEvidence(): ConsumptionEvidence {
  return {
    transactions: query<CorrectionTransaction>('SELECT * FROM transactions'),
    splits: query<CorrectionSplit>('SELECT * FROM transaction_splits'),
    classifications: query<ConsumptionClassification>(
      'SELECT * FROM transaction_consumption_classifications'
    ),
  }
}
export function activeTransactionEvidence(id: string) {
  return {
    payments:
      query<{ id: string }>(
        'SELECT id FROM card_statement_payment_links WHERE transaction_id = $1 AND voided_at IS NULL LIMIT 1',
        [id]
      ).length > 0,
    buckets:
      query<{ total: number }>(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM cashflow_bucket_allocations WHERE transaction_id = $1',
        [id]
      )[0]?.total > 0,
  }
}
export function guardTransactionEvidence(
  before: CorrectionTransaction,
  after: CorrectionTransaction | null
) {
  const active = activeTransactionEvidence(before.id)
  const changed = !after || financialFieldsChanged(before, after)
  assertEvidenceMutationAllowed(changed, active.payments, false)
  if (changed && active.buckets)
    assertBucketSourcePreserved(
      before,
      after,
      query<{ currency: string; total: number }>(
        'SELECT currency, SUM(amount) AS total FROM cashflow_bucket_allocations WHERE transaction_id = $1 GROUP BY currency',
        [before.id]
      )
    )
  const evidence = readConsumptionEvidence()
  if (!after && evidence.classifications.some((item) => item.transaction_id === before.id))
    throw new Error('Clear classifications before deleting or matching this transaction.')
  if (after && financialFieldsChanged(before, after))
    validateConsumptionEvidence({
      ...evidence,
      transactions: evidence.transactions.map((row) => (row.id === before.id ? after : row)),
    })
}
function assertCorrectionReferences(id: string): void {
  if (
    query('SELECT id FROM receivables WHERE matched_transaction_id = $1', [id]).length ||
    query('SELECT id FROM account_reconciliations WHERE adjustment_transaction_id = $1', [id])
      .length
  )
    throw new Error('Protected financial provenance requires its dedicated workflow.')
}
function validateCategory(
  categoryId: string | null | undefined,
  subcategoryId: string | null | undefined
) {
  if (categoryId && !query('SELECT id FROM categories WHERE id = $1', [categoryId]).length)
    throw new Error('Category not found.')
  if (
    subcategoryId &&
    !query('SELECT id FROM subcategories WHERE id = $1 AND category_id = $2', [
      subcategoryId,
      categoryId ?? null,
    ]).length
  )
    throw new Error('Subcategory must belong to the selected category.')
}
const splitSchema = z
  .object({
    categoryId: z.string().nullable(),
    subcategoryId: z.string().nullable().optional(),
    amountCentavos: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict()
export const correctTransactionMetadata: ToolDefinition = {
  name: 'correct-transaction-metadata',
  description:
    'Audited metadata-only correction, including finalized ordinary rows. Null explicitly clears optional fields; omission preserves them. Optional splits explicitly replace allocations; classified allocations must be cleared first. Never changes original source, note, import identity or balances.',
  schema: z
    .object({
      transactionId: z.string(),
      description: z.string().trim().min(1).max(200).optional(),
      clearCategory: z.boolean().optional(),
      clearSubcategory: z.boolean().optional(),
      clearNotes: z.boolean().optional(),
      categoryId: z.string().nullable().optional(),
      subcategoryId: z.string().nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
      reportingTreatment: z.enum(['normal', 'exclude_from_cashflow']).optional(),
      splits: z.array(splitSchema).min(2).optional(),
      auditSource: z.string().max(120).optional(),
      auditNote: z.string().max(1000).optional(),
      dryRun: z.boolean().default(false),
    })
    .strict(),
  effects: { writesTo: ['transactions', 'transaction_splits', 'audit_log'] },
  execute: async (input) => correctMetadataMutation(input),
}
export function correctMetadataMutation(input: z.infer<typeof correctTransactionMetadata.schema>) {
  return transaction(() => {
    const before = query<CorrectionTransaction>('SELECT * FROM transactions WHERE id = $1', [
      input.transactionId,
    ])[0]
    if (!before) throw new Error('Transaction not found.')
    assertCorrectionReferences(before.id)
    const oldSplits = query<CorrectionSplit>(
      'SELECT * FROM transaction_splits WHERE transaction_id = $1',
      [before.id]
    )
    for (const [clear, value] of [
      [input.clearCategory, input.categoryId],
      [input.clearSubcategory, input.subcategoryId],
      [input.clearNotes, input.notes],
    ])
      if (clear && value !== undefined && value !== null)
        throw new Error('Clear flags cannot be combined with a value for the same field.')
    const patch: MetadataCorrection = {
      description: input.description,
      category_id: input.clearCategory ? null : input.categoryId,
      subcategory_id: input.clearSubcategory ? null : input.subcategoryId,
      notes: input.clearNotes ? null : input.notes,
      reporting_treatment: input.reportingTreatment,
    }
    const after = applyMetadataCorrection(
      before,
      patch,
      oldSplits.length > 0,
      input.splits !== undefined
    )
    validateCategory(after.category_id, after.subcategory_id)
    guardTransactionEvidence(before, after)
    if (input.splits) {
      const active = activeTransactionEvidence(before.id)
      assertSplitReplacementAllowed(
        before.id,
        readConsumptionEvidence(),
        active.payments,
        active.buckets
      )
      const total = input.splits.reduce(
        (sum: number, split: { amountCentavos: number }) => sum + split.amountCentavos,
        0
      )
      if (!Number.isSafeInteger(total) || total !== before.amount)
        throw new Error('Split amounts must equal the transaction amount.')
      for (const split of input.splits) validateCategory(split.categoryId, split.subcategoryId)
    }
    if (input.dryRun)
      return { success: true, dryRun: true, before, after, splits: input.splits ?? oldSplits }
    execute(
      "UPDATE transactions SET description = $1, category_id = $2, subcategory_id = $3, notes = $4, reporting_treatment = $5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $6",
      [
        after.description,
        after.category_id ?? null,
        after.subcategory_id ?? null,
        after.notes ?? null,
        after.reporting_treatment === undefined ? 'normal' : after.reporting_treatment,
        before.id,
      ]
    )
    if (input.splits) {
      execute('DELETE FROM transaction_splits WHERE transaction_id = $1', [before.id])
      for (const split of input.splits)
        execute(
          'INSERT INTO transaction_splits (id, transaction_id, category_id, subcategory_id, amount, notes) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            generateId(),
            before.id,
            split.categoryId,
            split.subcategoryId ?? null,
            split.amountCentavos,
            split.notes ?? null,
          ]
        )
    }
    writeAuditLog({
      entity: 'transaction',
      entityId: before.id,
      action: 'correct-metadata',
      before: { transaction: before, splits: oldSplits },
      after: { transaction: after, splits: input.splits ?? oldSplits },
      source: input.auditSource ?? 'correct-transaction-metadata',
      note: input.auditNote,
    })
    return { success: true, transaction: after }
  })
}

export const setTransactionConsumption: ToolDefinition = {
  name: 'set-transaction-consumption',
  description:
    'Set an explicit allocation-level consumption classification. Refund/principal require a same-currency purchase classification; each role has an independent aggregate cap. Existing references must remain valid.',
  schema: z
    .object({
      transactionId: z.string(),
      splitId: z.string().nullable().optional(),
      role: z.enum(consumptionRoles),
      referencedPurchaseId: z.string().nullable().optional(),
      auditSource: z.string().max(120).optional(),
      auditNote: z.string().max(1000).optional(),
    })
    .strict(),
  effects: { writesTo: ['transaction_consumption_classifications', 'audit_log'] },
  execute: async (input) =>
    transaction(() => {
      assertCorrectionReferences(input.transactionId)
      const evidence = readConsumptionEvidence()
      const before = evidence.classifications.find(
        (item) =>
          item.transaction_id === input.transactionId && item.split_id === (input.splitId ?? null)
      )
      const after: ConsumptionClassification = {
        id: before?.id ?? generateId(),
        transaction_id: input.transactionId,
        split_id: input.splitId ?? null,
        role: input.role,
        referenced_purchase_id: input.referencedPurchaseId ?? null,
      }
      if (activeTransactionEvidence(input.transactionId).payments)
        throw new Error('Unlink active payments before changing classifications.')
      validateConsumptionEvidence({
        ...evidence,
        classifications: [
          ...evidence.classifications.filter((item) => item.id !== after.id),
          after,
        ],
      })
      execute(
        "INSERT INTO transaction_consumption_classifications (id, transaction_id, split_id, role, referenced_purchase_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET role = excluded.role, referenced_purchase_id = excluded.referenced_purchase_id, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        [after.id, after.transaction_id, after.split_id, after.role, after.referenced_purchase_id]
      )
      writeAuditLog({
        entity: 'transaction',
        entityId: input.transactionId,
        action: 'classify-consumption',
        before: before ?? null,
        after,
        source: input.auditSource ?? 'set-transaction-consumption',
        note: input.auditNote,
      })
      return { success: true, classification: after }
    }),
}
export const clearTransactionConsumption: ToolDefinition = {
  name: 'clear-transaction-consumption',
  description:
    'Clear an explicit classification only when no refund/principal references it. Does not change ledger rows or balances.',
  schema: z
    .object({
      classificationId: z.string(),
      auditSource: z.string().max(120).optional(),
      auditNote: z.string().max(1000).optional(),
    })
    .strict(),
  effects: { writesTo: ['transaction_consumption_classifications', 'audit_log'] },
  execute: async (input) =>
    transaction(() => {
      const evidence = readConsumptionEvidence()
      const before = evidence.classifications.find((item) => item.id === input.classificationId)
      if (!before) return { success: true, cleared: false }
      if (evidence.classifications.some((item) => item.referenced_purchase_id === before.id))
        throw new Error('Clear referencing refund/principal classifications first.')
      if (activeTransactionEvidence(before.transaction_id).payments)
        throw new Error('Unlink active payments before changing classifications.')
      execute('DELETE FROM transaction_consumption_classifications WHERE id = $1', [before.id])
      writeAuditLog({
        entity: 'transaction',
        entityId: before.transaction_id,
        action: 'clear-consumption',
        before,
        after: null,
        source: input.auditSource ?? 'clear-transaction-consumption',
        note: input.auditNote,
      })
      return { success: true, cleared: true }
    }),
}
