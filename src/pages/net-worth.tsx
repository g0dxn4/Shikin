import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Landmark, CreditCard, BarChart3 } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { ChartContainer } from '@/components/ui/chart-container'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { useNetWorthStore } from '@/stores/net-worth-store'
import { formatMoney } from '@/lib/money'
import { CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE } from '@/lib/constants'
import dayjs from 'dayjs'

const PERIODS = [
  { label: '3M', value: '3m' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: 'ALL', value: 'all' },
]

export function NetWorth() {
  const { t } = useTranslation('analytics')
  const [period, setPeriod] = useState('1y')
  const {
    totalAssets,
    totalLiabilities,
    totalInvestments,
    netWorth,
    assetBreakdown,
    liabilityBreakdown,
    history,
    isLoading,
    refresh,
  } = useNetWorthStore()

  useEffect(() => {
    refresh(period)
  }, [period, refresh])

  // Calculate change from first history point
  const firstPoint = history.length > 0 ? history[0] : null
  const lastPoint = history.length > 1 ? history[history.length - 1] : null
  const changeAmount = lastPoint && firstPoint ? lastPoint.netWorth - firstPoint.netWorth : 0
  const changePercent =
    firstPoint && firstPoint.netWorth !== 0
      ? ((changeAmount / Math.abs(firstPoint.netWorth)) * 100).toFixed(1)
      : '0'
  const isPositiveChange = changeAmount >= 0

  // Build asset/liability percent breakdowns
  const totalAssetsAbs = Math.abs(totalAssets)
  const totalLiabilitiesAbs = Math.abs(totalLiabilities)

  if (isLoading) {
    return (
      <div className="animate-fade-in-up page-content" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <div className="liquid-card page-header p-5">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              {t('netWorth.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('netWorth.description')}</p>
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    )
  }

  const hasData = assetBreakdown.length > 0 || liabilityBreakdown.length > 0

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header p-5">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{t('netWorth.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('netWorth.description')}</p>
        </div>
      </div>

      {/* Hero metric */}
      <div className="liquid-hero p-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('netWorth.currentNetWorth')}
            </p>
            <p className="font-heading mt-2 text-4xl font-bold tracking-tight md:text-5xl">
              {formatMoney(netWorth)}
            </p>
            {history.length > 1 && (
              <div className="mt-3 flex items-center gap-2">
                {isPositiveChange ? (
                  <TrendingUp size={16} className="text-success" aria-hidden="true" />
                ) : (
                  <TrendingDown size={16} className="text-destructive" aria-hidden="true" />
                )}
                <span className={isPositiveChange ? 'text-success' : 'text-destructive'}>
                  {isPositiveChange ? '+' : ''}
                  {formatMoney(Math.round(changeAmount * 100))} ({changePercent}%)
                </span>
              </div>
            )}
          </div>
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(124, 92, 255, 0.16)' }}
          >
            <Landmark size={24} className="text-accent" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Chart */}
      <ChartContainer
        title={t('netWorth.chartTitle')}
        periods={PERIODS}
        selectedPeriod={period}
        onPeriodChange={setPeriod}
      >
        {history.length > 1 ? (
          <div className="h-48" role="img" aria-label={t('netWorth.chartTitle')}>
            <SafeChart>
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C5CFF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7C5CFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#A9A9B4', fontSize: 10 }}
                  tickFormatter={(d) => dayjs(d).format('MMM D')}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#A9A9B4', fontSize: 10 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  itemStyle={CHART_ITEM_STYLE}
                  labelStyle={CHART_LABEL_STYLE}
                  labelFormatter={(d) => dayjs(d).format('MMM D, YYYY')}
                  formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Net Worth']}
                />
                <Area
                  type="monotone"
                  dataKey="netWorth"
                  stroke="#7C5CFF"
                  strokeWidth={2}
                  fill="url(#netWorthGrad)"
                />
              </AreaChart>
            </SafeChart>
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-xl bg-white/[0.02]">
            <div className="text-center">
              <BarChart3
                size={24}
                className="text-muted-foreground mx-auto mb-2"
                aria-hidden="true"
              />
              <p className="text-muted-foreground text-xs">
                {history.length === 1 ? t('netWorth.firstSnapshot') : t('netWorth.noHistory')}
              </p>
            </div>
          </div>
        )}
      </ChartContainer>

      {/* Assets & Liabilities */}
      {hasData ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Assets */}
          <div className="liquid-card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Landmark size={16} className="text-success" aria-hidden="true" />
                <h3 className="font-heading text-sm font-semibold">{t('netWorth.assets')}</h3>
              </div>
              <span className="font-heading text-success text-lg font-bold">
                {formatMoney(totalAssets)}
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
                  totalAssetsAbs > 0 ? (Math.abs(asset.balance) / totalAssetsAbs) * 100 : 0
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
          </div>

          {/* Liabilities */}
          <div className="liquid-card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-destructive" aria-hidden="true" />
                <h3 className="font-heading text-sm font-semibold">{t('netWorth.liabilities')}</h3>
              </div>
              <span className="font-heading text-destructive text-lg font-bold">
                {formatMoney(totalLiabilities)}
              </span>
            </div>
            <div className="space-y-3">
              {liabilityBreakdown.length > 0 ? (
                liabilityBreakdown.map((liability) => {
                  const percent =
                    totalLiabilitiesAbs > 0
                      ? (Math.abs(liability.balance) / totalLiabilitiesAbs) * 100
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
          </div>
        </div>
      ) : (
        <div className="liquid-card flex h-32 items-center justify-center p-5">
          <p className="text-muted-foreground text-sm">{t('netWorth.addAccountsPrompt')}</p>
        </div>
      )}
    </div>
  )
}
