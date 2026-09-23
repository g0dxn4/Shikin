import { useTranslation } from 'react-i18next'
import { NativePanel } from '@/components/ui/native-layout'
import { formatMoney } from '@/lib/money'
import type { TrendMonth } from '@/lib/dashboard-analytics'
import { cn } from '@/lib/utils'

interface OverviewCashFlowProps {
  months: TrendMonth[]
  displayCurrency: string
  unavailable?: boolean
  unavailableMessage?: string
  embedded?: boolean
}

export function OverviewCashFlow({
  months,
  displayCurrency,
  unavailable = false,
  unavailableMessage,
  embedded = false,
}: OverviewCashFlowProps) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n?.resolvedLanguage ?? i18n?.language
  const maxValue = Math.max(1, ...months.flatMap((month) => [month.income, month.expenses]))

  const body = (
    <>
      <div className={cn('shrink-0', embedded ? 'mb-3' : 'mb-4')}>
        <h2 id="overview-cashflow-heading" className="text-base font-semibold">
          {t('overview.cashFlow')}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('overview.cashFlowSubtitle')}</p>
      </div>

      {unavailable ? (
        <p
          className="text-warning flex flex-1 items-center justify-center py-10 text-center text-sm"
          role="status"
        >
          {unavailableMessage ?? t('currency.derivedUnavailable')}
        </p>
      ) : (
        <>
          <div
            className="relative flex min-h-44 min-w-0 flex-1 items-stretch gap-1 border-b border-[var(--color-border)] px-1 pt-2 sm:min-h-48 sm:gap-2 sm:px-2"
            role="img"
            aria-label={t('overview.cashFlow')}
            aria-describedby="overview-cashflow-data"
          >
            <span className="border-border/50 pointer-events-none absolute inset-x-1 top-1/4 border-t border-dashed" />
            <span className="border-border/50 pointer-events-none absolute inset-x-1 top-1/2 border-t border-dashed" />
            <span className="border-border/50 pointer-events-none absolute inset-x-1 top-3/4 border-t border-dashed" />
            {months.map((month) => (
              <div
                key={month.key}
                className="relative z-1 flex min-w-0 flex-1 items-end justify-center gap-1"
              >
                <span
                  className="bg-success w-[38%] max-w-6 rounded-t-[3px]"
                  style={{ height: `${(month.income / maxValue) * 100}%` }}
                  title={`${month.label} ${t('analytics.income')}: ${formatMoney(month.income, displayCurrency, locale)}`}
                />
                <span
                  className="w-[38%] max-w-6 rounded-t-[3px]"
                  style={{
                    height: `${(month.expenses / maxValue) * 100}%`,
                    backgroundColor: 'var(--color-chart-3)',
                  }}
                  title={`${month.label} ${t('analytics.expenses')}: ${formatMoney(month.expenses, displayCurrency, locale)}`}
                />
                <span
                  className="text-muted-foreground absolute inset-x-0 top-[calc(100%+7px)] truncate text-center text-[11px]"
                  title={month.label}
                >
                  {month.label}
                </span>
              </div>
            ))}
          </div>
          <div className="text-muted-foreground mt-7 flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span>
              <i className="bg-success mr-1.5 inline-block h-2 w-2 rounded-sm" aria-hidden="true" />
              {t('analytics.income')}
            </span>
            <span>
              <i
                className="mr-1.5 inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: 'var(--color-chart-3)' }}
                aria-hidden="true"
              />
              {t('analytics.expenses')}
            </span>
          </div>
          <div className="sr-only">
            <table id="overview-cashflow-data">
              <caption>{t('overview.cashFlow')}</caption>
              <thead>
                <tr>
                  <th>{t('analytics.month')}</th>
                  <th>{t('analytics.income')}</th>
                  <th>{t('analytics.expenses')}</th>
                  <th>{t('analytics.net')}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((month) => (
                  <tr key={month.key}>
                    <th>{month.label}</th>
                    <td>{formatMoney(month.income, displayCurrency, locale)}</td>
                    <td>{formatMoney(month.expenses, displayCurrency, locale)}</td>
                    <td>{formatMoney(month.net, displayCurrency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{body}</div>
  }

  return (
    <NativePanel className="p-5 sm:p-6" aria-labelledby="overview-cashflow-heading">
      {body}
    </NativePanel>
  )
}
