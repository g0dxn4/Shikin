import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { AreaChart, Area, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useUIStore } from '@/stores/ui-store'
import { useInvestmentStore, type InvestmentWithPrice } from '@/stores/investment-store'
import { useAccountStore } from '@/stores/account-store'
import { formatMoney, fromCentavos } from '@/lib/money'
import { fetchAllCurrentPrices, savePricesToDB } from '@/lib/price-service'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const InvestmentDialog = lazy(() =>
  import('@/components/investments/investment-dialog').then((m) => ({
    default: m.InvestmentDialog,
  }))
)

const TIME_RANGES = ['1W', '1M', '3M', '6M', '1Y', 'All'] as const
type TimeRange = (typeof TIME_RANGES)[number]

const TYPE_COLORS: Record<string, string> = {
  stock: '#bf5af2',
  etf: '#5ac8fa',
  crypto: '#ffd60a',
  bond: '#30d158',
  mutual_fund: '#ff9f0a',
  other: '#71717a',
}

type SortField = 'value' | 'gainLoss' | 'name' | 'type'

export function Investments() {
  const { t } = useTranslation('investments')
  const { t: tCommon } = useTranslation('common')
  const { openInvestmentDialog } = useUIStore()
  const {
    investments,
    portfolioSummary,
    priceHistory,
    isLoading,
    lastPriceFetch,
    fetch: fetchInvestments,
    remove,
    fetchPriceHistory,
  } = useInvestmentStore()
  const { fetch: fetchAccounts } = useAccountStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRange>('3M')
  const [sortField, setSortField] = useState<SortField>('value')

  useEffect(() => {
    fetchInvestments()
    fetchAccounts()
  }, [fetchInvestments, fetchAccounts])

  // Fetch price history for chart when investments load
  useEffect(() => {
    if (investments.length > 0) {
      const symbols = [...new Set(investments.map((i) => i.symbol))]
      symbols.forEach((s) => fetchPriceHistory(s, 365))
    }
  }, [investments.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const prices = await fetchAllCurrentPrices(investments)
      if (prices.size > 0) {
        await savePricesToDB(prices)
        await fetchInvestments()
        toast.success(t('toast.pricesUpdated'))
      } else {
        toast.info(t('toast.noPrices'))
      }
    } catch {
      toast.error(t('toast.refreshError'))
    } finally {
      setIsRefreshing(false)
    }
  }

  // Portfolio value chart data
  const chartData = useMemo(() => {
    if (priceHistory.size === 0 || investments.length === 0) return []

    const daysMap: Record<string, number> = {
      '1W': 7,
      '1M': 30,
      '3M': 90,
      '6M': 180,
      '1Y': 365,
      All: 9999,
    }
    const maxDays = daysMap[timeRange]
    const cutoff = dayjs().subtract(maxDays, 'day').format('YYYY-MM-DD')

    // Collect all dates across all symbols
    const dateSet = new Set<string>()
    priceHistory.forEach((points) => {
      points.forEach((p) => {
        if (p.date >= cutoff) dateSet.add(p.date)
      })
    })

    const dates = [...dateSet].sort()

    return dates.map((date) => {
      let total = 0
      for (const inv of investments) {
        const history = priceHistory.get(inv.symbol)
        if (!history) continue
        // Find the closest price on or before this date
        let price = inv.avg_cost_basis
        for (const p of history) {
          if (p.date <= date) price = p.price
        }
        total += inv.shares * price
      }
      return { date, value: total }
    })
  }, [priceHistory, investments, timeRange])

  // Allocation chart data
  const allocationData = useMemo(() => {
    const { byType } = portfolioSummary
    return Object.entries(byType).map(([type, data]) => ({
      name: type,
      value: data.marketValue,
      color: TYPE_COLORS[type] || TYPE_COLORS.other,
    }))
  }, [portfolioSummary])

  // Sorted holdings
  const sortedInvestments = useMemo(() => {
    return [...investments].sort((a, b) => {
      switch (sortField) {
        case 'value':
          return (b.marketValue ?? 0) - (a.marketValue ?? 0)
        case 'gainLoss':
          return (b.gainLossPercent ?? 0) - (a.gainLossPercent ?? 0)
        case 'name':
          return a.name.localeCompare(b.name)
        case 'type':
          return a.type.localeCompare(b.type)
        default:
          return 0
      }
    })
  }, [investments, sortField])

  const isPriceStale = (lastDate: string | null) => {
    if (!lastDate) return true
    return dayjs().diff(dayjs(lastDate), 'hour') > 24
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in-up page-content">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="metric-card space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
        <div className="glass-card space-y-3 p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-60 w-full" />
        </div>
      </div>
    )
  }

  if (investments.length === 0) {
    return (
      <div className="animate-fade-in-up page-content">
        <div className="page-header">
          <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        </div>
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <TrendingUp size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={() => openInvestmentDialog()}>
            <Plus size={16} />
            {t('addInvestment')}
          </Button>
        </div>
        <Suspense>
          <InvestmentDialog />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up page-content">
      {/* Header */}
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => openInvestmentDialog()}>
          <Plus size={16} />
          {t('addInvestment')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <span className="text-primary">
              <TrendingUp size={16} />
            </span>
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('summary.portfolioValue')}
            </span>
          </div>
          <p className="font-heading text-2xl font-bold tracking-tight">
            {formatMoney(portfolioSummary.totalMarketValue)}
          </p>
        </div>

        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <span
              className={portfolioSummary.totalGainLoss >= 0 ? 'text-success' : 'text-destructive'}
            >
              {portfolioSummary.totalGainLoss >= 0 ? (
                <TrendingUp size={16} />
              ) : (
                <TrendingDown size={16} />
              )}
            </span>
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('summary.totalGainLoss')}
            </span>
          </div>
          <p
            className={`font-heading text-2xl font-bold tracking-tight ${
              portfolioSummary.totalGainLoss >= 0 ? 'text-success' : 'text-destructive'
            }`}
          >
            {portfolioSummary.totalGainLoss >= 0 ? '+' : ''}
            {formatMoney(portfolioSummary.totalGainLoss)}
            <span className="ml-2 text-base">
              ({portfolioSummary.totalGainLossPercent >= 0 ? '+' : ''}
              {portfolioSummary.totalGainLossPercent.toFixed(2)}%)
            </span>
          </p>
        </div>

        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <span className="text-primary">
              <Wallet size={16} />
            </span>
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('summary.costBasis')}
            </span>
          </div>
          <p className="font-heading text-2xl font-bold tracking-tight">
            {formatMoney(portfolioSummary.totalCostBasis)}
          </p>
        </div>

        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <span className="text-primary">
              <RefreshCw size={16} />
            </span>
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('summary.lastUpdated')}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {lastPriceFetch ? dayjs(lastPriceFetch).fromNow() : t('summary.never')}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {t('summary.refresh')}
          </Button>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Portfolio Value Chart */}
        <div className="glass-card col-span-1 p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-sm font-semibold">{t('chart.portfolioValue')}</h2>
            <div className="flex gap-1">
              {TIME_RANGES.map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`rounded-full px-2.5 py-1 font-mono text-[10px] transition-colors ${
                    timeRange === range
                      ? 'bg-accent/20 text-accent'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          {chartData.length > 0 ? (
            <SafeChart height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#bf5af2" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#bf5af2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d) => dayjs(d).format('MMM D')}
                />
                <YAxis
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(fromCentavos(v) / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(10,10,10,0.9)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number | undefined) => [formatMoney(value ?? 0), 'Value']}
                  labelFormatter={(label) => dayjs(label).format('MMM D, YYYY')}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#bf5af2"
                  strokeWidth={2}
                  fill="url(#valueGradient)"
                />
              </AreaChart>
            </SafeChart>
          ) : (
            <div className="flex h-[240px] items-center justify-center">
              <p className="text-muted-foreground text-sm">{t('chart.noData')}</p>
            </div>
          )}
        </div>

        {/* Allocation Donut */}
        <div className="glass-card p-5">
          <h2 className="font-heading mb-4 text-sm font-semibold">{t('chart.allocation')}</h2>
          {allocationData.length > 0 ? (
            <div className="flex flex-col items-center">
              <SafeChart height={200}>
                <PieChart>
                  <Pie
                    data={allocationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    dataKey="value"
                    stroke="none"
                  >
                    {allocationData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(10,10,10,0.9)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: number | undefined) => [formatMoney(value ?? 0), '']}
                  />
                </PieChart>
              </SafeChart>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {allocationData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
                    <span className="text-muted-foreground text-[10px] capitalize">
                      {t(`types.${entry.name}` as 'types.stock')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center">
              <p className="text-muted-foreground text-sm">{t('chart.noData')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Holdings */}
      <div className="glass-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold">{t('holdings.title')}</h2>
          <div className="flex gap-1">
            {(['value', 'gainLoss', 'name', 'type'] as SortField[]).map((field) => (
              <button
                key={field}
                onClick={() => setSortField(field)}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] transition-colors ${
                  sortField === field
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`holdings.sort.${field}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <div className="text-muted-foreground mb-2 grid grid-cols-8 gap-4 px-2 font-mono text-[10px] tracking-wider uppercase">
            <span className="col-span-2">{t('holdings.header.name')}</span>
            <span>{t('holdings.header.type')}</span>
            <span className="text-right">{t('holdings.header.shares')}</span>
            <span className="text-right">{t('holdings.header.avgCost')}</span>
            <span className="text-right">{t('holdings.header.price')}</span>
            <span className="text-right">{t('holdings.header.value')}</span>
            <span className="text-right">{t('holdings.header.gainLoss')}</span>
          </div>
          <div className="space-y-1">
            {sortedInvestments.map((inv) => (
              <HoldingRow
                key={inv.id}
                investment={inv}
                isStale={isPriceStale(inv.lastPriceDate)}
                onEdit={() => openInvestmentDialog(inv.id)}
                onDelete={() => setDeleteId(inv.id)}
                t={t}
              />
            ))}
          </div>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {sortedInvestments.map((inv) => (
            <HoldingCard
              key={inv.id}
              investment={inv}
              isStale={isPriceStale(inv.lastPriceDate)}
              onEdit={() => openInvestmentDialog(inv.id)}
              onDelete={() => setDeleteId(inv.id)}
              t={t}
            />
          ))}
        </div>
      </div>

      <Suspense>
        <InvestmentDialog />
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteInvestment')}
          description={t('deleteConfirm')}
          confirmLabel={tCommon('actions.delete')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
      </Suspense>
    </div>
  )
}

