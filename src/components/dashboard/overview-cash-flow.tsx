import { useTranslation } from 'react-i18next'
import { NativePanel } from '@/components/ui/native-layout'
import { formatMoney } from '@/lib/money'
import type { TrendMonth } from '@/lib/dashboard-analytics'

interface OverviewCashFlowProps {
  months: TrendMonth[]
  displayCurrency: string
  unavailable?: boolean
  unavailableMessage?: string
}

export function OverviewCashFlow({
  months,
  displayCurrency,
  unavailable = false,
  unavailableMessage,
}: OverviewCashFlowProps) {
  const { t } = useTranslation('dashboard')
  const maxValue = Math.max(1, ...months.flatMap((month) => [month.income, month.expenses]))

  return (
    <NativePanel className="p-5 sm:p-6" aria-labelledby="overview-cashflow-heading">
      <div className="mb-4">
        <h2 id="overview-cashflow-heading" className="text-base font-semibold">
          {t('overview.cashFlow')}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('overview.cashFlowSubtitle')}</p>
      </div>

      {unavailable ? (
        <p className="text-warning py-10 text-center text-sm" role="status">
          {unavailableMessage ?? t('currency.derivedUnavailable')}
        </p>
      ) : (
        <>
          <div
            className="relative flex h-48 items-stretch gap-2 border-b border-[var(--color-border)] pt-2 pr-1 pl-10"
            role="img"
            aria-label={t('overview.cashFlow')}
            aria-describedby="overview-cashflow-data"
          >
            {months.map((month) => (
              <div key={month.key} className="relative flex flex-1 items-end justify-center gap-1">
                <span
                  className="bg-success min-h-0.5 w-[42%] max-w-6 rounded-t-sm"
                  style={{ height: `${Math.max(2, (month.income / maxValue) * 100)}%` }}
                  title={`${month.label} ${t('analytics.income')}: ${formatMoney(month.income, displayCurrency)}`}
                />
                <span
                  className="min-h-0.5 w-[42%] max-w-6 rounded-t-sm"
                  style={{
                    height: `${Math.max(2, (month.expenses / maxValue) * 100)}%`,
                    backgroundColor: 'var(--color-chart-3)',
                  }}
                  title={`${month.label} ${t('analytics.expenses')}: ${formatMoney(month.expenses, displayCurrency)}`}
                />
                <span className="text-muted-foreground absolute top-[calc(100%+6px)] text-[11px]">
                  {month.label}
                </span>
              </div>
            ))}
          </div>
          <div className="text-muted-foreground mt-7 flex gap-4 text-[11px]">
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
          <table id="overview-cashflow-data" className="sr-only">
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
                  <td>{formatMoney(month.income, displayCurrency)}</td>
                  <td>{formatMoney(month.expenses, displayCurrency)}</td>
                  <td>{formatMoney(month.net, displayCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </NativePanel>
  )
}
