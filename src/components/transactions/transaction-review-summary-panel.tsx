import { useTranslation } from 'react-i18next'
import {
  selectTransactionAttention,
  type TransactionAttentionInput,
} from '@/components/transactions/transaction-review-summary'

function CountTable({
  caption,
  rows,
}: {
  caption: string
  rows: ReadonlyArray<{ label: string; count: number }>
}) {
  const { t } = useTranslation('transactions')
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('summary.attention')}</th>
            <th scope="col">{t('summary.count')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TransactionReviewSummary({
  onOpenReview,
  ...input
}: TransactionAttentionInput & {
  onOpenReview?: () => void
}) {
  const { t } = useTranslation('transactions')
  const summary = selectTransactionAttention(input)
  if (summary.kind === 'hidden') return null

  if (input.view !== 'review') {
    const flagged = summary.kind === 'ledger-split' ? summary.flagged : summary.flaggedUnion
    const title =
      summary.kind === 'ledger-split'
        ? `${summary.flagged} ${t('summary.flagged')}. ${summary.otherMatching} ${t('summary.otherMatching')}. ${t('summary.notVerified')}`
        : t('summary.overlap')
    return (
      <section
        aria-label={t('summary.attention')}
        data-testid="transaction-review-summary"
        data-kind={summary.kind}
        className="min-w-0"
      >
        <button
          type="button"
          onClick={onOpenReview}
          title={title}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-11 max-w-full items-center gap-1 rounded-md px-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none md:h-8"
        >
          <span className="tabular-nums">{flagged}</span>
          <span>{t('summary.flagged')}</span>
        </button>
        <span className="sr-only">{t('summary.notVerified')}</span>
        {summary.kind === 'ledger-split' ? (
          <CountTable
            caption={t('summary.ledgerCaption')}
            rows={[
              { label: t('summary.flagged'), count: summary.flagged },
              { label: t('summary.otherMatching'), count: summary.otherMatching },
            ]}
          />
        ) : (
          <CountTable
            caption={t('summary.reviewCaption')}
            rows={[
              { label: t('summary.flagged'), count: summary.flaggedUnion },
              ...summary.reasons.map((reason) => ({
                label: t(`summary.reasons.${reason.reason}`),
                count: reason.count,
              })),
            ]}
          />
        )}
      </section>
    )
  }

  if (summary.kind !== 'review-reasons') return null

  return (
    <section
      aria-label={t('summary.attention')}
      data-testid="transaction-review-summary"
      data-kind="review-reasons"
      className="min-w-0"
    >
      <p className="text-muted-foreground text-[11px] leading-4">
        <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <strong
            className="text-foreground font-medium tabular-nums"
            data-testid="review-flagged-union"
          >
            {summary.flaggedUnion}
          </strong>
          {t('summary.flagged')}
        </span>
        <span className="px-1" aria-hidden="true">
          ·
        </span>
        {t('summary.overlap')}
        {summary.reasons.map((reason) => (
          <span
            key={reason.reason}
            className="inline-flex items-baseline gap-1 whitespace-nowrap"
            data-testid={`review-reason-${reason.reason}`}
          >
            <span className="px-1" aria-hidden="true">
              ·
            </span>
            {t(`summary.reasons.${reason.reason}`)}
            <strong className="text-foreground font-medium tabular-nums">{reason.count}</strong>
          </span>
        ))}
      </p>
      <CountTable
        caption={t('summary.reviewCaption')}
        rows={[
          { label: t('summary.flagged'), count: summary.flaggedUnion },
          ...summary.reasons.map((reason) => ({
            label: t(`summary.reasons.${reason.reason}`),
            count: reason.count,
          })),
        ]}
      />
    </section>
  )
}
