import {
  normalizePostingStatus,
  type LedgerTreatment,
  type PostingStatus,
  type TransactionKind,
} from './ledger.js'

// ECMAScript trim whitespace, matching posting-status normalization and currency validation.
export const SQL_WHITESPACE =
  'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)'

/** Fixed alias only; mirrors getCashFlowEligibility, including legacy nulls. */
export const CASH_FLOW_SQL = `t.type IN ('income', 'expense')
  AND COALESCE(t.reporting_treatment, 'normal') = 'normal'
  AND COALESCE(t.ledger_treatment, 'normal') = 'normal'
  AND COALESCE(t.transaction_kind, 'standard') = 'standard'
  AND COALESCE(t.is_archived, 0) = 0
  AND COALESCE(NULLIF(LOWER(TRIM(t.status, ${SQL_WHITESPACE})), ''), 'posted') IN ('posted', 'cleared')`

export type ReportingTreatment = 'normal' | 'exclude_from_cashflow'

export interface CashFlowCandidate {
  type: string
  status?: string | null
  ledgerTreatment?: LedgerTreatment | null
  reportingTreatment?: ReportingTreatment | null
  transactionKind?: TransactionKind | null
  isArchived?: boolean | number | null
}

export type CashFlowEligibility =
  | { eligible: true; postingStatus: 'posted' | 'cleared' }
  | {
      eligible: false
      postingStatus: PostingStatus | 'invalid'
      reason:
        | 'not_posted_or_cleared'
        | 'excluded_reporting_treatment'
        | 'archived_provenance'
        | 'not_income_or_expense'
        | 'invalid_transaction_type'
        | 'invalid_reporting_treatment'
        | 'invalid_ledger_treatment'
        | 'staged_no_balance_impact'
        | 'invalid_transaction_kind'
        | 'invalid_archive_flag'
        | 'excluded_transaction_kind'
    }

export function getCashFlowEligibility(candidate: CashFlowCandidate): CashFlowEligibility {
  const postingStatus = normalizePostingStatus(candidate.status)
  if (!isTransactionType(candidate.type)) {
    return { eligible: false, postingStatus, reason: 'invalid_transaction_type' }
  }
  if (!isReportingTreatment(candidate.reportingTreatment)) {
    return { eligible: false, postingStatus, reason: 'invalid_reporting_treatment' }
  }
  if (
    candidate.ledgerTreatment !== undefined &&
    candidate.ledgerTreatment !== null &&
    candidate.ledgerTreatment !== 'normal' &&
    candidate.ledgerTreatment !== 'staged_no_balance_impact'
  ) {
    return { eligible: false, postingStatus, reason: 'invalid_ledger_treatment' }
  }
  if (!isTransactionKind(candidate.transactionKind)) {
    return { eligible: false, postingStatus, reason: 'invalid_transaction_kind' }
  }
  if (!isArchiveFlag(candidate.isArchived)) {
    return { eligible: false, postingStatus, reason: 'invalid_archive_flag' }
  }
  if (postingStatus !== 'posted' && postingStatus !== 'cleared') {
    return { eligible: false, postingStatus, reason: 'not_posted_or_cleared' }
  }
  if (candidate.ledgerTreatment === 'staged_no_balance_impact') {
    return { eligible: false, postingStatus, reason: 'staged_no_balance_impact' }
  }
  if (candidate.reportingTreatment === 'exclude_from_cashflow') {
    return { eligible: false, postingStatus, reason: 'excluded_reporting_treatment' }
  }
  if (
    candidate.isArchived === true ||
    (typeof candidate.isArchived === 'number' && candidate.isArchived !== 0) ||
    candidate.transactionKind === 'archived_transfer_mirror'
  ) {
    return { eligible: false, postingStatus, reason: 'archived_provenance' }
  }
  if (candidate.transactionKind === 'reconciliation_bridge') {
    return { eligible: false, postingStatus, reason: 'excluded_transaction_kind' }
  }
  if (candidate.type === 'transfer') {
    return { eligible: false, postingStatus, reason: 'not_income_or_expense' }
  }
  return { eligible: true, postingStatus }
}

export function isCashFlowEligible(candidate: CashFlowCandidate): boolean {
  return getCashFlowEligibility(candidate).eligible
}

export interface CashFlowIntegrityRow {
  id: string
  type: string
  amount: number
  currency: string | null
  split_count: number
  split_total: number | null
  invalid_splits: number
}

export interface CashFlowIntegrityFailure {
  reason: 'invalid_currency_data' | 'invalid_category_allocations' | 'unsafe_cashflow_total'
  transactionId: string
}

/** Validate already-loaded eligible rows in input order before publishing complete totals. */
export function getCashFlowIntegrityFailure(
  rows: readonly CashFlowIntegrityRow[]
): CashFlowIntegrityFailure | null {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const currency = row.currency?.trim().toUpperCase()
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      return { reason: 'invalid_currency_data', transactionId: row.id }
    }
    if (
      !Number.isSafeInteger(row.amount) ||
      row.amount < 0 ||
      (row.split_count > 0 && (row.invalid_splits > 0 || row.split_total !== row.amount))
    ) {
      return { reason: 'invalid_category_allocations', transactionId: row.id }
    }
    const key = `${currency}:${row.type}`
    const total = (totals.get(key) ?? 0) + row.amount
    if (!Number.isSafeInteger(total)) {
      return { reason: 'unsafe_cashflow_total', transactionId: row.id }
    }
    totals.set(key, total)
  }
  return null
}

function isTransactionType(value: unknown): value is 'income' | 'expense' | 'transfer' {
  return value === 'income' || value === 'expense' || value === 'transfer'
}

function isReportingTreatment(value: unknown): value is ReportingTreatment | null | undefined {
  return (
    value === undefined || value === null || value === 'normal' || value === 'exclude_from_cashflow'
  )
}

function isTransactionKind(value: unknown): value is TransactionKind | null | undefined {
  return (
    value === undefined ||
    value === null ||
    value === 'standard' ||
    value === 'reconciliation_bridge' ||
    value === 'archived_transfer_mirror'
  )
}

function isArchiveFlag(value: unknown): value is boolean | number | null | undefined {
  return (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isInteger(value))
  )
}
