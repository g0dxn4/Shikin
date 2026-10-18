import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionReviewSummary } from '@/components/transactions/transaction-review-summary-panel'
import type { TransactionReviewCounts } from '@/lib/transaction-query'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const counts = (overrides: Partial<TransactionReviewCounts> = {}): TransactionReviewCounts => ({
  all: 55,
  'needs-category': 4,
  pending: 1,
  placeholder: 0,
  staged: 2,
  unclassified: 50,
  ...overrides,
})

describe('TransactionReviewSummary presentation', () => {
  it('offers a quiet flagged link for ledger without a share bar or money scale', async () => {
    const onOpenReview = vi.fn()
    const user = userEvent.setup()
    render(
      <TransactionReviewSummary
        view="ledger"
        reviewReasonApplied={false}
        total={74}
        reviewCounts={counts()}
        status="ready"
        onOpenReview={onOpenReview}
      />
    )

    const summary = screen.getByLabelText('summary.attention')
    expect(summary).toHaveAttribute('data-testid', 'transaction-review-summary')
    expect(summary).toHaveAttribute('data-kind', 'ledger-split')
    expect(summary.querySelector('[data-testid="ledger-flagged-bar"]')).toBeNull()
    expect(summary.querySelector('[style*="width"]')).toBeNull()
    expect(summary).toHaveTextContent('55')
    expect(summary).toHaveTextContent('summary.flagged')
    expect(summary).toHaveTextContent('summary.otherMatching')
    expect(summary).toHaveTextContent('19')
    expect(summary).toHaveTextContent('summary.notVerified')
    expect(summary).not.toHaveTextContent('approved')
    expect(summary).not.toHaveTextContent('$')
    expect(summary.textContent).not.toMatch(/55\s*\/\s*74|74\s*\/\s*55/)

    await user.click(screen.getByRole('button', { name: /55/ }))
    expect(onOpenReview).toHaveBeenCalledTimes(1)
  })

  it('states overlapping review counts without scaling a reason to 100', () => {
    render(
      <TransactionReviewSummary
        view="review"
        reviewReasonApplied
        total={1}
        reviewCounts={counts()}
        status="ready"
      />
    )

    const summary = screen.getByTestId('transaction-review-summary')
    expect(summary).toHaveAttribute('data-kind', 'review-reasons')
    expect(summary.querySelector('[data-testid="ledger-flagged-bar"]')).toBeNull()
    expect(summary.querySelector('[style*="width"]')).toBeNull()
    expect(summary).not.toHaveAttribute('data-total')
    expect(summary).toHaveTextContent('summary.overlap')
    expect(screen.getByTestId('review-flagged-union')).toHaveTextContent('55')
    expect(screen.getByTestId('review-reason-unclassified')).toHaveTextContent('50')
    expect(screen.getByTestId('review-reason-pending')).toHaveTextContent('1')
    expect(screen.getByTestId('review-reason-pending')).not.toHaveTextContent('55')
    for (const reason of ['needs-category', 'pending', 'placeholder', 'staged', 'unclassified']) {
      expect(screen.getByTestId(`review-reason-${reason}`)).toHaveClass(
        'inline-flex',
        'whitespace-nowrap'
      )
    }
    expect(screen.getByTestId('review-flagged-union').parentElement).toHaveClass(
      'inline-flex',
      'whitespace-nowrap'
    )
    expect(summary).not.toHaveTextContent('57')
    expect(summary).not.toHaveTextContent('approved')
    expect(summary).not.toHaveTextContent('$')
    expect(summary.textContent).not.toMatch(/1\s*\/\s*55|50\s*\/\s*55/)
  })

  it('hides while loading, in error, stale, or when both counts are zero', () => {
    const { rerender } = render(
      <TransactionReviewSummary
        view="ledger"
        reviewReasonApplied={false}
        total={10}
        reviewCounts={counts({ all: 3 })}
        status="loading"
      />
    )
    expect(screen.queryByTestId('transaction-review-summary')).not.toBeInTheDocument()

    rerender(
      <TransactionReviewSummary
        view="ledger"
        reviewReasonApplied={false}
        total={10}
        reviewCounts={counts({ all: 3 })}
        status="error"
      />
    )
    expect(screen.queryByTestId('transaction-review-summary')).not.toBeInTheDocument()

    rerender(
      <TransactionReviewSummary
        view="timeline"
        reviewReasonApplied={false}
        total={10}
        reviewCounts={counts({ all: 3 })}
        status="stale"
      />
    )
    expect(screen.queryByTestId('transaction-review-summary')).not.toBeInTheDocument()

    rerender(
      <TransactionReviewSummary
        view="ledger"
        reviewReasonApplied={false}
        total={0}
        reviewCounts={counts({
          all: 0,
          'needs-category': 0,
          pending: 0,
          placeholder: 0,
          staged: 0,
          unclassified: 0,
        })}
        status="ready"
      />
    )
    expect(screen.queryByTestId('transaction-review-summary')).not.toBeInTheDocument()
  })
})
