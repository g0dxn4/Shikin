import type { TransactionReviewCounts } from '@/lib/transaction-query'

/**
 * reviewCounts ignore the selected reviewReason; total includes it.
 * all/total is a flagged-vs-other split only for Ledger with no reviewReason.
 * Review reasons overlap and must not be added or stacked against total.
 */
export const REVIEW_REASON_KEYS = [
  'needs-category',
  'pending',
  'placeholder',
  'staged',
  'unclassified',
] as const

export type ReviewReasonKey = (typeof REVIEW_REASON_KEYS)[number]
export type TransactionAttentionView = 'timeline' | 'ledger' | 'review'
export type TransactionAttentionStatus = 'ready' | 'loading' | 'error' | 'stale'

export interface TransactionAttentionInput {
  view: TransactionAttentionView
  reviewReasonApplied: boolean
  total: number
  reviewCounts: TransactionReviewCounts
  status: TransactionAttentionStatus
}

export interface AttentionReasonCount {
  reason: ReviewReasonKey
  count: number
}

export type TransactionAttentionSummary =
  | {
      kind: 'ledger-split'
      flagged: number
      otherMatching: number
      total: number
    }
  | {
      kind: 'review-reasons'
      reasons: AttentionReasonCount[]
      flaggedUnion: number
      overlapping: true
    }
  | {
      kind: 'hidden'
      reason: 'loading' | 'error' | 'stale' | 'empty' | 'incomplete'
    }

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function transactionAttentionStatus(input: {
  isLoading: boolean
  error: string | null
  search: string
  deferredSearch: string
}): TransactionAttentionStatus {
  if (input.error !== null) return 'error'
  if (input.isLoading) return 'loading'
  if (input.search !== input.deferredSearch) return 'stale'
  return 'ready'
}

export function selectTransactionAttention(
  input: TransactionAttentionInput
): TransactionAttentionSummary {
  if (input.status === 'loading' || input.status === 'error' || input.status === 'stale') {
    return { kind: 'hidden', reason: input.status }
  }

  const counts = input.reviewCounts
  if (
    !isCount(input.total) ||
    !isCount(counts.all) ||
    REVIEW_REASON_KEYS.some((reason) => !isCount(counts[reason]))
  ) {
    return { kind: 'hidden', reason: 'incomplete' }
  }

  const denominatorValid = input.view === 'ledger' && !input.reviewReasonApplied
  if (denominatorValid) {
    if (input.total === 0 && counts.all === 0) return { kind: 'hidden', reason: 'empty' }
    if (counts.all > input.total || input.total === 0) {
      return { kind: 'hidden', reason: 'incomplete' }
    }
    return {
      kind: 'ledger-split',
      flagged: counts.all,
      otherMatching: input.total - counts.all,
      total: input.total,
    }
  }

  const reasons = REVIEW_REASON_KEYS.map((reason) => ({ reason, count: counts[reason] }))
  if (!reasons.some((reason) => reason.count > 0) && counts.all === 0) {
    return { kind: 'hidden', reason: 'empty' }
  }
  return {
    kind: 'review-reasons',
    reasons,
    flaggedUnion: counts.all,
    overlapping: true,
  }
}
