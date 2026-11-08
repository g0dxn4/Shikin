import type { TransactionFxEvidenceSnapshot } from '@shikin/finance-core'

export type TransactionStatus = 'pending' | 'posted' | 'cleared'
export type LedgerTreatment = 'normal' | 'staged_no_balance_impact'
export type ReportingTreatment = 'normal' | 'exclude_from_cashflow'
export type PlaceholderTransactionStatus = 'unresolved' | 'resolved' | 'split' | 'cancelled'
export type TransactionRow = {
  id: string
  account_id: string
  category_id: string | null
  transfer_to_account_id: string | null
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string | null
  description: string
  notes: string | null
  status?: TransactionStatus | null
  source?: string | null
  note?: string | null
  recurring_rule_id?: string | null
  ledger_treatment?: LedgerTreatment | null
  reporting_treatment?: ReportingTreatment | null
  transaction_kind?: 'standard' | 'reconciliation_bridge' | 'archived_transfer_mirror' | null
  staging_batch_id?: string | null
  finalization_id?: string | null
  import_source?: string | null
  import_external_id?: string | null
  import_fingerprint?: string | null
  import_content_fingerprint?: string | null
  reconciliation_id?: string | null
  matched_transaction_id?: string | null
  is_archived?: number | null
  tags?: string | null
  is_placeholder?: number | null
  placeholder_status?: PlaceholderTransactionStatus | null
  resolved_at?: string | null
  resolved_by_transaction_id?: string | null
  placeholder_reason?: string | null
  placeholder_parent_transaction_id?: string | null
  date: string
}

export type TransactionTag = {
  key: string
  label: string
}

export type TransactionFxEvidenceRow = {
  id: string
  transaction_id: string | null
  original_transaction_id: string
  original_account_id: string
  transaction_type: 'income' | 'expense'
  status: TransactionStatus
  ledger_treatment: LedgerTreatment
  input_amount_centavos: number
  input_currency: string
  account_amount_centavos: number
  account_currency: string
  account_balance_delta_centavos: number
  transaction_date: string
  rate_id: string | null
  rate_decimal: string
  created_at: string
}

export function normalizeTransactionStatus(status: TransactionRow['status']): TransactionStatus {
  return status ?? 'posted'
}

export function normalizeLedgerTreatment(
  value: TransactionRow['ledger_treatment']
): LedgerTreatment {
  return value === 'staged_no_balance_impact' ? value : 'normal'
}

export function normalizeReportingTreatment(
  value: TransactionRow['reporting_treatment']
): ReportingTreatment {
  return value === 'exclude_from_cashflow' ? value : 'normal'
}

export function publicFxEvidence(
  evidence: TransactionFxEvidenceRow | TransactionFxEvidenceSnapshot | null
) {
  if (!evidence) return null
  if ('transaction_id' in evidence) {
    return {
      id: evidence.id,
      transactionId: evidence.transaction_id,
      originalTransactionId: evidence.original_transaction_id,
      originalAccountId: evidence.original_account_id,
      transactionType: evidence.transaction_type,
      acceptedStatus: evidence.status,
      ledgerTreatment: evidence.ledger_treatment,
      inputAmountCentavos: evidence.input_amount_centavos,
      inputCurrency: evidence.input_currency,
      accountAmountCentavos: evidence.account_amount_centavos,
      accountCurrency: evidence.account_currency,
      accountBalanceDeltaCentavos: evidence.account_balance_delta_centavos,
      transactionDate: evidence.transaction_date,
      rateId: evidence.rate_id,
      rateDecimal: evidence.rate_decimal,
      direction: `${evidence.input_currency}->${evidence.account_currency}`,
      createdAt: evidence.created_at,
      immutableAcceptanceSnapshot: true,
    }
  }
  return {
    ...evidence,
    acceptedStatus: evidence.status,
    direction: `${evidence.inputCurrency}->${evidence.accountCurrency}`,
    immutableAcceptanceSnapshot: true,
  }
}

function normalizeTransactionTagLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

export function normalizeTransactionTagKey(label: string): string {
  return normalizeTransactionTagLabel(label).toLocaleLowerCase()
}

export function transactionTagFromUnknown(value: unknown): TransactionTag | null {
  if (typeof value === 'string') {
    const label = normalizeTransactionTagLabel(value)
    const key = normalizeTransactionTagKey(label)
    return key ? { key, label } : null
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const labelValue = record.label ?? record.name ?? record.value ?? record.key
    if (typeof labelValue !== 'string') return null
    const label = normalizeTransactionTagLabel(labelValue)
    const keyValue = typeof record.key === 'string' ? record.key : label
    const key = normalizeTransactionTagKey(keyValue)
    return key && label ? { key, label } : null
  }

  return null
}

export function parseStoredTransactionTags(rawTags: string | null | undefined): TransactionTag[] {
  if (!rawTags || rawTags.trim() === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(rawTags)
  } catch {
    return []
  }

  const values = Array.isArray(parsed) ? parsed : [parsed]
  const tags: TransactionTag[] = []
  const seenKeys = new Set<string>()

  for (const value of values) {
    const tag = transactionTagFromUnknown(value)
    if (!tag || seenKeys.has(tag.key)) continue
    tags.push(tag)
    seenKeys.add(tag.key)
  }

  return tags
}
