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

export function TransactionReviewSummary(input: TransactionAttentionInput) {
  const { t } = useTranslation('transactions')
  const summary = selectTransactionAttention(input)
  if (summary.kind === 'hidden') return null

  if (summary.kind === 'ledger-split') {
    return (
      <section
        aria-label={t('summary.attention')}
        data-testid="transaction-review-summary"
        data-kind="ledger-split"
        className="border-border bg-surface min-w-0 rounded-lg border px-3 py-2.5"
      >
        <div
          className="border-border flex h-2.5 w-full overflow-hidden rounded-full border"
          data-testid="ledger-flagged-bar"
          aria-hidden="true"
        >
          {summary.flagged > 0 ? (
            <span
              data-testid="ledger-flagged-share"
              className="h-full"
              style={{
                flexGrow: summary.flagged,
                flexBasis: 0,
                backgroundColor: 'var(--color-chart-4)',
              }}
            />
          ) : null}
          {summary.otherMatching > 0 ? (
            <span
              data-testid="ledger-other-share"
              className="h-full"
              style={{
                flexGrow: summary.otherMatching,
                flexBasis: 0,
                backgroundColor: 'var(--color-chart-1)',
              }}
            />
          ) : null}
        </div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <i
              className="size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: 'var(--color-chart-4)' }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{t('summary.flagged')}</span>
            <strong className="tabular-nums">{summary.flagged}</strong>
          </span>
          <span className="inline-flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <i className="bg-chart-1 size-2 shrink-0 rounded-sm" aria-hidden="true" />
            <span className="text-muted-foreground">{t('summary.otherMatching')}</span>
            <strong className="tabular-nums">{summary.otherMatching}</strong>
            <span className="border-border text-muted-foreground inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
              {t('summary.notVerified')}
            </span>
          </span>
        </div>
        <CountTable
          caption={t('summary.ledgerCaption')}
          rows={[
            { label: t('summary.flagged'), count: summary.flagged },
            { label: t('summary.otherMatching'), count: summary.otherMatching },
          ]}
        />
      </section>
    )
  }

  const maxCount = Math.max(...summary.reasons.map((reason) => reason.count), 1)
  return (
    <section
      aria-label={t('summary.attention')}
      data-testid="transaction-review-summary"
      data-kind="review-reasons"
      className="border-border bg-surface min-w-0 rounded-lg border px-3 py-2.5"
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-baseline gap-1 text-[11px]">
          <span className="text-muted-foreground">{t('summary.flagged')}</span>
          <strong className="tabular-nums" data-testid="review-flagged-union">
            {summary.flaggedUnion}
          </strong>
        </span>
        <span className="border-border text-muted-foreground inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium">
          {t('summary.overlap')}
        </span>
      </div>
      <ul className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-5">
        {summary.reasons.map((reason) => (
          <li
            key={reason.reason}
            data-testid={`review-reason-${reason.reason}`}
            className="min-w-0"
          >
            <div className="flex min-w-0 items-baseline justify-between gap-1">
              <span className="text-muted-foreground min-w-0 text-[10px] leading-tight font-medium break-words">
                {t(`summary.reasons.${reason.reason}`)}
              </span>
              <strong className="shrink-0 text-xs tabular-nums">{reason.count}</strong>
            </div>
            <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden="true">
              {reason.count > 0 ? (
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(reason.count / maxCount) * 100}%`,
                    backgroundColor: 'var(--color-chart-4)',
                  }}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
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
