import { normalizePostingStatus, type PostingStatus, type TransactionKind } from './ledger.js'

export type ReportingTreatment = 'normal' | 'exclude_from_cashflow'

export interface CashFlowCandidate {
  type: string
  status?: string | null
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
  if (!isTransactionKind(candidate.transactionKind)) {
    return { eligible: false, postingStatus, reason: 'invalid_transaction_kind' }
  }
  if (!isArchiveFlag(candidate.isArchived)) {
    return { eligible: false, postingStatus, reason: 'invalid_archive_flag' }
  }
  if (postingStatus !== 'posted' && postingStatus !== 'cleared') {
    return { eligible: false, postingStatus, reason: 'not_posted_or_cleared' }
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
