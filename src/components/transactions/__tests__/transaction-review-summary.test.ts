import { describe, expect, it } from 'vitest'
import {
  selectTransactionAttention,
  transactionAttentionStatus,
  type TransactionAttentionInput,
} from '@/components/transactions/transaction-review-summary'
import type { TransactionReviewCounts } from '@/lib/transaction-query'

const counts = (overrides: Partial<TransactionReviewCounts> = {}): TransactionReviewCounts => ({
  all: 0,
  'needs-category': 0,
  pending: 0,
  placeholder: 0,
  staged: 0,
  unclassified: 0,
  ...overrides,
})

function input(overrides: Partial<TransactionAttentionInput> = {}): TransactionAttentionInput {
  return {
    view: 'ledger',
    reviewReasonApplied: false,
    total: 10,
    reviewCounts: counts({ all: 3, pending: 3 }),
    status: 'ready',
    ...overrides,
  }
}

describe('transactionAttentionStatus', () => {
  it('hides loading, error, and a deferred search that has not settled', () => {
    expect(
      transactionAttentionStatus({
        isLoading: false,
        error: null,
        search: 'coffee',
        deferredSearch: 'coffee',
      })
    ).toBe('ready')
    expect(
      transactionAttentionStatus({
        isLoading: true,
        error: null,
        search: 'coffee',
        deferredSearch: 'coffee',
      })
    ).toBe('loading')
    expect(
      transactionAttentionStatus({
        isLoading: false,
        error: 'failed',
        search: 'coffee',
        deferredSearch: 'coffee',
      })
    ).toBe('error')
    expect(
      transactionAttentionStatus({
        isLoading: false,
        error: null,
        search: 'coffee',
        deferredSearch: 'coff',
      })
    ).toBe('stale')
  })
})

describe('selectTransactionAttention', () => {
  it('splits flagged and other matching records only for a complete ledger query', () => {
    expect(selectTransactionAttention(input())).toEqual({
      kind: 'ledger-split',
      flagged: 3,
      otherMatching: 7,
      total: 10,
    })
    expect(
      selectTransactionAttention(input({ total: 4, reviewCounts: counts({ all: 0 }) }))
    ).toEqual({
      kind: 'ledger-split',
      flagged: 0,
      otherMatching: 4,
      total: 4,
    })
  })

  it('does not draw a 0/0 ledger graphic or a split when all exceeds total', () => {
    expect(selectTransactionAttention(input({ total: 0, reviewCounts: counts() }))).toEqual({
      kind: 'hidden',
      reason: 'empty',
    })
    expect(
      selectTransactionAttention(input({ total: 1, reviewCounts: counts({ all: 55, pending: 1 }) }))
    ).toEqual({ kind: 'hidden', reason: 'incomplete' })
    expect(
      selectTransactionAttention(input({ total: 0, reviewCounts: counts({ all: 2, pending: 2 }) }))
    ).toEqual({ kind: 'hidden', reason: 'incomplete' })
  })

  it('does not use all/total as a review pending denominator', () => {
    const summary = selectTransactionAttention(
      input({
        view: 'review',
        reviewReasonApplied: true,
        total: 1,
        reviewCounts: counts({
          all: 55,
          'needs-category': 10,
          pending: 1,
          placeholder: 4,
          staged: 2,
          unclassified: 40,
        }),
      })
    )
    expect(summary.kind).toBe('review-reasons')
    if (summary.kind !== 'review-reasons') return
    expect(summary).not.toHaveProperty('total')
    expect(summary).not.toHaveProperty('otherMatching')
    expect(summary.overlapping).toBe(true)
    expect(summary.flaggedUnion).toBe(55)
    expect(summary.reasons).toEqual([
      { reason: 'needs-category', count: 10 },
      { reason: 'pending', count: 1 },
      { reason: 'placeholder', count: 4 },
      { reason: 'staged', count: 2 },
      { reason: 'unclassified', count: 40 },
    ])
    const added = summary.reasons.reduce((sum, reason) => sum + reason.count, 0)
    expect(added).toBe(57)
    expect(added).not.toBe(summary.flaggedUnion)
    expect(added).not.toBe(1)
  })

  it('keeps the fraction unavailable in review even when the numbers happen to match', () => {
    const summary = selectTransactionAttention(
      input({
        view: 'review',
        reviewReasonApplied: true,
        total: 4,
        reviewCounts: counts({ all: 4, pending: 4 }),
      })
    )
    expect(summary.kind).toBe('review-reasons')
    expect(summary).not.toHaveProperty('total')
  })

  it('does not treat timeline all/total as a ledger split', () => {
    const summary = selectTransactionAttention(input({ view: 'timeline' }))
    expect(summary.kind).toBe('review-reasons')
    expect(summary).not.toHaveProperty('total')
  })

  it('hides review reasons when every independent count is zero', () => {
    expect(
      selectTransactionAttention(
        input({
          view: 'review',
          reviewReasonApplied: true,
          total: 1,
          reviewCounts: counts(),
        })
      )
    ).toEqual({ kind: 'hidden', reason: 'empty' })
  })

  it('hides while loading, in error, or stale even if the previous counts look complete', () => {
    const ready = input()
    expect(selectTransactionAttention({ ...ready, status: 'loading' })).toEqual({
      kind: 'hidden',
      reason: 'loading',
    })
    expect(selectTransactionAttention({ ...ready, status: 'error' })).toEqual({
      kind: 'hidden',
      reason: 'error',
    })
    expect(selectTransactionAttention({ ...ready, status: 'stale' })).toEqual({
      kind: 'hidden',
      reason: 'stale',
    })
  })

  it('hides incomplete counts instead of inventing a bar', () => {
    expect(selectTransactionAttention(input({ total: -1 }))).toEqual({
      kind: 'hidden',
      reason: 'incomplete',
    })
    expect(selectTransactionAttention(input({ total: 1.5 }))).toEqual({
      kind: 'hidden',
      reason: 'incomplete',
    })
    expect(
      selectTransactionAttention(
        input({ reviewCounts: counts({ all: Number.NaN, pending: Number.NaN }) })
      )
    ).toEqual({ kind: 'hidden', reason: 'incomplete' })
  })
})
