import { PageToolbar, MetricStrip, MetricItem, NativePanel } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ForecastProjectionChart } from '@/components/planning-scenarios/forecast-projection-chart'
import { useAccountStore } from '@/stores/account-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useForecastStore } from '@/stores/forecast-store'
import { formatMoney } from '@/lib/money'
import { query } from '@/lib/database'
import { cn } from '@/lib/utils'

interface SubscriptionDisplay {
  id: string
  name: string
  amount: number
  currency: string
  billing_cycle: string
  next_billing_date: string
}

export function Forecast() {
  const { t } = useTranslation('forecast')
  const {
    forecast: storedForecast,
    error,
    isLoading,
    selectedRange,
    setRange,
    generateForecast,
    accountId,
    setAccount,
  } = useForecastStore()
  const { accounts, fetch: fetchAccounts, fetchError: accountsError } = useAccountStore()
  const { preferredCurrency, mainCurrency, manualRates } = useCurrencyStore()
  const forecast =
    storedForecast?.authority.mainCurrency === mainCurrency &&
    storedForecast.authority.manualRates === manualRates
      ? storedForecast
      : null
  const money = (amount: number) => formatMoney(amount, forecast?.currency ?? preferredCurrency)
  useEffect(() => {
    void fetchAccounts().catch(() => {})
  }, [fetchAccounts])

  useEffect(() => {
    generateForecast()
  }, [generateForecast, preferredCurrency, mainCurrency, manualRates])

  const ranges = [30, 60, 90] as const
  const endPoint = forecast?.complete ? forecast.points[forecast.points.length - 1] : undefined
  const firstPoint = forecast?.complete ? forecast.points[0] : undefined

  return (
    <div className="page-content min-w-0">
      <PageToolbar
        leading={
          <label className="text-muted-foreground flex w-full min-w-0 flex-col gap-1 text-xs sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <span>{t('scope.account')}</span>
            <select
              className="border-input bg-surface text-foreground focus-visible:ring-ring min-h-11 w-full min-w-0 rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none sm:w-auto sm:max-w-xs"
              value={accountId ?? ''}
              onChange={(event) => setAccount(event.target.value || undefined)}
            >
              <option value="">{t('scope.allAccounts')}</option>
              {accounts
                .filter((account) => !account.is_archived)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                  </option>
                ))}
            </select>
          </label>
        }
        actions={
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('range.label')}>
            {ranges.map((range) => (
              <Button
                key={range}
                variant={selectedRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRange(range)}
                aria-pressed={selectedRange === range}
                className="min-h-11 min-w-11"
              >
                {t(`range.${range}`)}
              </Button>
            ))}
          </div>
        }
      />
      <p className="text-muted-foreground min-w-0 text-xs break-words">
        {t('scope.description', { currency: forecast?.currency || mainCurrency || '—' })}
        {' · '}
        {t('currency.estimate', { date: forecast?.estimateAsOf ?? dayjs().format('YYYY-MM-DD') })}
      </p>
      <ErrorBanner
        title={t('error.load')}
        message={error || accountsError}
        onRetry={() => {
          void generateForecast()
          void fetchAccounts().catch(() => {})
        }}
      />
      {isLoading && <ForecastSkeleton />}
      {forecast && !forecast.complete && (
        <div className="min-w-0 space-y-2">
          <ErrorBanner
            title={t('currency.unavailable')}
            message={
              !mainCurrency
                ? t('currency.unconfigured')
                : t('currency.missing', { currencies: forecast.missingCurrencies.join(', ') })
            }
          />
          <p className="text-muted-foreground text-xs break-words">
            {t('currency.nativeHistory', {
              amounts:
                forecast.evidence.nativeTotals
                  .map((row) => formatMoney(row.amountCentavos, row.currency))
                  .join(' · ') || '—',
            })}
          </p>
          <p className="text-muted-foreground text-xs break-words">
            {t('currency.nativeBalances', {
              amounts:
                forecast.nativeBalances
                  .map((row) => formatMoney(row.amountCentavos, row.currency))
                  .join(' · ') || '—',
            })}
          </p>
        </div>
      )}
      {forecast?.complete && (
        <>
          <NativePanel data-testid="forecast-hero" className="min-w-0 p-4 sm:p-5">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {t('metrics.currentBalance')}
                </p>
                <p className="mt-1 text-3xl font-medium tracking-tight break-all tabular-nums">
                  {money(forecast.currentBalance)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs break-words">
                  {t('metrics.asOf', {
                    date: dayjs(forecast.estimateAsOf).format('MMM D, YYYY'),
                  })}
                </p>
              </div>
              <div className="min-w-0 sm:text-right">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {t('metrics.projectedEnd')}
                </p>
                <p
                  className={cn(
                    'mt-1 text-3xl font-medium tracking-tight break-all tabular-nums',
                    endPoint && endPoint.projected < 0 && 'text-destructive'
                  )}
                >
                  {endPoint ? money(endPoint.projected) : '—'}
                </p>
                <p className="text-muted-foreground mt-1 text-xs break-words">
                  {firstPoint && endPoint
                    ? t('metrics.span', {
                        start: dayjs(firstPoint.date).format('MMM D, YYYY'),
                        end: dayjs(endPoint.date).format('MMM D, YYYY'),
                      })
                    : null}
                  {firstPoint && endPoint ? ' · ' : null}
                  {t(`range.${selectedRange}`)}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-3 text-xs break-words">
              {t('hero.estimateNote')}
            </p>

            {forecast.points.length > 0 ? (
              <div className="mt-5">
                <h2 className="mb-3 text-sm font-semibold">{t('chart.title')}</h2>
                <ForecastProjectionChart points={forecast.points} currency={forecast.currency} />
              </div>
            ) : null}
          </NativePanel>

          <MetricStrip className="min-w-0">
            <MetricItem
              label={t('metrics.currentBalance')}
              value={<span className="break-all">{money(forecast.currentBalance)}</span>}
            />
            <MetricItem
              label={t('metrics.lowestProjected')}
              value={
                <span
                  className={
                    forecast.minBalance.amount < 0 ? 'text-destructive break-all' : 'break-all'
                  }
                >
                  {money(forecast.minBalance.amount)}
                </span>
              }
              detail={`${t('metrics.lowestDate')}: ${dayjs(forecast.minBalance.date).format('MMM D, YYYY')}`}
            />
            <MetricItem
              label={t('metrics.dailyBurn')}
              value={<span className="break-all">{money(forecast.dailyBurnRate)}</span>}
            />
            <MetricItem
              label={t('metrics.dailyIncome')}
              value={<span className="break-all">{money(forecast.dailyIncome)}</span>}
            />
          </MetricStrip>

          <div
            className={cn(
              'rounded-lg border px-3 py-3',
              forecast.dangerDates.length > 0
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-success/30 bg-success/5'
            )}
            role={forecast.dangerDates.length > 0 ? 'alert' : 'status'}
          >
            <div className="flex items-center gap-2">
              {forecast.dangerDates.length > 0 ? (
                <AlertTriangle size={16} className="text-destructive shrink-0" aria-hidden="true" />
              ) : (
                <TrendingUp size={16} className="text-success shrink-0" aria-hidden="true" />
              )}
              <h3
                className={cn(
                  'text-sm font-semibold',
                  forecast.dangerDates.length > 0 ? 'text-destructive' : 'text-success'
                )}
              >
                {forecast.dangerDates.length > 0 ? t('danger.title') : t('danger.noDanger')}
              </h3>
            </div>
            {forecast.dangerDates.length > 0 ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm break-words">
                  {t('danger.balanceBelowZero', {
                    date: dayjs(forecast.dangerDates[0]).format('MMM D, YYYY'),
                  })}
                </p>
                <p className="text-muted-foreground text-sm break-words">
                  {t('danger.lowestPoint', {
                    amount: money(forecast.minBalance.amount),
                    date: dayjs(forecast.minBalance.date).format('MMM D, YYYY'),
                  })}
                </p>
              </div>
            ) : null}
          </div>
        </>
      )}

      <SubscriptionsTable accountId={accountId} />
    </div>
  )
}

