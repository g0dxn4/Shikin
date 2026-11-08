import { PageToolbar, NativePanel } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ForecastProjectionChart } from '@/components/planning-scenarios/forecast-projection-chart'
import { useAccountStore } from '@/stores/account-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { currencyAuthorityKey } from '@/stores/currency-authority'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Info, TrendingUp } from 'lucide-react'
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

function StatusChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'warning'
}) {
  return (
    <li
      className={cn(
        'inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-medium break-words',
        tone === 'warning'
          ? 'border-warning/40 text-warning'
          : 'border-border bg-muted text-foreground'
      )}
    >
      {children}
    </li>
  )
}

function ForecastStatusChips({
  currency,
  estimateAsOf,
}: {
  currency: string
  estimateAsOf: string
}) {
  const { t } = useTranslation('forecast')
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={t('chips.label')}>
      <StatusChip>
        <span className="sr-only">{t('chips.currencyLabel', { currency })}</span>
        <span aria-hidden="true">{currency}</span>
      </StatusChip>
      <StatusChip>
        {t('metrics.asOf', { date: dayjs(estimateAsOf).format('MMM D, YYYY') })}
      </StatusChip>
      <StatusChip>{t('chips.estimate')}</StatusChip>
      <StatusChip tone="warning">{t('chips.notRecorded')}</StatusChip>
    </ul>
  )
}

function ForecastMethod({ currency, estimateAsOf }: { currency: string; estimateAsOf: string }) {
  const { t } = useTranslation('forecast')
  return (
    <details className="min-w-0">
      <summary className="focus-visible:ring-ring text-accent inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none">
        <Info size={14} aria-hidden="true" />
        {t('method.summary')}
      </summary>
      <div className="text-muted-foreground space-y-1.5 pb-1 text-xs break-words">
        <p>{t('scope.description', { currency })}</p>
        <p>{t('currency.estimate', { date: estimateAsOf })}</p>
        <p>{t('hero.estimateNote')}</p>
      </div>
    </details>
  )
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
  const authorityKey = currencyAuthorityKey({ mainCurrency, manualRates })
  const forecast =
    storedForecast && currencyAuthorityKey(storedForecast.authority) === authorityKey
      ? storedForecast
      : null
  const money = (amount: number) => formatMoney(amount, forecast?.currency ?? preferredCurrency)
  useEffect(() => {
    void fetchAccounts().catch(() => {})
  }, [fetchAccounts])

  useEffect(() => {
    generateForecast()
  }, [generateForecast, authorityKey])

  const ranges = [30, 60, 90] as const
  const endPoint = forecast?.complete ? forecast.points[forecast.points.length - 1] : undefined
  const firstPoint = forecast?.complete ? forecast.points[0] : undefined
  const displayCurrency = forecast?.currency || mainCurrency || '—'

  return (
    <div className="page-content min-w-0">
      <PageToolbar
        className="flex-col items-stretch sm:flex-row sm:items-center max-sm:[&>div]:w-full max-sm:[&>div]:min-w-0"
        leading={
          <label className="text-muted-foreground flex w-full min-w-0 flex-col gap-1 text-xs sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <span>{t('scope.account')}</span>
            <select
              className="border-input bg-surface text-foreground focus-visible:ring-ring min-h-11 w-full max-w-full min-w-0 rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none sm:w-auto sm:max-w-xs"
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
          <div
            className="flex max-w-full flex-wrap gap-1"
            role="group"
            aria-label={t('range.label')}
          >
            {ranges.map((range) => (
              <Button
                key={range}
                variant={selectedRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRange(range)}
                aria-pressed={selectedRange === range}
                className="min-h-11 min-w-11 shrink-0"
              >
                {t(`range.${range}`)}
              </Button>
            ))}
          </div>
        }
      />
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
          <ForecastStatusChips currency={displayCurrency} estimateAsOf={forecast.estimateAsOf} />
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
          <ForecastMethod currency={displayCurrency} estimateAsOf={forecast.estimateAsOf} />
        </div>
      )}
      {forecast?.complete && (
        <NativePanel data-testid="forecast-hero" className="min-w-0 p-3 sm:p-5">
          <ForecastStatusChips currency={displayCurrency} estimateAsOf={forecast.estimateAsOf} />
          {forecast.points.length > 0 ? (
            <div className="mt-3">
              <ForecastProjectionChart points={forecast.points} currency={forecast.currency} />
            </div>
          ) : null}
          <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {t('metrics.projectedEnd')}
              </p>
              <p
                className={cn(
                  'max-w-full overflow-x-auto text-2xl font-medium tracking-tight whitespace-nowrap tabular-nums',
                  endPoint && endPoint.projected < 0 && 'text-destructive'
                )}
              >
                {endPoint ? money(endPoint.projected) : '—'}
              </p>
            </div>
            <p className="text-muted-foreground min-w-0 text-xs break-words tabular-nums">
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
          <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-muted-foreground text-[11px]">{t('metrics.currentBalance')}</dt>
              <dd className="max-w-full overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums">
                {money(forecast.currentBalance)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-[11px]">{t('metrics.lowestProjected')}</dt>
              <dd
                className={cn(
                  'max-w-full overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums',
                  forecast.minBalance.amount < 0 && 'text-destructive'
                )}
              >
                {money(forecast.minBalance.amount)}
              </dd>
              <dd className="text-muted-foreground text-[11px] break-words">
                <span className="sr-only">{t('metrics.lowestDate')}: </span>
                {dayjs(forecast.minBalance.date).format('MMM D, YYYY')}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-[11px]">{t('metrics.dailyBurn')}</dt>
              <dd className="max-w-full overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums">
                {money(forecast.dailyBurnRate)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-[11px]">{t('metrics.dailyIncome')}</dt>
              <dd className="max-w-full overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums">
                {money(forecast.dailyIncome)}
              </dd>
            </div>
          </dl>
          <div
            className={cn(
              'mt-3 flex items-start gap-2 rounded-md border px-2.5 py-2',
              forecast.dangerDates.length > 0
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-success/30 bg-success/5'
            )}
            role={forecast.dangerDates.length > 0 ? 'alert' : 'status'}
          >
            {forecast.dangerDates.length > 0 ? (
              <AlertTriangle
                size={16}
                className="text-destructive mt-0.5 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <TrendingUp size={16} className="text-success mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <h3
                className={cn(
                  'text-sm font-semibold',
                  forecast.dangerDates.length > 0 ? 'text-destructive' : 'text-success'
                )}
              >
                {forecast.dangerDates.length > 0 ? t('danger.title') : t('danger.noDanger')}
              </h3>
              {forecast.dangerDates.length > 0 ? (
                <div className="mt-1 space-y-1">
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
          </div>
          <div className="mt-2">
            <ForecastMethod currency={displayCurrency} estimateAsOf={forecast.estimateAsOf} />
          </div>
        </NativePanel>
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
      <NativePanel className="min-w-0 space-y-3 p-3 sm:p-5">
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-52 w-full sm:h-72" />
        <Skeleton className="h-8 w-40 max-w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </NativePanel>
    </div>
  )
}
