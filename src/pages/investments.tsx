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
  Search,
  Info,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { AreaChart, Area, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { ShowMorePagination } from '@/components/shared/show-more-pagination'
import { MetricItem, MetricStrip, NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { useUIStore } from '@/stores/ui-store'
import { useInvestmentStore, type InvestmentWithPrice } from '@/stores/investment-store'
import { useAccountStore } from '@/stores/account-store'
import { formatMoney, fromCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import {
  fetchAllCurrentPrices,
  savePricesToDB,
  type PriceIdentitySelection,
} from '@/lib/price-service'
import { multiplyDecimalsToCentavos } from '@shikin/finance-core/valuation'
import { isInvestmentPriceStale } from '@/lib/price-scheduler'
import { CHART_AXIS_COLOR, CHART_TOOLTIP_STYLE } from '@/lib/constants'
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
const INVESTMENTS_PAGE_SIZE = 24

const ASSET_TYPES: { key: string; labelKey: string }[] = [
  { key: 'all', labelKey: 'filters.all' },
  { key: 'stock', labelKey: 'types.stock' },
  { key: 'etf', labelKey: 'types.etf' },
  { key: 'crypto', labelKey: 'types.crypto' },
  { key: 'bond', labelKey: 'types.bond' },
  { key: 'mutual_fund', labelKey: 'types.mutual_fund' },
  { key: 'cetes', labelKey: 'types.cetes' },
  { key: 'other', labelKey: 'types.other' },
]

type AssetFilter = (typeof ASSET_TYPES)[number]['key']

const TYPE_COLORS: Record<string, string> = {
  stock: '#276fd6',
  etf: '#4b8e63',
  crypto: '#b57542',
  bond: '#8265a8',
  mutual_fund: '#c06565',
  cetes: '#6695a9',
  other: '#73777e',
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
    fetchError,
    lastPriceFetch,
    fetch: fetchInvestments,
    remove,
    fetchPriceHistory,
    refreshFailures = {},
    setRefreshFailures = () => {},
  } = useInvestmentStore()
  const { fetch: fetchAccounts } = useAccountStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRange>('3M')
  const [sortField, setSortField] = useState<SortField>('value')
  const [visibleInvestmentCount, setVisibleInvestmentCount] = useState(INVESTMENTS_PAGE_SIZE)
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    void fetchInvestments().catch(() => {})
    void fetchAccounts().catch(() => {})
  }, [fetchInvestments, fetchAccounts])

  useEffect(() => {
    if (investments.length > 0) {
      const instrumentKeys = [
        ...new Set(
          investments
            .map((investment) => investment.instrument_key)
            .filter((key): key is string => Boolean(key))
        ),
      ]
      instrumentKeys.forEach((instrumentKey) => {
        void fetchPriceHistory(instrumentKey, 365).catch(() => {})
      })
    }
  }, [investments.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const selections = new Map<string, PriceIdentitySelection>()
      for (const investment of investments) {
        if (
          investment.priceProvider &&
          investment.priceProvider !== 'manual' &&
          investment.priceInstrumentId &&
          investment.currentPriceCurrency
        ) {
          selections.set(investment.id, {
            provider: investment.priceProvider,
            instrumentId: investment.priceInstrumentId,
            exchange: investment.priceExchange ?? '',
            quoteCurrency: investment.currentPriceCurrency,
          })
        }
      }
      const result = await fetchAllCurrentPrices(investments, selections)
      setRefreshFailures(
        Object.fromEntries(result.failures.map((failure) => [failure.investmentId, failure.reason]))
      )
      if (result.quotes.size > 0) {
        await savePricesToDB(result.quotes)
        useInvestmentStore.getState().setLastPriceFetch(new Date().toISOString())
        await fetchInvestments()
        toast.success(t('toast.pricesUpdated'))
      } else {
        toast.info(t('toast.noPrices'))
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.refreshError')))
    } finally {
      setIsRefreshing(false)
    }
  }

  const chartData = useMemo(() => {
    if (!portfolioSummary.totalsComplete || priceHistory.size === 0 || investments.length === 0)
      return []

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

    const dateSet = new Set<string>()
    priceHistory.forEach((points) => {
      points.forEach((p) => {
        if (p.date >= cutoff) dateSet.add(p.date)
      })
    })

    const dates = [...dateSet].sort()

    const holdings = investments.flatMap((investment) => {
      if (!investment.instrument_key) return []
      const points = priceHistory.get(investment.instrument_key)
      return points
        ? [{ id: investment.id, quantityDecimal: investment.quantityDecimal, points }]
        : []
    })
    const cursors = new Map<string, { index: number; unitPriceDecimal: string | null }>()
    for (const holding of holdings) cursors.set(holding.id, { index: -1, unitPriceDecimal: null })

    return dates.map((date) => {
      let total = 0
      for (const holding of holdings) {
        const cursor = cursors.get(holding.id)
        if (!cursor) continue
        while (
          cursor.index + 1 < holding.points.length &&
          holding.points[cursor.index + 1].date <= date
        ) {
          cursor.index += 1
          cursor.unitPriceDecimal = holding.points[cursor.index].unitPriceDecimal
        }
        if (cursor.unitPriceDecimal !== null) {
          total += multiplyDecimalsToCentavos([holding.quantityDecimal, cursor.unitPriceDecimal])
        }
      }
      return { date, value: total }
    })
  }, [priceHistory, investments, timeRange, portfolioSummary.totalsComplete])

  const allocationData = useMemo(() => {
    if (!portfolioSummary.totalsComplete) return []
    const { byType } = portfolioSummary
    return Object.entries(byType).map(([type, data]) => ({
      name: type,
      value: data.marketValue,
      color: TYPE_COLORS[type] || TYPE_COLORS.other,
    }))
  }, [portfolioSummary])

  const filteredInvestments = useMemo(() => {
    let result = [...investments]
    if (assetFilter !== 'all') {
      result = result.filter((inv) => inv.type === assetFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (inv) => inv.symbol.toLowerCase().includes(q) || inv.name.toLowerCase().includes(q)
      )
    }
    return result
  }, [investments, assetFilter, searchQuery])

  const sortedInvestments = useMemo(() => {
    return [...filteredInvestments].sort((a, b) => {
      switch (sortField) {
        case 'value': {
          const aValue = a.convertedMarketValue ?? null
          const bValue = b.convertedMarketValue ?? null
          if (aValue === null && bValue === null) return a.id.localeCompare(b.id)
          if (aValue === null) return 1
          if (bValue === null) return -1
          return bValue - aValue || a.id.localeCompare(b.id)
        }
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
  }, [filteredInvestments, sortField])

  const visibleInvestments = sortedInvestments.slice(0, visibleInvestmentCount)

  useEffect(() => {
    setVisibleInvestmentCount(INVESTMENTS_PAGE_SIZE)
  }, [assetFilter, searchQuery, sortField])

  const hasInitialLoadError = !!fetchError && investments.length === 0
  const gainLoss = portfolioSummary.totalGainLoss
  const gainsAvailable = portfolioSummary.gainsComplete && gainLoss !== null

  const toolbar = (
    <PageToolbar
      actions={
        <>
          <Button variant="secondary" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            {t('summary.refresh')}
          </Button>
          <Button onClick={() => openInvestmentDialog()}>
            <Plus size={16} />
            {t('addInvestment')}
          </Button>
        </>
      }
    />
  )

  if (isLoading) {
    return (
      <div className="page-content">
        {toolbar}
        <div className="metric-strip">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="metric-item space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
        <NativePanel className="space-y-3 p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-60 w-full" />
        </NativePanel>
      </div>
    )
  }

  if (investments.length === 0) {
    return (
      <div className="page-content">
        <PageToolbar
          actions={
            <Button onClick={() => openInvestmentDialog()}>
              <Plus size={16} />
              {t('addInvestment')}
            </Button>
          }
        />
        {hasInitialLoadError ? (
          <ErrorState
            title="Couldn’t load your investments"
            description={fetchError}
            onRetry={() => {
              void fetchInvestments().catch(() => {})
            }}
          />
        ) : (
          <NativePanel className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-xl">
              <TrendingUp size={28} className="text-primary" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
            <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
            <Button onClick={() => openInvestmentDialog()}>
              <Plus size={16} />
              {t('addInvestment')}
            </Button>
          </NativePanel>
        )}
        <Suspense>
          <InvestmentDialog />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="page-content">
      {toolbar}

      <ErrorBanner
        title="Couldn’t load investments"
        message={fetchError}
        onRetry={() => {
          void fetchInvestments().catch(() => {})
        }}
      />

      {(!portfolioSummary.totalsComplete || !portfolioSummary.gainsComplete) && (
        <div className="border-warning/30 bg-warning/10 rounded-lg border px-4 py-3" role="status">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-warning mt-0.5" />
            <div>
              <p className="text-warning text-sm font-semibold">{t('currencyWarning.title')}</p>
              <p className="text-muted-foreground mt-1 text-sm">{t('currencyWarning.body')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {portfolioSummary.currencies.map((currency) => {
                  const data = portfolioSummary.byCurrency[currency]
                  if (!data) return null
                  return (
                    <span
                      key={currency}
                      className="border-border bg-muted inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums"
                    >
                      <span className="text-muted-foreground">{currency}</span>
                      <span>{formatMoney(data.marketValue, currency)}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <MetricStrip>
        <MetricItem
          label={t('summary.portfolioValue')}
          value={
            portfolioSummary.totalsComplete
              ? formatMoney(
                  portfolioSummary.totalMarketValue ?? 0,
                  portfolioSummary.preferredCurrency
                )
              : '—'
          }
          detail={
            portfolioSummary.totalsComplete ? undefined : t('currencyWarning.totalsUnavailable')
          }
        />
        <MetricItem
          label={t('summary.totalGainLoss')}
          value={
            gainsAvailable ? (
              <span className={gainLoss >= 0 ? 'text-success' : 'text-destructive'}>
                {gainLoss >= 0 ? '+' : ''}
                {formatMoney(gainLoss, portfolioSummary.preferredCurrency)}
                {portfolioSummary.totalGainLossPercent !== null ? (
                  <span className="ml-2 text-sm font-medium">
                    ({portfolioSummary.totalGainLossPercent >= 0 ? '+' : ''}
                    {portfolioSummary.totalGainLossPercent.toFixed(2)}%)
                  </span>
                ) : null}
              </span>
            ) : (
              '—'
            )
          }
        />
        <MetricItem
          label={t('summary.costBasis')}
          value={
            portfolioSummary.totalsComplete && portfolioSummary.gainsComplete
              ? formatMoney(
                  portfolioSummary.totalCostBasis ?? 0,
                  portfolioSummary.preferredCurrency
                )
              : '—'
          }
        />
        <MetricItem
          label={t('summary.lastUpdated')}
          value={lastPriceFetch ? dayjs(lastPriceFetch).fromNow() : t('summary.never')}
          detail={t('summary.pricesSynced')}
        />
      </MetricStrip>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <NativePanel className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold">{t('chart.portfolioValue')}</h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('chart.range')}>
              {TIME_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  aria-pressed={timeRange === range}
                  className={`filter-pill ${timeRange === range ? 'filter-pill-active' : ''}`}
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
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d) => dayjs(d).format('MMM D')}
                />
                <YAxis
                  tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${(fromCentavos(v) / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: number | undefined) => [formatMoney(value ?? 0), 'Value']}
                  labelFormatter={(label) => dayjs(label).format('MMM D, YYYY')}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  isAnimationActive={false}
                  stroke="var(--color-accent)"
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
        </NativePanel>

        <NativePanel className="p-5">
          <h2 className="mb-4 text-base font-semibold">{t('chart.allocation')}</h2>
          {allocationData.length > 0 ? (
            <div className="flex flex-col items-center">
              <SafeChart height={200}>
                <PieChart>
                  <Pie
                    data={allocationData}
                    isAnimationActive={false}
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
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value: number | undefined) => [formatMoney(value ?? 0), '']}
                  />
                </PieChart>
              </SafeChart>
              <div className="border-border mt-3 flex flex-wrap justify-center gap-3 border-t pt-4">
                {allocationData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
                    <span className="text-muted-foreground text-xs capitalize">
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
        </NativePanel>
      </div>

      <NativePanel className="p-5">
        <div className="mb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold">{t('holdings.title')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-muted-foreground inline-flex cursor-help items-center gap-1"
                title={t('priceSource.tooltip')}
              >
                <Info size={12} />
                <span className="text-xs">{t('priceSource.label')}</span>
              </span>
              <div className="flex flex-wrap gap-1">
                {(['value', 'gainLoss', 'name', 'type'] as SortField[]).map((field) => (
                  <button
                    key={field}
                    type="button"
                    onClick={() => setSortField(field)}
                    aria-pressed={sortField === field}
                    className={`filter-pill ${sortField === field ? 'filter-pill-active' : ''}`}
                  >
                    {t(`holdings.sort.${field}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {ASSET_TYPES.map((asset) => (
              <button
                key={asset.key}
                type="button"
                onClick={() => setAssetFilter(asset.key)}
                aria-pressed={assetFilter === asset.key}
                className={`filter-pill ${assetFilter === asset.key ? 'filter-pill-active' : ''}`}
              >
                {t(asset.labelKey as 'filters.all')}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              size={14}
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              className="pr-9 pl-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                aria-label={t('search.clear')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="hidden md:block">
          <div className="text-muted-foreground border-border grid grid-cols-8 gap-4 border-y px-2 py-3 text-xs tracking-wide uppercase">
            <span className="col-span-2">{t('holdings.header.name')}</span>
            <span>{t('holdings.header.type')}</span>
            <span className="text-right">{t('holdings.header.shares')}</span>
            <span className="text-right">{t('holdings.header.avgCost')}</span>
            <span className="text-right">{t('holdings.header.price')}</span>
            <span className="text-right">{t('holdings.header.value')}</span>
            <span className="text-right">{t('holdings.header.gainLoss')}</span>
          </div>
          <div>
            {visibleInvestments.map((inv) => (
              <HoldingRow
                key={inv.id}
                investment={inv}
                isStale={isInvestmentPriceStale(
                  inv.lastPriceDate,
                  inv.type === 'crypto' ? 'crypto' : 'stock'
                )}
                refreshFailure={refreshFailures[inv.id]}
                gainCurrency={portfolioSummary.preferredCurrency ?? 'USD'}
                onEdit={() => openInvestmentDialog(inv.id)}
                onDelete={() => setDeleteId(inv.id)}
                t={t}
              />
            ))}
          </div>
        </div>

        <div className="space-y-3 md:hidden">
          {visibleInvestments.map((inv) => (
            <HoldingCard
              key={inv.id}
              investment={inv}
              isStale={isInvestmentPriceStale(
                inv.lastPriceDate,
                inv.type === 'crypto' ? 'crypto' : 'stock'
              )}
              refreshFailure={refreshFailures[inv.id]}
              gainCurrency={portfolioSummary.preferredCurrency ?? 'USD'}
              onEdit={() => openInvestmentDialog(inv.id)}
              onDelete={() => setDeleteId(inv.id)}
              t={t}
            />
          ))}
        </div>

        {sortedInvestments.length === 0 && (assetFilter !== 'all' || searchQuery) && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search size={24} className="text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">{t('empty.filter')}</p>
            <button
              type="button"
              onClick={() => {
                setAssetFilter('all')
                setSearchQuery('')
              }}
              className="text-accent mt-2 text-sm font-semibold hover:underline"
            >
              {t('empty.clearFilters')}
            </button>
          </div>
        )}

        <ShowMorePagination
          shown={visibleInvestments.length}
          total={sortedInvestments.length}
          summaryLabel={tCommon('pagination.summary', {
            shown: visibleInvestments.length,
            total: sortedInvestments.length,
          })}
          showMoreLabel={tCommon('pagination.showMore', {
            count: Math.min(
              INVESTMENTS_PAGE_SIZE,
              sortedInvestments.length - visibleInvestments.length
            ),
          })}
          onShowMore={() => setVisibleInvestmentCount((count) => count + INVESTMENTS_PAGE_SIZE)}
          className="mt-4"
        />
      </NativePanel>

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
  refreshFailure,
  gainCurrency,
  onEdit,
  onDelete,
  t,
}: {
  investment: InvestmentWithPrice
  isStale: boolean
  refreshFailure?: string
  gainCurrency: string
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslation<'investments'>>['t']
}) {
  const gainPositive = (inv.gainLoss ?? 0) >= 0

  return (
    <div className="group border-border hover:bg-muted/50 grid grid-cols-8 items-center gap-4 border-b px-2 py-3 last:border-b-0">
      <div className="col-span-2 flex items-center gap-2">
        <div>
          <p className="text-sm font-semibold">{inv.symbol}</p>
          <p className="text-muted-foreground text-xs">{inv.name}</p>
        </div>
        {(isStale || refreshFailure || inv.valuationComplete === false) && (
          <span title={refreshFailure ?? (inv.valuationReasons?.join(', ') || t('holdings.stale'))}>
            <AlertTriangle size={12} className="text-warning" />
          </span>
        )}
      </div>
      <div>
        <Badge variant="secondary" className="text-xs" style={{ color: TYPE_COLORS[inv.type] }}>
          {t(`types.${inv.type}`)}
        </Badge>
      </div>
      <p className="text-right text-sm tabular-nums">{inv.quantityDecimal ?? inv.shares}</p>
      <p className="text-right text-sm tabular-nums">
        {inv.costBasisKnown && inv.avgCostBasisDecimal !== null
          ? `${inv.currency} ${inv.avgCostBasisDecimal}`
          : '—'}
      </p>
      <p className="text-right text-sm tabular-nums">
        {inv.currentPriceDecimal !== null
          ? `${inv.currentPriceCurrency ?? inv.currency} ${inv.currentPriceDecimal}`
          : '—'}
      </p>
      <p className="text-right text-sm font-semibold tabular-nums">
        {inv.marketValue !== null
          ? formatMoney(inv.marketValue, inv.currentPriceCurrency ?? inv.currency)
          : '—'}
      </p>
      <div className="flex items-center justify-end gap-2">
        <div className="text-right">
          <p
            className={`text-sm font-semibold tabular-nums ${gainPositive ? 'text-success' : 'text-destructive'}`}
          >
            {inv.gainLoss !== null ? (
              <>
                {gainPositive ? '+' : ''}
                {formatMoney(inv.gainLoss, gainCurrency)}
              </>
            ) : (
              '—'
            )}
          </p>
          {inv.gainLossPercent !== null && (
            <p
              className={`flex items-center justify-end gap-0.5 text-xs tabular-nums ${gainPositive ? 'text-success' : 'text-destructive'}`}
            >
              {gainPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {gainPositive ? '+' : ''}
              {inv.gainLossPercent.toFixed(2)}%
            </p>
          )}
        </div>
        <div className="flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEdit}
            aria-label={`Edit ${inv.symbol}`}
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-7 w-7"
            onClick={onDelete}
            aria-label={`Delete ${inv.symbol}`}
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
  refreshFailure,
  gainCurrency,
  onEdit,
  onDelete,
  t,
}: {
  investment: InvestmentWithPrice
  isStale: boolean
  refreshFailure?: string
  gainCurrency: string
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslation<'investments'>>['t']
}) {
  const gainPositive = (inv.gainLoss ?? 0) >= 0

  return (
    <div className="border-border rounded-lg border p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-base font-semibold">
              {inv.symbol}
              {(isStale || refreshFailure || inv.valuationComplete === false) && (
                <span
                  title={
                    refreshFailure ?? (inv.valuationReasons?.join(', ') || t('holdings.stale'))
                  }
                >
                  <AlertTriangle size={12} className="text-warning ml-1 inline" />
                </span>
              )}
            </p>
            <p className="text-muted-foreground text-xs">{inv.name}</p>
          </div>
          <Badge variant="secondary" className="text-xs" style={{ color: TYPE_COLORS[inv.type] }}>
            {t(`types.${inv.type}`)}
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-7 md:w-7"
            onClick={onEdit}
            aria-label={`Edit ${inv.symbol}`}
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-11 w-11 md:h-7 md:w-7"
            onClick={onDelete}
            aria-label={`Delete ${inv.symbol}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">{t('holdings.header.shares')}</p>
          <p className="tabular-nums">{inv.quantityDecimal ?? inv.shares}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t('holdings.header.avgCost')}</p>
          <p className="tabular-nums">
            {inv.costBasisKnown && inv.avgCostBasisDecimal !== null
              ? `${inv.currency} ${inv.avgCostBasisDecimal}`
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t('holdings.header.value')}</p>
          <p className="font-semibold tabular-nums">
            {inv.marketValue !== null
              ? formatMoney(inv.marketValue, inv.currentPriceCurrency ?? inv.currency)
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t('holdings.header.gainLoss')}</p>
          <p
            className={`font-semibold tabular-nums ${gainPositive ? 'text-success' : 'text-destructive'}`}
          >
            {inv.gainLoss !== null ? (
              <>
                {gainPositive ? '+' : ''}
                {formatMoney(inv.gainLoss, gainCurrency)}
                <span className="ml-1 text-xs">
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
