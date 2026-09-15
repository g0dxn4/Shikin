import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Landmark, CreditCard } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricItem, MetricStrip, NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { useNetWorthStore } from '@/stores/net-worth-store'
import { formatMoney } from '@/lib/money'
import {
  CHART_AXIS_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'

const PERIODS = [{ value: '3m' }, { value: '6m' }, { value: '1y' }, { value: 'all' }] as const

export function NetWorth() {
  const { t } = useTranslation('analytics')
  const [period, setPeriod] = useState('1y')
  const {
    totalAssets,
    totalLiabilities,
    totalInvestments,
    netWorth,
    totalsComplete,
    missingCurrencies,
    assetBreakdown,
    liabilityBreakdown,
    history,
    isLoading,
    refresh,
  } = useNetWorthStore()

  useEffect(() => {
    refresh(period)
  }, [period, refresh])

  const firstPoint = history.length > 0 ? history[0] : null
  const lastPoint = history.length > 1 ? history[history.length - 1] : null
  const changeAmount = lastPoint && firstPoint ? lastPoint.netWorth - firstPoint.netWorth : 0
  const changePercent =
    firstPoint && firstPoint.netWorth !== 0
      ? ((changeAmount / Math.abs(firstPoint.netWorth)) * 100).toFixed(1)
      : '0'
  const isPositiveChange = changeAmount >= 0
  const totalAssetsAbs = Math.abs(totalAssets)
  const totalLiabilitiesAbs = Math.abs(totalLiabilities)
  const hasData = assetBreakdown.length > 0 || liabilityBreakdown.length > 0

  if (isLoading) {
    return (
      <div className="page-content" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageToolbar
        leading={<p className="text-muted-foreground text-sm">{t('netWorth.description')}</p>}
        actions={
          <div
            className="border-border bg-muted flex rounded-lg border p-0.5"
            role="group"
            aria-label={t('netWorth.historyPeriod')}
          >
            {PERIODS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={period === item.value}
                onClick={() => setPeriod(item.value)}
                className={cn(
                  'min-w-11 rounded-md px-2.5 py-1.5 text-xs font-semibold',
                  period === item.value
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(`netWorth.periods.${item.value}`)}
              </button>
            ))}
          </div>
        }
      />

      {!totalsComplete && (
        <div className="border-warning/30 bg-warning/10 text-warning rounded-xl border px-4 py-3 text-sm">
          {t('netWorth.incompleteTotals', { currencies: missingCurrencies.join(', ') })}
        </div>
      )}

      <MetricStrip>
        <MetricItem
          label={t('netWorth.currentNetWorth')}
          value={totalsComplete ? formatMoney(netWorth) : '—'}
          detail={
            history.length > 1 ? (
              <span className={isPositiveChange ? 'text-success' : 'text-destructive'}>
                {isPositiveChange ? (
                  <TrendingUp size={12} className="mr-1 inline" aria-hidden="true" />
                ) : (
                  <TrendingDown size={12} className="mr-1 inline" aria-hidden="true" />
                )}
                {isPositiveChange ? '+' : ''}
                {formatMoney(Math.round(changeAmount))} ({changePercent}%)
              </span>
            ) : null
          }
        />
        <MetricItem
          label={t('netWorth.assets')}
          value={totalsComplete ? formatMoney(totalAssets) : '—'}
        />
        <MetricItem
          label={t('netWorth.liabilities')}
          value={totalsComplete ? formatMoney(totalLiabilities) : '—'}
        />
      </MetricStrip>

      <NativePanel className="p-5 sm:p-6">
        <h2 className="text-base font-semibold">{t('netWorth.chartTitle')}</h2>
        {history.length > 1 ? (
          <>
            <div className="mt-4 h-56" role="img" aria-label={t('netWorth.chartTitle')}>
              <SafeChart>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                    tickFormatter={(d) => dayjs(d).format('MMM D')}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                    tickFormatter={(v) => formatMoney(Number(v))}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    itemStyle={CHART_ITEM_STYLE}
                    labelStyle={CHART_LABEL_STYLE}
                    labelFormatter={(d) => dayjs(d).format('MMM D, YYYY')}
                    formatter={(value) => [formatMoney(Number(value)), t('netWorth.title')]}
                  />
                  <Area
                    type="monotone"
                    dataKey="netWorth"
                    isAnimationActive={false}
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    fill="url(#netWorthGrad)"
                  />
                </AreaChart>
              </SafeChart>
            </div>
            <details className="mt-2">
              <summary className="text-accent cursor-pointer text-xs font-semibold">
                {t('netWorth.viewChartData')}
              </summary>
              <table className="mt-2 text-xs">
                <thead>
                  <tr>
                    <th className="pr-6 text-left font-medium">{t('netWorth.chartTitle')}</th>
                    <th className="text-left font-medium">{t('netWorth.currentNetWorth')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((point) => (
                    <tr key={point.date}>
                      <td className="py-0.5 pr-6">{dayjs(point.date).format('MMM D, YYYY')}</td>
                      <td className="tabular-nums">{formatMoney(point.netWorth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <div className="bg-muted mt-4 flex h-52 items-center justify-center rounded-xl">
            <p className="text-muted-foreground text-xs">
              {history.length === 1 ? t('netWorth.firstSnapshot') : t('netWorth.noHistory')}
            </p>
          </div>
        )}
      </NativePanel>

      {hasData ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <NativePanel className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Landmark size={16} className="text-success" aria-hidden="true" />
                <h3 className="text-sm font-semibold">{t('netWorth.assets')}</h3>
              </div>
              <span className="text-success text-lg font-bold tabular-nums">
                {totalsComplete ? formatMoney(totalAssets) : '—'}
              </span>
            </div>
            {totalInvestments > 0 && (
              <div className="text-muted-foreground text-xs">
                {t('netWorth.includesInvestments', { amount: formatMoney(totalInvestments) })}
              </div>
            )}
            <div className="space-y-3">
              {assetBreakdown.map((asset) => {
                const percent =
                  totalsComplete && totalAssetsAbs > 0 && asset.convertedBalance !== null
                    ? (asset.convertedBalance / totalAssetsAbs) * 100
                    : 0
                return (
                  <div key={asset.id} className="space-y-1">
                    <StatRow
                      label={asset.name}
                      value={formatMoney(asset.balance, asset.currency)}
                      valueColor="text-success"
                    />
                    <ProgressBar
                      value={percent}
                      color="success"
                      size="sm"
                      ariaLabel={`${asset.name} allocation`}
                    />
                  </div>
                )
              })}
            </div>
          </NativePanel>

          <NativePanel className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-destructive" aria-hidden="true" />
                <h3 className="text-sm font-semibold">{t('netWorth.liabilities')}</h3>
              </div>
              <span className="text-destructive text-lg font-bold tabular-nums">
                {totalsComplete ? formatMoney(totalLiabilities) : '—'}
              </span>
            </div>
            <div className="space-y-3">
              {liabilityBreakdown.length > 0 ? (
                liabilityBreakdown.map((liability) => {
                  const percent =
                    totalsComplete && totalLiabilitiesAbs > 0 && liability.convertedBalance !== null
                      ? (liability.convertedBalance / totalLiabilitiesAbs) * 100
                      : 0
                  return (
                    <div key={liability.id} className="space-y-1">
                      <StatRow
                        label={liability.name}
                        value={formatMoney(Math.abs(liability.balance), liability.currency)}
                        valueColor="text-destructive"
                      />
                      <ProgressBar
                        value={percent}
                        color="destructive"
                        size="sm"
                        ariaLabel={`${liability.name} allocation`}
                      />
                    </div>
                  )
                })
              ) : (
                <p className="text-muted-foreground text-sm">{t('netWorth.noLiabilities')}</p>
              )}
            </div>
          </NativePanel>
        </div>
      ) : (
        <NativePanel className="flex h-32 items-center justify-center p-5">
          <p className="text-muted-foreground text-sm">{t('netWorth.addAccountsPrompt')}</p>
        </NativePanel>
      )}
    </div>
  )
}
