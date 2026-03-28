import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Landmark, CreditCard, BarChart3 } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { MetricCard } from '@/components/ui/metric-card'
import { ChartContainer } from '@/components/ui/chart-container'
import { PageHeader } from '@/components/ui/page-header'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { useNetWorthStore } from '@/stores/net-worth-store'
import { formatMoney } from '@/lib/money'
import dayjs from 'dayjs'

const PERIODS = [
  { label: '3M', value: '3m' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: 'ALL', value: 'all' },
]

export function NetWorth() {
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
    loadHistory,
  } = useNetWorthStore()

  useEffect(() => {
    refresh(period)
  }, [])

  useEffect(() => {
    loadHistory(period)
  }, [period])

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
      <div className="animate-fade-in-up page-content">
        <PageHeader title="Net Worth" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
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
      <PageHeader title="Net Worth" />

      {/* Hero metric */}
      <MetricCard
        icon={
          isPositiveChange ? (
            <TrendingUp size={16} className="text-accent" />
          ) : (
            <TrendingDown size={16} className="text-destructive" />
          )
        }
        label="Total Net Worth"
        value={formatMoney(netWorth)}
        change={
          history.length > 1
            ? {
                value: `${formatMoney(Math.round(changeAmount * 100))} (${changePercent}%)`,
                positive: isPositiveChange,
              }
            : undefined
        }
        className="border-accent/10 border"
      />

      {/* Chart */}
      <ChartContainer
        title="Net Worth Over Time"
        periods={PERIODS}
        selectedPeriod={period}
        onPeriodChange={setPeriod}
      >
        {history.length > 1 ? (
          <div className="h-48">
            <SafeChart>
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#bf5af2" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#bf5af2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickFormatter={(d) => dayjs(d).format('MMM D')}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0a0a0a',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#6b7280' }}
                  labelFormatter={(d) => dayjs(d).format('MMM D, YYYY')}
                  formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Net Worth']}
                />
                <Area
                  type="monotone"
                  dataKey="netWorth"
                  stroke="#bf5af2"
                  strokeWidth={2}
                  fill="url(#netWorthGrad)"
                />
              </AreaChart>
            </SafeChart>
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center rounded bg-white/[0.02]">
            <div className="text-center">
              <BarChart3 size={24} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground text-xs">
                {history.length === 1
                  ? 'First snapshot recorded. Come back tomorrow for trend data.'
                  : 'No history yet. Add accounts to start tracking net worth.'}
              </p>
            </div>
          </div>
        )}
      </ChartContainer>

      {/* Assets & Liabilities */}
      {hasData ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Assets */}
          <div className="glass-card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Landmark size={16} className="text-success" />
                <h3 className="font-heading text-sm font-semibold">Assets</h3>
              </div>
              <span className="font-heading text-success text-lg font-bold">
                {formatMoney(totalAssets)}
              </span>
            </div>
            {totalInvestments > 0 && (
              <div className="text-muted-foreground text-xs">
                Includes {formatMoney(totalInvestments)} in investments
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
                    <ProgressBar value={percent} color="success" size="sm" />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Liabilities */}
          <div className="glass-card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-destructive" />
                <h3 className="font-heading text-sm font-semibold">Liabilities</h3>
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
                      <ProgressBar value={percent} color="destructive" size="sm" />
                    </div>
                  )
                })
              ) : (
                <p className="text-muted-foreground text-sm">No liabilities. Nice!</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-card flex h-32 items-center justify-center p-5">
          <p className="text-muted-foreground text-sm">
            Add accounts to see your asset and liability breakdown.
          </p>
        </div>
      )}
    </div>
  )
}