function HoldingRow({
  investment: inv,
  isStale,
  onEdit,
  onDelete,
  t,
}: {
  investment: InvestmentWithPrice
  isStale: boolean
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslation<'investments'>>['t']
}) {
  const gainPositive = (inv.gainLoss ?? 0) >= 0

  return (
    <div className="group grid grid-cols-8 items-center gap-4 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.02]">
      <div className="col-span-2 flex items-center gap-2">
        <div>
          <p className="font-heading text-sm font-semibold">{inv.symbol}</p>
          <p className="text-muted-foreground text-[10px]">{inv.name}</p>
        </div>
        {isStale && (
          <span title={t('holdings.stale')}>
            <AlertTriangle size={12} className="text-warning" />
          </span>
        )}
      </div>
      <div>
        <Badge variant="secondary" className="text-[10px]" style={{ color: TYPE_COLORS[inv.type] }}>
          {t(`types.${inv.type}`)}
        </Badge>
      </div>
      <p className="text-right font-mono text-sm">{inv.shares.toLocaleString()}</p>
      <p className="text-right font-mono text-sm">
        {formatMoney(inv.avg_cost_basis, inv.currency)}
      </p>
      <p className="text-right font-mono text-sm">
        {inv.currentPrice !== null ? formatMoney(inv.currentPrice, inv.currency) : '—'}
      </p>
      <p className="text-right font-mono text-sm font-semibold">
        {inv.marketValue !== null ? formatMoney(inv.marketValue, inv.currency) : '—'}
      </p>
      <div className="flex items-center justify-end gap-2">
        <div className="text-right">
          <p
            className={`font-mono text-sm font-semibold ${gainPositive ? 'text-success' : 'text-destructive'}`}
          >
            {inv.gainLoss !== null ? (
              <>
                {gainPositive ? '+' : ''}
                {formatMoney(inv.gainLoss, inv.currency)}
              </>
            ) : (
              '—'
            )}
          </p>
          {inv.gainLossPercent !== null && (
            <p
              className={`flex items-center justify-end gap-0.5 font-mono text-[10px] ${gainPositive ? 'text-success' : 'text-destructive'}`}
            >
              {gainPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {gainPositive ? '+' : ''}
              {inv.gainLossPercent.toFixed(2)}%
            </p>
          )}
        </div>
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-7 w-7"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function HoldingCard({
  investment: inv,
  isStale,
  onEdit,
  onDelete,
  t,
}: {
  investment: InvestmentWithPrice
  isStale: boolean
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslation<'investments'>>['t']
}) {
  const gainPositive = (inv.gainLoss ?? 0) >= 0

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div>
            <p className="font-heading text-base font-semibold">
              {inv.symbol}
              {isStale && <AlertTriangle size={12} className="text-warning ml-1 inline" />}
            </p>
            <p className="text-muted-foreground text-[10px]">{inv.name}</p>
          </div>
          <Badge
            variant="secondary"
            className="text-[10px]"
            style={{ color: TYPE_COLORS[inv.type] }}
          >
            {t(`types.${inv.type}`)}
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-7 w-7"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-muted-foreground text-[10px]">{t('holdings.header.shares')}</p>
          <p className="font-mono">{inv.shares.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">{t('holdings.header.avgCost')}</p>
          <p className="font-mono">{formatMoney(inv.avg_cost_basis, inv.currency)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">{t('holdings.header.value')}</p>
          <p className="font-mono font-semibold">
            {inv.marketValue !== null ? formatMoney(inv.marketValue, inv.currency) : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">{t('holdings.header.gainLoss')}</p>
          <p
            className={`font-mono font-semibold ${gainPositive ? 'text-success' : 'text-destructive'}`}
          >
            {inv.gainLoss !== null ? (
              <>
                {gainPositive ? '+' : ''}
                {formatMoney(inv.gainLoss, inv.currency)}
                <span className="ml-1 text-[10px]">
                  ({gainPositive ? '+' : ''}
                  {inv.gainLossPercent?.toFixed(2)}%)
                </span>
              </>
            ) : (
              '—'
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