function SubscriptionsTable({ accountId }: { accountId?: string }) {
  const { t } = useTranslation('forecast')

  const { subscriptions, isLoading, error } = useSubscriptions(accountId)

  if (isLoading) {
    return (
      <NativePanel className="min-w-0 p-4 sm:p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-32 w-full" />
      </NativePanel>
    )
  }

  return (
    <NativePanel className="min-w-0 p-4 sm:p-5">
      <h2 className="text-base font-semibold">{t('table.title')}</h2>
      <p className="text-muted-foreground mt-1 text-xs break-words">{t('table.independent')}</p>
      <ErrorBanner title={t('error.subscriptions')} message={error} />
      {subscriptions.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">{t('table.noSubscriptions')}</p>
      ) : (
        <div className="mt-4 max-w-full overflow-x-auto">
          <table className="w-max min-w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {t('table.name')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {t('table.amount')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {t('table.frequency')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {t('table.nextDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="border-border border-b last:border-0">
                  <td className="px-3 py-2.5 font-medium">{sub.name}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    {formatMoney(sub.amount, sub.currency)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Badge variant="secondary" className="text-[10px]">
                      {sub.billing_cycle}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 text-xs whitespace-nowrap tabular-nums">
                    {dayjs(sub.next_billing_date).format('MMM D, YYYY')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </NativePanel>
  )
}

function useSubscriptions(accountId?: string) {
  const [error, setError] = useState<string | null>(null)
  const [subscriptions, setSubscriptions] = useState<SubscriptionDisplay[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const rows = await query<SubscriptionDisplay>(
          `SELECT s.id, s.name, s.amount, s.currency, s.billing_cycle, s.next_billing_date
           FROM subscriptions s LEFT JOIN accounts a ON a.id = s.account_id
           WHERE s.is_active = 1 AND (s.account_id IS NULL OR a.is_archived = 0) ${accountId ? 'AND s.account_id = ?' : ''}
           ORDER BY next_billing_date ASC`,
          accountId ? [accountId] : []
        )
        if (active) setSubscriptions(rows)
      } catch (loadError) {
        if (active) {
          setSubscriptions([])
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [accountId])

  return { subscriptions, isLoading, error }
}

function ForecastSkeleton() {
  const { t } = useTranslation('common')
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t('status.loading')}</span>
      <NativePanel className="min-w-0 space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-40 max-w-full" />
          </div>
          <div className="space-y-2 sm:items-end">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-40 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      </NativePanel>
    </div>
  )
}
