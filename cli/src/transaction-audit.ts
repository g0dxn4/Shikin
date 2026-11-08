import { calculateLegacyLedgerLegs } from '@shikin/finance-core'
import type { CorrectionTransaction } from '@shikin/finance-core/corrections'
import { guardTransactionEvidence } from './transaction-corrections.js'
import { query, execute, fromCentavos } from './tools/shared.js'
import {
  type AuditLogRow,
  asString,
  asNumber,
  asStringArray,
  nestedSnapshot,
  parseAuditJson,
  isPlainObject,
  failure,
} from './audit-read.js'
import {
  type TransactionRow,
  normalizeTransactionStatus,
  normalizeLedgerTreatment,
  normalizeReportingTreatment,
  parseStoredTransactionTags,
} from './transaction-values.js'

export function transactionAuditSnapshot(tx: TransactionRow) {
  const tagDetails = parseStoredTransactionTags(tx.tags)
  return {
    id: tx.id,
    accountId: tx.account_id,
    categoryId: tx.category_id,
    transferToAccountId: tx.transfer_to_account_id,
    type: tx.type,
    amount: fromCentavos(tx.amount),
    amountCentavos: tx.amount,
    currency: tx.currency,
    description: tx.description,
    notes: tx.notes,
    status: normalizeTransactionStatus(tx.status),
    source: tx.source ?? null,
    note: tx.note ?? null,
    recurringRuleId: tx.recurring_rule_id ?? null,
    ledgerTreatment: normalizeLedgerTreatment(tx.ledger_treatment),
    reportingTreatment: normalizeReportingTreatment(tx.reporting_treatment),
    transactionKind: tx.transaction_kind ?? 'standard',
    stagingBatchId: tx.staging_batch_id ?? null,
    finalizationId: tx.finalization_id ?? null,
    importSource: tx.import_source ?? null,
    importExternalId: tx.import_external_id ?? null,
    importFingerprint: tx.import_fingerprint ?? null,
    importContentFingerprint: tx.import_content_fingerprint ?? null,
    reconciliationId: tx.reconciliation_id ?? null,
    matchedTransactionId: tx.matched_transaction_id ?? null,
    isArchived: tx.is_archived === 1,
    tags: tagDetails.map((tag) => tag.label),
    tagDetails,
    isPlaceholder: Boolean(tx.is_placeholder),
    placeholderStatus: tx.placeholder_status ?? null,
    resolvedAt: tx.resolved_at ?? null,
    resolvedByTransactionId: tx.resolved_by_transaction_id ?? null,
    placeholderReason: tx.placeholder_reason ?? null,
    placeholderParentTransactionId: tx.placeholder_parent_transaction_id ?? null,
    date: tx.date,
  }
}

export type UndoTransactionSnapshot = {
  id: string
  accountId: string
  categoryId: string | null
  transferToAccountId: string | null
  type: 'expense' | 'income' | 'transfer'
  amountCentavos: number
  currency: string | null
  description: string
  notes: string | null
  status: 'pending' | 'posted' | 'cleared'
  source: string | null
  note: string | null
  recurringRuleId: string | null
  tags: string[]
  isPlaceholder: boolean
  placeholderStatus: string | null
  resolvedAt: string | null
  resolvedByTransactionId: string | null
  placeholderReason: string | null
  placeholderParentTransactionId: string | null
  date: string
}

function normalizeUndoTransactionStatus(value: unknown): UndoTransactionSnapshot['status'] {
  return value === 'pending' || value === 'cleared' || value === 'posted' ? value : 'posted'
}

