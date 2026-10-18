import { createHash } from 'node:crypto'
import { correctMetadataMutation, correctTransactionMetadata } from '../transaction-corrections.js'
import { execute, query, transaction, z, type ToolDefinition } from './shared.js'

interface Correction {
  transactionId: string
  description?: string
  categoryId?: string | null
  subcategoryId?: string | null
  notes?: string | null
  clearCategory?: boolean
  clearSubcategory?: boolean
  clearNotes?: boolean
  reportingTreatment?: 'normal' | 'exclude_from_cashflow'
  splits?: Array<{
    categoryId: string
    subcategoryId?: string | null
    amountCentavos: number
    notes?: string | null
  }>
}
interface BatchInput {
  action: 'preview' | 'apply'
  corrections: Correction[]
  previewToken?: string
  idempotencyKey?: string
  auditSource?: string
  auditNote?: string
}
type Row = Record<string, unknown>
type DataState = { database_id: string; data_revision: number }
const namespace = 'shikin.metadata-batch.v1'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    )
  return value
}
function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
function state(): DataState {
  const row = query<DataState>('SELECT database_id,data_revision FROM app_data_state WHERE id=1')[0]
  if (!row?.database_id || !Number.isSafeInteger(row.data_revision))
    throw new Error(
      'Batch correction requires a database identity and revision. Migrate the database first.'
    )
  return row
}
const metadataFields = [
  'description',
  'category_id',
  'subcategory_id',
  'notes',
  'reporting_treatment',
]
function metadata(row: Row) {
  return Object.fromEntries(metadataFields.map((field) => [field, row[field] ?? null]))
}
function intent(input: BatchInput) {
  return {
    corrections: input.corrections,
    auditSource: input.auditSource ?? 'batch-correct-transactions',
    auditNote: input.auditNote ?? null,
  }
}
function preview(input: BatchInput, current: DataState) {
  if (
    new Set(input.corrections.map((item) => item.transactionId)).size !== input.corrections.length
  )
    throw new Error('Each transaction may appear only once. Combine its corrections into one item.')
  const plans = input.corrections.map((correction, index) => {
    try {
      const plan = correctMetadataMutation({ ...correction, dryRun: true })
      if (!plan.before || !plan.after)
        throw new Error('Correction preview did not return evidence.')
      return {
        transactionId: correction.transactionId,
        changed:
          correction.splits !== undefined ||
          fingerprint(metadata({ ...plan.before })) !== fingerprint(metadata({ ...plan.after })),
        before: { ...plan.before } as Row,
        after: { ...plan.after } as Row,
        splits: plan.splits,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Correction ${index + 1} (${correction.transactionId}): ${message}`, {
        cause: error,
      })
    }
  })
  const previewToken = fingerprint({ namespace, state: current, intent: intent(input), plans })
  return {
    plans,
    response: {
      success: true as const,
      dryRun: true,
      applicable: true,
      previewToken,
      databaseRevision: current.data_revision,
      count: plans.length,
      changedCount: plans.filter((plan) => plan.changed).length,
      items: plans.map((plan) => ({
        transactionId: plan.transactionId,
        changed: plan.changed,
        bank: {
          amountCentavos: plan.before.amount,
          currency: plan.before.currency,
          date: plan.before.date,
          accountId: plan.before.account_id,
        },
        before: metadata(plan.before),
        after: metadata(plan.after),
        ...(input.corrections.find((item) => item.transactionId === plan.transactionId)?.splits
          ? { replacementSplits: plan.splits }
          : {}),
      })),
    },
  }
}

/** Synchronous domain operations only: no awaits may escape this SQLite transaction. */
export function correctTransactionsBatch(input: BatchInput) {
  return transaction(() => {
    const current = state()
    if (input.action === 'preview') return preview(input, current).response
    if (!input.idempotencyKey || !input.previewToken)
      return {
        success: false,
        reason: 'preview_required',
        message:
          'Preview the complete batch, then apply with its previewToken and a unique idempotencyKey.',
        recoveryAction: 'preview',
      }
    // A deterministic audit primary key makes the receipt durable and unique under the
    // same IMMEDIATE transaction as all corrections. No second audit system is needed.
    const receiptId = `metadata-batch:${fingerprint({ namespace, databaseId: current.database_id, key: input.idempotencyKey })}`
    const requestHash = fingerprint({ namespace, intent: intent(input) })
    const receipt = query<{
      entity: string
      action: string
      before_json: string
      after_json: string
    }>('SELECT entity,action,before_json,after_json FROM audit_log WHERE id=$1', [receiptId])[0]
    if (receipt) {
      const before = JSON.parse(receipt.before_json) as { requestHash?: string }
      if (
        receipt.entity !== 'operation' ||
        receipt.action !== 'batch-correct-transactions' ||
        before.requestHash !== requestHash
      )
        return {
          success: false,
          reason: 'idempotency_conflict',
          message:
            'This idempotency key already belongs to a different batch. Use a new key for a new intent.',
          recoveryAction: 'new_idempotency_key',
        }
      return { ...(JSON.parse(receipt.after_json) as Row), replayed: true }
    }
    const planned = preview(input, current)
    if (input.previewToken !== planned.response.previewToken)
      return {
        success: false,
        reason: 'stale_preview',
        message:
          'The database or batch changed after preview. Preview and review the entire batch again.',
        recoveryAction: 'preview',
      }
    const items = planned.plans.map((plan, index) => {
      if (plan.changed)
        correctMetadataMutation({
          ...input.corrections[index],
          auditSource: input.auditSource ?? 'batch-correct-transactions',
          auditNote: input.auditNote,
          dryRun: false,
        })
      return { transactionId: plan.transactionId, changed: plan.changed }
    })
    const result = {
      success: true,
      dryRun: false,
      replayed: false,
      batchId: receiptId,
      count: items.length,
      changedCount: items.filter((item) => item.changed).length,
      items,
    }
    execute(
      `INSERT INTO audit_log (id,entity,entity_id,action,before_json,after_json,source,note,created_at)
       VALUES ($1,'operation',$2,'batch-correct-transactions',$3,$4,$5,$6,$7)`,
      [
        receiptId,
        receiptId,
        JSON.stringify({ requestHash, databaseRevision: current.data_revision }),
        JSON.stringify(result),
        input.auditSource ?? 'batch-correct-transactions',
        input.auditNote ?? null,
        new Date().toISOString(),
      ]
    )
    return result
  })
}

const correctionSchema = correctTransactionMetadata.schema
  .omit({ dryRun: true, auditSource: true, auditNote: true })
  .extend({
    transactionId: z.string().trim().min(1).max(128),
    splits: correctTransactionMetadata.schema.shape.splits.unwrap().max(100).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'transactionId'),
    'Supply at least one metadata correction.'
  )

export const transactionBatchTools: ToolDefinition[] = [
  {
    name: 'batch-correct-transactions',
    description:
      'Preview, then atomically correct metadata/categories/subcategories or replace splits for 1–100 explicit transactions. Preserves bank amounts, dates, source evidence and balances. Apply requires the exact previewToken and an idempotencyKey; retrying that key returns its original receipt. No partial writes.',
    schema: z
      .object({
        action: z.enum(['preview', 'apply']).default('preview'),
        corrections: z.array(correctionSchema).min(1).max(100),
        previewToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
          .describe('Required for apply: token from the complete preview.'),
        idempotencyKey: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .describe(
            'Required for apply: stable unique key for this intent; reuse only to retry it.'
          ),
        auditSource: z.string().trim().min(1).max(120).optional(),
        auditNote: z.string().trim().min(1).max(1000).optional(),
      })
      .strict(),
    effects: {
      readOnly: false,
      idempotent: true,
      writesTo: ['transactions', 'transaction_splits', 'audit_log', 'app_data_state'],
    },
    execute: async (input: BatchInput) => correctTransactionsBatch(input),
  },
]
