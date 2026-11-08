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
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
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
import { fetchAllCurrentPrices, type PriceIdentitySelection } from '@/lib/price-service'
import { publishInvestmentPriceRefresh } from '@/lib/investment-price-publication'
import { isInvestmentPriceStale } from '@/lib/price-scheduler'
import { CHART_AXIS_COLOR, CHART_TOOLTIP_STYLE } from '@/lib/constants'
import {
  QUOTE_HISTORY_FETCH_LIMIT,
  allocationColor,
  buildCompleteAllocation,
  selectCurrentQuantityQuotePlot,
  type AllocationSegment,
} from '@/components/investments/investment-presentation'
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
const HOLDINGS_DESKTOP_GRID =
  'grid min-w-[60rem] grid-cols-[minmax(10rem,2fr)_minmax(5rem,1fr)_minmax(4.5rem,0.75fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_3.75rem] gap-4'

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

const RANGE_DAYS: Record<TimeRange, number | null> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  All: null,
}

type SortField = 'value' | 'gainLoss' | 'name' | 'type'

function formatExplicitMoney(
  amount: number | null | undefined,
  currency: string | null | undefined
) {
  if (amount === null || amount === undefined || !currency?.trim()) return null
  return formatMoney(amount, currency)
}

function QuoteRangeControls({
  timeRange,
  label,
  onChange,
}: {
  timeRange: TimeRange
  label: string
  onChange: (range: TimeRange) => void
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          aria-pressed={timeRange === range}
          className={`filter-pill min-h-11 px-3 ${timeRange === range ? 'filter-pill-active' : ''}`}
        >
          {range}
        </button>
      ))}
    </div>
  )
}

