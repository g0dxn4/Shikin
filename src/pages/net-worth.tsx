import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Landmark, CreditCard, BarChart3 } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
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
        <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
          <div>
            <h1 className="font-heading text-[28px] font-bold tracking-tight">
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
      <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
        <div>
          <h1 className="font-heading text-[28px] font-bold tracking-tight">
            {t('netWorth.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('netWorth.description')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="liquid-hero relative min-h-[360px] overflow-hidden p-6 sm:p-8">
          <BarChart3
            size={280}
            className="pointer-events-none absolute -right-16 -bottom-24 text-white/[0.035]"
            aria-hidden="true"
          />
          <div className="relative z-10 mb-6 flex items-start justify-between gap-4">
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
                    {formatMoney(Math.round(changeAmount))} ({changePercent}%)
                  </span>
                </div>
              )}
            </div>
            <div className="bg-accent/15 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
              <Landmark size={24} className="text-accent" aria-hidden="true" />
            </div>
          </div>

          {history.length > 1 ? (
            <div className="relative z-10 h-52" role="img" aria-label={t('netWorth.chartTitle')}>
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
                    tickFormatter={(v) => formatMoney(Number(v))}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    itemStyle={CHART_ITEM_STYLE}
                    labelStyle={CHART_LABEL_STYLE}
                    labelFormatter={(d) => dayjs(d).format('MMM D, YYYY')}
                    formatter={(value) => [formatMoney(Number(value)), 'Net Worth']}
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
            <div className="relative z-10 flex h-52 items-center justify-center rounded-[22px] bg-white/[0.035]">
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
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <div className="liquid-card p-5">
            <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('netWorth.assets')}
            </p>
            <p className="font-heading text-success mt-2 text-2xl font-bold tracking-tight">
              {formatMoney(totalAssets)}
            </p>
          </div>
          <div className="liquid-card p-5">
            <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('netWorth.liabilities')}
            </p>
            <p className="font-heading text-destructive mt-2 text-2xl font-bold tracking-tight">
              {formatMoney(totalLiabilities)}
            </p>
          </div>
          <div className="liquid-card p-5 sm:col-span-2 xl:col-span-1">
            <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('netWorth.chartTitle')}
            </p>
            <div
              className="mt-3 flex flex-wrap gap-1"
              role="group"
              aria-label={t('netWorth.chartTitle')}
            >
              {PERIODS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={period === item.value}
                  onClick={() => setPeriod(item.value)}
                  className={`focus-visible:ring-accent rounded-full px-3 py-1.5 font-mono text-[10px] transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                    period === item.value
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground bg-white/[0.04]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

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