export function transactionSnapshotFromAudit(value: unknown): UndoTransactionSnapshot | null {
  const tx = nestedSnapshot(value, 'transaction')
  if (!tx) return null
  const id = asString(tx.id)
  const accountId = asString(tx.accountId)
  const type = asString(tx.type)
  const amountCentavos = asNumber(tx.amountCentavos)
  const description = asString(tx.description)
  const date = asString(tx.date)
  if (
    !id ||
    !accountId ||
    !(type === 'expense' || type === 'income' || type === 'transfer') ||
    amountCentavos === null ||
    !description ||
    !date
  ) {
    return null
  }

  return {
    id,
    accountId,
    categoryId: asString(tx.categoryId),
    transferToAccountId: asString(tx.transferToAccountId),
    type,
    amountCentavos,
    currency: asString(tx.currency),
    description,
    notes: asString(tx.notes),
    status: normalizeUndoTransactionStatus(tx.status),
    source: asString(tx.source),
    note: asString(tx.note),
    recurringRuleId: asString(tx.recurringRuleId),
    tags: asStringArray(tx.tags),
    isPlaceholder: Boolean(tx.isPlaceholder),
    placeholderStatus: asString(tx.placeholderStatus),
    resolvedAt: asString(tx.resolvedAt),
    resolvedByTransactionId: asString(tx.resolvedByTransactionId),
    placeholderReason: asString(tx.placeholderReason),
    placeholderParentTransactionId: asString(tx.placeholderParentTransactionId),
    date,
  }
}

export function protectedUndoSemanticsFailure(entry: AuditLogRow) {
  if (entry.entity !== 'transaction') return null
  const transactionIds = new Set<string>()
  if (entry.entity_id) transactionIds.add(entry.entity_id)
  for (const value of [parseAuditJson(entry.before_json), parseAuditJson(entry.after_json)]) {
    const snapshot = transactionSnapshotFromAudit(value)
    if (snapshot) transactionIds.add(snapshot.id)
  }
  if (entry.action !== 'create' && transactionIds.size > 0) {
    const ids = [...transactionIds]
    const originalPlaceholders = ids.map((_, index) => `$${index + 1}`).join(', ')
    const livePlaceholders = ids.map((_, index) => `$${ids.length + index + 1}`).join(', ')
    const fxEvidence = query<{ id: string }>(
      `SELECT id FROM transaction_fx_evidence
       WHERE original_transaction_id IN (${originalPlaceholders})
          OR transaction_id IN (${livePlaceholders})
       LIMIT 1`,
      [...ids, ...ids]
    )[0]
    if (fxEvidence) {
      return failure(
        'dedicated_financial_undo_required',
        'FX-bearing transaction updates and deletions cannot be restored through generic undo. Use a dedicated financial correction workflow.'
      )
    }
  }
  for (const value of [parseAuditJson(entry.before_json), parseAuditJson(entry.after_json)]) {
    const tx = nestedSnapshot(value, 'transaction')
    if (!tx) continue
    if (
      (tx.ledgerTreatment !== undefined && tx.ledgerTreatment !== 'normal') ||
      (tx.reportingTreatment !== undefined && tx.reportingTreatment !== 'normal') ||
      (tx.transactionKind !== undefined && tx.transactionKind !== 'standard') ||
      Boolean(tx.stagingBatchId) ||
      Boolean(tx.reconciliationId) ||
      Boolean(tx.matchedTransactionId) ||
      tx.isArchived === true
    ) {
      return failure(
        'dedicated_financial_undo_required',
        'This transaction uses staging, reconciliation, matching, archive, or reporting semantics and cannot be restored through generic undo. Use its dedicated reversal or unmatch workflow.'
      )
    }

    for (const accountId of [asString(tx.accountId), asString(tx.transferToAccountId)].filter(
      (value): value is string => Boolean(value)
    )) {
      const account = (query<{ account_mode?: 'transactional' | 'snapshot_only' | null }>(
        'SELECT account_mode FROM accounts WHERE id = $1 LIMIT 1',
        [accountId]
      ) ?? [])[0]
      if ((account?.account_mode ?? 'transactional') === 'snapshot_only') {
        return failure(
          'snapshot_only_account',
          `Generic undo cannot mutate transaction history for snapshot-only account ${accountId}.`
        )
      }
    }
  }
  return null
}

export function transactionSnapshotPublic(tx: UndoTransactionSnapshot) {
  return {
    ...tx,
    amount: fromCentavos(tx.amountCentavos),
  }
}