function AllocationRing({ segments }: { segments: readonly AllocationSegment[] }) {
  const radius = 15.5
  const circumference = 2 * Math.PI * radius
  const lengths = segments.map((segment) => segment.fraction * circumference)
  const offsets = lengths.map((_, index) =>
    lengths.slice(0, index).reduce((sum, length) => sum + length, 0)
  )
  return (
    <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden="true">
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth="2.75"
      />
      {segments.map((segment, index) => {
        const length = lengths[index] ?? 0
        const full = segment.fraction >= 0.999
        return (
          <circle
            key={segment.type}
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="2.75"
            strokeDasharray={full ? undefined : `${length} ${circumference - length}`}
            strokeDashoffset={full ? undefined : -(offsets[index] ?? 0)}
          />
        )
      })}
    </svg>
  )
}

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
  const [timeRange, setTimeRange] = useState<TimeRange>('All')
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
        void fetchPriceHistory(instrumentKey, QUOTE_HISTORY_FETCH_LIMIT).catch(() => {})
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
      if (await publishInvestmentPriceRefresh(result, setRefreshFailures, fetchInvestments)) {
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

  const rangeDays = RANGE_DAYS[timeRange]
  const quotePlot = useMemo(
    () =>
      selectCurrentQuantityQuotePlot({
        holdings: investments.map((investment) => ({
          id: investment.id,
          instrumentKey: investment.instrument_key ?? null,
          quantityDecimal: investment.quantityDecimal,
          assetType: investment.type,
          provider: investment.priceProvider,
          instrumentId: investment.priceInstrumentId,
          exchange: investment.priceExchange,
          currentPriceCurrency: investment.currentPriceCurrency,
        })),
        historyByKey: priceHistory,
        reportCurrency: portfolioSummary.preferredCurrency,
        totalsComplete: portfolioSummary.totalsComplete,
        rangeStart:
          rangeDays === null ? null : dayjs().subtract(rangeDays, 'day').format('YYYY-MM-DD'),
        historyLimit: QUOTE_HISTORY_FETCH_LIMIT,
      }),
    [
      investments,
      priceHistory,
      portfolioSummary.preferredCurrency,
      portfolioSummary.totalsComplete,
      rangeDays,
    ]
  )
  const allocation = useMemo(
    () =>
      buildCompleteAllocation({
        byType: portfolioSummary.byType,
        currency: portfolioSummary.preferredCurrency,
        totalsComplete: portfolioSummary.totalsComplete,
        totalMarketValue: portfolioSummary.totalMarketValue,
      }),
    [
      portfolioSummary.byType,
      portfolioSummary.preferredCurrency,
      portfolioSummary.totalsComplete,
      portfolioSummary.totalMarketValue,
    ]
  )

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
        <NativePanel className="flex items-center gap-4 p-5">
          <Skeleton className="h-28 w-28 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-32" />
          </div>
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
              {portfolioSummary.preferredCurrency === null ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {t('currencyWarning.setupRequired')}
                </p>
              ) : (
                <details className="mt-1">
                  <summary className="text-muted-foreground focus-visible:ring-ring min-h-11 cursor-pointer text-xs focus-visible:ring-2 focus-visible:outline-none">
                    {t('currencyWarning.more')}
                  </summary>
                  <p className="text-muted-foreground text-xs">{t('currencyWarning.body')}</p>
                </details>
              )}
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

      {allocation ? (
        <NativePanel className="min-w-0 p-4 sm:p-5" data-testid="allocation-panel">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('chart.allocation')}</h2>
            <span className="border-border rounded-full border px-2 py-0.5 text-xs tabular-nums">
              {allocation.currency}
            </span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-4 sm:flex-row sm:items-center">
            <div
              role="img"
              aria-label={t('chart.allocation')}
              aria-describedby="investment-allocation-table"
              data-testid="allocation-ring"
              className="h-28 w-28 shrink-0"
            >
              <AllocationRing segments={allocation.segments} />
            </div>
            <ul className="grid min-w-0 flex-1 gap-1.5" data-testid="allocation-legend">
              {allocation.segments.map((segment) => (
                <li
                  key={segment.type}
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
                >
                  <span
                    data-testid={`allocation-swatch-${segment.type}`}
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: segment.color,
                    }}
                  />
                  <span className="min-w-0 break-words">
                    {t(`types.${segment.type}` as 'types.stock')}
                  </span>
                  <span className="ml-auto min-w-0 font-medium break-words tabular-nums">
                    {formatMoney(segment.amountCentavos, allocation.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="sr-only">
            <table id="investment-allocation-table">
              <caption>
                {t('chart.allocation')} {allocation.currency}
              </caption>
              <tbody>
                {allocation.segments.map((segment) => (
                  <tr key={segment.type}>
                    <th scope="row">{t(`types.${segment.type}` as 'types.stock')}</th>
                    <td>{formatMoney(segment.amountCentavos, allocation.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NativePanel>
      ) : null}

      <MetricStrip>
        <MetricItem
          label={t('summary.portfolioValue')}
          value={
            formatExplicitMoney(
              portfolioSummary.totalsComplete ? portfolioSummary.totalMarketValue : null,
              portfolioSummary.preferredCurrency
            ) ?? '—'
          }
          detail={
            portfolioSummary.totalsComplete ? undefined : t('currencyWarning.totalsUnavailable')
          }
        />
        <MetricItem
          label={t('summary.totalGainLoss')}
          value={
            gainsAvailable ? (
              <span
                className={`${gainLoss >= 0 ? 'text-success' : 'text-destructive'} inline-flex max-w-full min-w-0 flex-wrap items-baseline gap-x-2`}
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {gainLoss >= 0 ? '+' : ''}
                  {formatExplicitMoney(gainLoss, portfolioSummary.preferredCurrency) ?? '—'}
                </span>
                {portfolioSummary.totalGainLossPercent !== null ? (
                  <span className="text-sm font-medium [overflow-wrap:anywhere]">
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
              ? (formatExplicitMoney(
                  portfolioSummary.totalCostBasis,
                  portfolioSummary.preferredCurrency
                ) ?? '—')
              : '—'
          }
        />
        <MetricItem
          label={t('summary.lastUpdated')}
          value={lastPriceFetch ? dayjs(lastPriceFetch).fromNow() : t('summary.never')}
          detail={t('summary.pricesSynced')}
        />
      </MetricStrip>

      {quotePlot.status === 'plot' ? (
        <NativePanel
          className="min-w-0 p-4 sm:p-5"
          data-testid="quote-history-plot"
          data-currency={quotePlot.currency}
        >
          <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-medium">{t('chart.currentQuantities')}</h2>
            <QuoteRangeControls
              timeRange={timeRange}
              label={t('chart.range')}
              onChange={setTimeRange}
            />
          </div>
          <div
            className="h-40 min-w-0"
            role="img"
            aria-label={t('chart.currentQuantities')}
            aria-describedby="investment-quote-history-table"
          >
            <SafeChart>
              <AreaChart
                data={quotePlot.points.map((point) => ({
                  date: point.date,
                  value: point.valueCentavos,
                }))}
              >
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
                  width={44}
                  tickFormatter={(v) => `${(fromCentavos(Number(v)) / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value) => [
                    formatMoney(Number(value ?? 0), quotePlot.currency),
                    t('chart.currentQuantities'),
                  ]}
                  labelFormatter={(label) => dayjs(String(label)).format('MMM D, YYYY')}
                />
                <Area
                  type="linear"
                  dataKey="value"
                  isAnimationActive={false}
                  stroke="var(--color-chart-1)"
                  strokeWidth={2}
                  fill="none"
                />
              </AreaChart>
            </SafeChart>
          </div>
          <div className="sr-only">
            <table id="investment-quote-history-table" data-testid="quote-history-table">
              <caption>{t('chart.currentQuantities')}</caption>
              <tbody>
                {quotePlot.points.map((point) => (
                  <tr key={point.date}>
                    <th scope="row">{point.date}</th>
                    <td>{formatMoney(point.valueCentavos, quotePlot.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NativePanel>
      ) : quotePlot.status === 'withheld' &&
        !(quotePlot.reason === 'history-missing' && priceHistory.size === 0) ? (
        <details
          className="min-w-0"
          data-testid="quote-history-withheld"
          data-reason={quotePlot.reason}
        >
          <summary className="text-muted-foreground focus-visible:ring-ring min-h-11 cursor-pointer text-xs focus-visible:ring-2 focus-visible:outline-none">
            {t('chart.withheld')}
          </summary>
          <p className="text-muted-foreground max-w-prose text-xs">{t('chart.withheldDetail')}</p>
          {quotePlot.rangeSelectable ? (
            <QuoteRangeControls
              timeRange={timeRange}
              label={t('chart.range')}
              onChange={setTimeRange}
            />
          ) : null}
        </details>
      ) : null}

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
                className={`filter-pill min-h-11 px-3 ${assetFilter === asset.key ? 'filter-pill-active' : ''}`}
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

        <div className="hidden overflow-x-auto md:block">
          <div
            data-testid="desktop-holdings-header"
            className={`${HOLDINGS_DESKTOP_GRID} text-muted-foreground border-border border-y px-2 py-3 text-xs tracking-wide uppercase`}
          >
            <span>{t('holdings.header.name')}</span>
            <span>{t('holdings.header.type')}</span>
            <span className="text-right">{t('holdings.header.shares')}</span>
            <span className="text-right">{t('holdings.header.avgCost')}</span>
            <span className="text-right">{t('holdings.header.price')}</span>
            <span className="text-right">{t('holdings.header.value')}</span>
            <span className="text-right">{t('holdings.header.gainLoss')}</span>
            <span aria-hidden="true" />
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
                gainCurrency={portfolioSummary.preferredCurrency ?? null}
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
              gainCurrency={portfolioSummary.preferredCurrency ?? null}
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
  gainCurrency: string | null
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslation<'investments'>>['t']
}) {
  const gainPositive = (inv.gainLoss ?? 0) >= 0
  const gainText =
    inv.gainLoss !== null && gainCurrency ? formatMoney(inv.gainLoss, gainCurrency) : null

  return (
    <div
      data-testid="desktop-holding-row"
      className={`${HOLDINGS_DESKTOP_GRID} group border-border hover:bg-muted/50 items-center border-b px-2 py-3 last:border-b-0`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 wrap-anywhere whitespace-normal">
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
        <Badge variant="secondary" className="text-xs" style={{ color: allocationColor(inv.type) }}>
          {t(`types.${inv.type}`)}
        </Badge>
      </div>
      <p className="min-w-0 text-right text-sm wrap-anywhere whitespace-normal tabular-nums">
        {inv.quantityDecimal ?? inv.shares}
      </p>
      <p className="min-w-0 text-right text-sm wrap-anywhere whitespace-normal tabular-nums">
        {inv.costBasisKnown && inv.avgCostBasisDecimal !== null
          ? `${inv.currency} ${inv.avgCostBasisDecimal}`
          : '—'}
      </p>
      <p className="min-w-0 text-right text-sm wrap-anywhere whitespace-normal tabular-nums">
        {inv.currentPriceDecimal !== null
          ? `${inv.currentPriceCurrency ?? inv.currency} ${inv.currentPriceDecimal}`
          : '—'}
      </p>
      <p className="min-w-0 text-right text-sm font-semibold wrap-anywhere whitespace-normal tabular-nums">
        {inv.marketValue !== null
          ? formatMoney(inv.marketValue, inv.currentPriceCurrency ?? inv.currency)
          : '—'}
      </p>
      <div className="min-w-0 text-right wrap-anywhere whitespace-normal">
        <p
          className={`text-sm font-semibold tabular-nums ${gainPositive ? 'text-success' : 'text-destructive'}`}
        >
          {gainText !== null ? (
            <>
              {gainPositive ? '+' : ''}
              {gainText}
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
      <div
        data-testid="desktop-holding-actions"
        className="flex justify-end gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
      >
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
  gainCurrency: string | null
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslation<'investments'>>['t']
}) {
  const gainPositive = (inv.gainLoss ?? 0) >= 0
  const gainText =
    inv.gainLoss !== null && gainCurrency ? formatMoney(inv.gainLoss, gainCurrency) : null

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
          <Badge
            variant="secondary"
            className="text-xs"
            style={{ color: allocationColor(inv.type) }}
          >
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
            {gainText !== null ? (
              <>
                {gainPositive ? '+' : ''}
                {gainText}
                {inv.gainLossPercent !== null ? (
                  <span className="ml-1 text-xs">
                    ({gainPositive ? '+' : ''}
                    {inv.gainLossPercent.toFixed(2)}%)
                  </span>
                ) : null}
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
