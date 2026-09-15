import { PageToolbar } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { useAccountStore } from '@/stores/account-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, TrendingDown, TrendingUp, Flame, DollarSign, Calendar } from 'lucide-react'
import dayjs from 'dayjs'
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useForecastStore } from '@/stores/forecast-store'
import { formatMoney } from '@/lib/money'
import { query } from '@/lib/database'
import {
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_LEGEND_STYLE,
} from '@/lib/constants'

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
    forecast,
    error,
    isLoading,
    selectedRange,
    setRange,
    generateForecast,
    accountId,
    setAccount,
  } = useForecastStore()
  const { accounts, fetch: fetchAccounts, fetchError: accountsError } = useAccountStore()
  const { preferredCurrency, rates, invalidRates } = useCurrencyStore()
  const money = (amount: number) => formatMoney(amount, forecast?.currency ?? preferredCurrency)
  useEffect(() => {
    void fetchAccounts().catch(() => {})
  }, [fetchAccounts])

  useEffect(() => {
    generateForecast()
  }, [generateForecast, preferredCurrency, rates, invalidRates])

  const chartData = useMemo(() => {
    if (!forecast) return []
    return forecast.points.map((p) => ({
      date: dayjs(p.date).format('MMM D'),
      fullDate: p.date,
      projected: p.projected,
      optimistic: p.optimistic,
      pessimistic: p.pessimistic,
    }))
  }, [forecast])

  const ranges = [30, 60, 90] as const
  const endPoint = forecast?.points[forecast.points.length - 1]

  return (
    <div className="page-content">
      <PageToolbar
        leading={
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            {t('scope.account')}
            <select
              className="bg-background text-foreground border-border min-h-10 rounded-lg border px-3"
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
          <div className="flex gap-1" role="group" aria-label={t('range.label')}>
            {ranges.map((r) => (
              <Button
                key={r}
                variant={selectedRange === r ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRange(r)}
                aria-pressed={selectedRange === r}
              >
                {t(`range.${r}`)}
              </Button>
            ))}
          </div>
        }
      />
      <p className="text-muted-foreground text-xs">
        {t('scope.description', { currency: preferredCurrency })}
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
        <ErrorBanner
          title={t('currency.unavailable')}
          message={t('currency.missing', { currencies: forecast.missingCurrencies.join(', ') })}
        />
      )}
      {forecast?.complete && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="native-panel relative min-h-[420px] overflow-hidden p-5 sm:p-6">
            <h2 className="mb-4 text-base font-semibold">{t('chart.title')}</h2>
            <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
              <div>
                <span className="text-muted-foreground text-[10px] tracking-wider uppercase tabular-nums">
                  {t('metrics.projectedEnd')}
                </span>
                <p
                  className={`mt-2 text-2xl font-semibold tabular-nums ${
                    (endPoint?.projected ?? 0) < 0 ? 'text-destructive' : ''
                  }`}
                >
                  {money(endPoint?.projected ?? 0)}
                </p>
              </div>
              <div className="border-border bg-muted/50 rounded-xl border p-3">
                <DollarSign size={24} className="text-accent" aria-hidden="true" />
              </div>
            </div>

            {chartData.length > 0 && (
              <div className="relative z-10 h-72" aria-label={t('chart.title')}>
                <SafeChart>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="forecastProjectedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                      tickFormatter={(v) => money(Number(v))}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      itemStyle={CHART_ITEM_STYLE}
                      labelStyle={CHART_LABEL_STYLE}
                      formatter={(value) => money(Number(value))}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, ...CHART_LEGEND_STYLE }} />
                    <Area
                      type="monotone"
                      dataKey="optimistic"
                      isAnimationActive={false}
                      name={t('chart.optimistic')}
                      stroke="var(--color-success)"
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                      fill="none"
                    />
                    <Area
                      type="monotone"
                      dataKey="projected"
                      isAnimationActive={false}
                      name={t('chart.projected')}
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#forecastProjectedGrad)"
                    />
                    <Area
                      type="monotone"
                      dataKey="pessimistic"
                      isAnimationActive={false}
                      name={t('chart.pessimistic')}
                      stroke="var(--color-destructive)"
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                      fill="none"
                    />
                  </AreaChart>
                </SafeChart>
              </div>
            )}
            <details className="mt-4">
              <summary className="text-primary cursor-pointer text-xs">{t('chart.data')}</summary>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">{t('chart.title')}</caption>
                  <thead>
                    <tr>
                      {(['date', 'projected', 'optimistic', 'pessimistic'] as const).map((key) => (
                        <th className="p-2" scope="col" key={key}>
                          {t(`chart.${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((point) => (
                      <tr key={point.fullDate}>
                        <th scope="row" className="p-2 font-normal">
                          {point.fullDate}
                        </th>
                        <td>{money(point.projected)}</td>
                        <td>{money(point.optimistic)}</td>
                        <td>{money(point.pessimistic)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          <div className="space-y-3">
            <MetricCard
              icon={<DollarSign size={16} />}
              iconColor="text-primary"
              label={t('metrics.currentBalance')}
              value={money(forecast.currentBalance)}
            />
            <MetricCard
              icon={<TrendingDown size={16} />}
              iconColor="text-destructive"
              label={t('metrics.lowestProjected')}
              value={money(forecast.minBalance.amount)}
              valueColor={forecast.minBalance.amount < 0 ? 'text-destructive' : ''}
            />
            <MetricCard
              icon={<Calendar size={16} />}
              iconColor="text-muted-foreground"
              label={t('metrics.lowestDate')}
              value={dayjs(forecast.minBalance.date).format('MMM D, YYYY')}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <MetricCard
                icon={<Flame size={16} />}
                iconColor="text-warning"
                label={t('metrics.dailyBurn')}
                value={money(forecast.dailyBurnRate)}
              />
              <MetricCard
                icon={<TrendingUp size={16} />}
                iconColor="text-success"
                label={t('metrics.dailyIncome')}
                value={money(forecast.dailyIncome)}
              />
            </div>
            <div
              className={`native-panel border p-4 ${
                forecast.dangerDates.length > 0
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-success/30 bg-success/5'
              }`}
              role={forecast.dangerDates.length > 0 ? 'alert' : 'status'}
            >
              <div className="mb-2 flex items-center gap-2">
                {forecast.dangerDates.length > 0 ? (
                  <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />
                ) : (
                  <TrendingUp size={16} className="text-success" aria-hidden="true" />
                )}
                <h3
                  className={`text-sm font-semibold ${
                    forecast.dangerDates.length > 0 ? 'text-destructive' : 'text-success'
                  }`}
                >
                  {forecast.dangerDates.length > 0 ? t('danger.title') : t('danger.noDanger')}
                </h3>
              </div>
              {forecast.dangerDates.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm">
                    {t('danger.balanceBelowZero', {
                      date: dayjs(forecast.dangerDates[0]).format('MMM D, YYYY'),
                    })}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t('danger.lowestPoint', {
                      amount: money(forecast.minBalance.amount),
                      date: dayjs(forecast.minBalance.date).format('MMM D, YYYY'),
                    })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
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
      <div className="native-panel p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="native-panel p-5">
      <h2 className="mb-4 text-base font-semibold">{t('table.title')}</h2>
      <ErrorBanner title={t('error.subscriptions')} message={error} />
      {subscriptions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('table.noSubscriptions')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th scope="col" className="pb-2 font-medium">
                  {t('table.name')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('table.amount')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('table.frequency')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('table.nextDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="border-border border-b last:border-0">
                  <td className="py-2.5 font-medium">{sub.name}</td>
                  <td className="py-2.5">{formatMoney(sub.amount, sub.currency)}</td>
                  <td className="py-2.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {sub.billing_cycle}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground py-2.5 text-xs tabular-nums">
                    {dayjs(sub.next_billing_date).format('MMM D, YYYY')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
      } catch (error) {
        if (active) {
          setSubscriptions([])
          setError(error instanceof Error ? error.message : String(error))
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

function MetricCard({
  icon,
  iconColor,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="native-panel p-5">
      <div className="text-muted-foreground mb-2 flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <span className="text-[10px] tracking-wider uppercase tabular-nums">{label}</span>
      </div>
      <p className={`text-lg font-bold tracking-tight ${valueColor || ''}`}>{value}</p>
    </div>
  )
}

function ForecastSkeleton() {
  const { t } = useTranslation('common')
  return (
    <div className="page-content" role="status" aria-busy="true">
      <span className="sr-only">{t('status.loading')}</span>
      <div className="native-panel page-header min-h-[72px] p-3 sm:p-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="native-panel space-y-5 p-5 sm:p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-56" />
          <Skeleton className="h-72 w-full" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="native-panel space-y-3 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
            </div>
          ))}
          <div className="native-panel space-y-3 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
      <div className="native-panel p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-80 w-full" />
      </div>
    </div>
  )
}