export function transactionBalanceImpacts(tx: UndoTransactionSnapshot): Map<string, number> {
  const impacts = new Map<string, number>()
  const result = calculateLegacyLedgerLegs(
    {
      type: tx.type,
      amountCentavos: tx.amountCentavos,
      accountId: tx.accountId,
      transferToAccountId: tx.transferToAccountId,
      status: tx.status,
    },
    'generic-undo'
  )
  for (const leg of result.legs) {
    impacts.set(leg.accountId, (impacts.get(leg.accountId) ?? 0) + leg.deltaCentavos)
  }
  return impacts
}

function serializedUndoTags(tx: UndoTransactionSnapshot) {
  return JSON.stringify(tx.tags ?? [])
}

export function insertUndoTransaction(tx: UndoTransactionSnapshot) {
  execute(
    `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, tags, is_placeholder, placeholder_status, resolved_at, resolved_by_transaction_id, placeholder_reason, placeholder_parent_transaction_id, date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      tx.id,
      tx.accountId,
      tx.categoryId,
      tx.transferToAccountId,
      tx.type,
      tx.amountCentavos,
      tx.currency,
      tx.description,
      tx.notes,
      tx.status,
      tx.source,
      tx.note,
      tx.recurringRuleId,
      serializedUndoTags(tx),
      tx.isPlaceholder ? 1 : 0,
      tx.placeholderStatus,
      tx.resolvedAt,
      tx.resolvedByTransactionId,
      tx.placeholderReason,
      tx.placeholderParentTransactionId,
      tx.date,
    ]
  )
}

export function updateUndoTransaction(tx: UndoTransactionSnapshot) {
  const result = execute(
    `UPDATE transactions
     SET account_id = $1, category_id = $2, transfer_to_account_id = $3, type = $4, amount = $5,
         currency = $6, description = $7, notes = $8, status = $9, source = $10, note = $11,
         recurring_rule_id = $12, tags = $13, is_placeholder = $14, placeholder_status = $15,
         resolved_at = $16, resolved_by_transaction_id = $17, placeholder_reason = $18,
         placeholder_parent_transaction_id = $19, date = $20,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $21`,
    [
      tx.accountId,
      tx.categoryId,
      tx.transferToAccountId,
      tx.type,
      tx.amountCentavos,
      tx.currency,
      tx.description,
      tx.notes,
      tx.status,
      tx.source,
      tx.note,
      tx.recurringRuleId,
      serializedUndoTags(tx),
      tx.isPlaceholder ? 1 : 0,
      tx.placeholderStatus,
      tx.resolvedAt,
      tx.resolvedByTransactionId,
      tx.placeholderReason,
      tx.placeholderParentTransactionId,
      tx.date,
      tx.id,
    ]
  )
  if (result.rowsAffected !== 1)
    throw new Error(`Transaction ${tx.id} could not be restored safely.`)
}

export function deleteUndoTransaction(transactionId: string) {
  const result = execute('DELETE FROM transactions WHERE id = $1', [transactionId])
  if (result.rowsAffected !== 1)
    throw new Error(`Transaction ${transactionId} could not be deleted safely.`)
}

function currentTransactionMatchesAudit(
  current: Record<string, unknown>,
  expected: UndoTransactionSnapshot
) {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(asString(current.tags) ?? '[]') as unknown
    if (Array.isArray(parsed)) {
      tags = parsed
        .map((tag) =>
          typeof tag === 'string'
            ? tag
            : isPlainObject(tag) && typeof tag.label === 'string'
              ? tag.label
              : null
        )
        .filter((tag): tag is string => Boolean(tag))
    }
  } catch {
    return false
  }

  return (
    current.account_id === expected.accountId &&
    (current.category_id ?? null) === expected.categoryId &&
    (current.transfer_to_account_id ?? null) === expected.transferToAccountId &&
    current.type === expected.type &&
    current.amount === expected.amountCentavos &&
    (current.currency ?? null) === expected.currency &&
    current.description === expected.description &&
    (current.notes ?? null) === expected.notes &&
    normalizeUndoTransactionStatus(current.status) === expected.status &&
    (current.source ?? null) === expected.source &&
    (current.note ?? null) === expected.note &&
    (current.recurring_rule_id ?? null) === expected.recurringRuleId &&
    JSON.stringify(tags) === JSON.stringify(expected.tags) &&
    Boolean(current.is_placeholder) === expected.isPlaceholder &&
    (current.placeholder_status ?? null) === expected.placeholderStatus &&
    (current.resolved_at ?? null) === expected.resolvedAt &&
    (current.resolved_by_transaction_id ?? null) === expected.resolvedByTransactionId &&
    (current.placeholder_reason ?? null) === expected.placeholderReason &&
    (current.placeholder_parent_transaction_id ?? null) ===
      expected.placeholderParentTransactionId &&
    current.date === expected.date
  )
}

export function assertCurrentTransactionUndoState(
  entry: AuditLogRow,
  plan: { entityId: string; inverseAction: 'create' | 'update' | 'delete' }
) {
  for (const json of [entry.before_json, entry.after_json]) {
    const snapshot = parseAuditJson(json)
    if (!snapshot || typeof snapshot !== 'object') continue
    const root = snapshot as Record<string, unknown>
    const row = (root.transaction ?? root) as Record<string, unknown>
    if (
      [
        'finalizationId',
        'finalization_id',
        'importSource',
        'import_source',
        'importExternalId',
        'import_external_id',
        'importFingerprint',
        'import_fingerprint',
        'importContentFingerprint',
        'import_content_fingerprint',
      ].some((key) => row[key])
    )
      throw new Error('Imported or finalized evidence cannot be restored by generic undo.')
  }

  const current = (query<Record<string, unknown>>(
    'SELECT * FROM transactions WHERE id = $1 LIMIT 1',
    [plan.entityId]
  ) ?? [])[0]

  if (plan.inverseAction === 'create') {
    if (current)
      throw new Error(`Transaction ${plan.entityId} was recreated after this audit entry.`)
    return
  }
  if (!current) throw new Error(`Transaction ${plan.entityId} no longer exists.`)

  const expectedCurrent = transactionSnapshotFromAudit(parseAuditJson(entry.after_json))
  if (!expectedCurrent || !currentTransactionMatchesAudit(current, expectedCurrent)) {
    throw new Error(
      `Transaction ${plan.entityId} changed after audit entry ${entry.id}; refresh the undo preview.`
    )
  }
  if (
    (current.ledger_treatment ?? 'normal') !== 'normal' ||
    (current.reporting_treatment ?? 'normal') !== 'normal' ||
    (current.transaction_kind ?? 'standard') !== 'standard' ||
    current.staging_batch_id ||
    current.reconciliation_id ||
    current.finalization_id ||
    current.import_source ||
    current.import_external_id ||
    current.import_fingerprint ||
    current.import_content_fingerprint ||
    current.matched_transaction_id ||
    current.is_archived === 1
  ) {
    throw new Error(
      `Transaction ${plan.entityId} now uses protected financial semantics and requires a dedicated workflow.`
    )
  }

  guardTransactionEvidence(current as unknown as CorrectionTransaction, null)
  if (
    query('SELECT id FROM transaction_splits WHERE transaction_id = $1 LIMIT 1', [plan.entityId])
      .length
  )
    throw new Error('Split transactions require the dedicated correction workflow.')

  const references = (query<{
    reconciliation_count: number
    receivable_count: number
    finalized_statement_count: number
  }>(
    `SELECT
         (SELECT COUNT(*) FROM account_reconciliations WHERE adjustment_transaction_id = $1) AS reconciliation_count,
         (SELECT COUNT(*) FROM receivables WHERE matched_transaction_id = $2) AS receivable_count,
         (SELECT COUNT(*) FROM account_reconciliations
          WHERE account_id = $3 AND staging_batch_id = $4 AND selection_mode = 'legacy_batch') AS finalized_statement_count`,
    [plan.entityId, plan.entityId, current.account_id, current.staging_batch_id ?? null]
  ) ?? [])[0]
  if (
    (references?.reconciliation_count ?? 0) > 0 ||
    (references?.receivable_count ?? 0) > 0 ||
    ((current.ledger_treatment ?? 'normal') === 'normal' &&
      (current.status ?? 'posted') !== 'pending' &&
      (references?.finalized_statement_count ?? 0) > 0)
  ) {
    throw new Error(
      `Transaction ${plan.entityId} is now linked financial provenance and cannot be changed by generic undo.`
    )
  }
}
