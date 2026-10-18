import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import dayjs from 'dayjs'
import { Banknote, ChevronLeft, ChevronRight, PiggyBank, Receipt, X } from 'lucide-react'
import { NativePanel } from '@/components/ui/native-layout'
import { SafeChart } from '@/components/ui/safe-chart'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Account } from '@/types/database'
import type { ComparisonDisplayMode } from '@/components/dashboard/overview-account-comparison-helpers'
import { OverviewAccountComparison } from '@/components/dashboard/overview-account-comparison'
import {
  selectSummaryVisual,
  stepSummarySelection,
  summaryEndpointAmount,
  summaryPointSelection,
  summaryRecordedValueDomain,
  type SummaryCompositionAccount,
  type SummaryHistoryPoint,
  type SummaryPlainReason,
  type SummaryPointSelection,
} from '@/components/dashboard/overview-summary-visual'

export type NetWorthPeriod = 'month' | '3m' | '6m' | 'ytd' | '1y' | 'all'
type OverviewView = 'summary' | 'history' | 'comparison'

const OVERVIEW_PERIODS: NetWorthPeriod[] = ['month', '3m', '6m', 'ytd', '1y', 'all']
const SUMMARY_RANGES = [
  'month',
  '3m',
  '6m',
  '1y',
  'all',
] as const satisfies readonly NetWorthPeriod[]
const OVERVIEW_VIEWS: OverviewView[] = ['summary', 'history', 'comparison']

const TOUCH_CONTROL =
  'focus-visible:ring-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none'

function summaryPeriodKey(
  period: NetWorthPeriod
): `overview.period.ytd` | `overview.summaryRange.names.${(typeof SUMMARY_RANGES)[number]}` {
  if (period === 'ytd') return 'overview.period.ytd'
  return `overview.summaryRange.names.${period}`
}

function readSnapshotDate(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const date = (payload as { date?: unknown }).date
  return typeof date === 'string' ? date : null
}

export interface OverviewHistoryPoint {
  date: string
  netWorth: number
}

interface OverviewNetWorthProps {
  currentComplete: boolean
  currentAmount: number | null
  currentCurrency: string | null
  unavailableMessage?: string
  income: string
  incomeDetail?: string
  spent: string
  spentDetail?: string
  saved: string
  savingsRate?: string
  savedTone: 'positive' | 'negative' | 'muted'
  monthlySummaryLabel: string
  currentAsOfLabel: string
  historyAsOfLabel: string
  history: OverviewHistoryPoint[]
  historyComplete: boolean
  historyPending?: boolean
  historyUnavailableMessage?: string
  period: NetWorthPeriod
  onPeriodChange: (period: NetWorthPeriod) => void
  historyCurrency: string | null
  emptyHistoryMessage: string
  accounts: Account[]
  preferredCurrency: string | null
  totalAssets?: number | null
  totalLiabilities?: number | null
  totalInvestments?: number | null
  accountAssets?: readonly SummaryCompositionAccount[]
  accountLiabilities?: readonly SummaryCompositionAccount[]
}

export function OverviewNetWorth({
  currentComplete,
  currentAmount,
  currentCurrency,
  unavailableMessage,
  income,
  incomeDetail,
  spent,
  spentDetail,
  saved,
  savingsRate,
  savedTone,
  monthlySummaryLabel,
  currentAsOfLabel,
  historyAsOfLabel,
  history,
  historyComplete,
  historyPending = false,
  historyUnavailableMessage,
  period,
  onPeriodChange,
  historyCurrency,
  emptyHistoryMessage,
  accounts,
  preferredCurrency,
  totalAssets = null,
  totalLiabilities = null,
  totalInvestments = null,
  accountAssets = [],
  accountLiabilities = [],
}: OverviewNetWorthProps) {
  const { t } = useTranslation('dashboard')
  const [view, setView] = useState<OverviewView>('summary')
  const [comparisonSelection, setComparisonSelection] = useState<[string, string]>(['', ''])
  const [comparisonPeriod, setComparisonPeriod] = useState<NetWorthPeriod>('6m')
  const [comparisonMode, setComparisonMode] = useState<ComparisonDisplayMode>('balance')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const firstPoint = history[0]
  const lastPoint = history.length > 1 ? history[history.length - 1] : null
  const changeAmount = lastPoint && firstPoint ? lastPoint.netWorth - firstPoint.netWorth : 0
  const hasCurrentValue = currentComplete && currentAmount !== null && currentCurrency !== null
  const hasHistory = historyComplete && historyCurrency !== null
  const hasChange = hasCurrentValue && hasHistory && history.length > 1
  const summaryVisual = selectSummaryVisual({
    history,
    historyComplete,
    historyCurrency,
    historyPending,
    currentComplete,
    currentAmount,
    currentCurrency,
    totalAssets,
    totalLiabilities,
    totalInvestments,
    accountAssets,
    accountLiabilities,
  })
  const summaryPeriodLabel = t(summaryPeriodKey(period))

  const selectTabFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % OVERVIEW_VIEWS.length
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + OVERVIEW_VIEWS.length) % OVERVIEW_VIEWS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = OVERVIEW_VIEWS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    setView(OVERVIEW_VIEWS[nextIndex])
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <NativePanel aria-labelledby="overview-finance-heading" className="min-w-0 overflow-hidden">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h2 id="overview-finance-heading" className="text-sm font-semibold">
          {t('overview.financeOverview')}
        </h2>
        <div
          className="border-border bg-muted grid w-full min-w-0 grid-cols-3 gap-0.5 rounded-lg border p-0.5 sm:flex sm:w-auto sm:max-w-full"
          role="tablist"
          aria-label={t('overview.viewsLabel')}
        >
          {OVERVIEW_VIEWS.map((item, index) => (
            <button
              key={item}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              id={`overview-${item}-tab`}
              type="button"
              role="tab"
              aria-selected={view === item}
              aria-controls={`overview-${item}-panel`}
              tabIndex={view === item ? 0 : -1}
              onClick={() => setView(item)}
              onKeyDown={(event) => selectTabFromKeyboard(event, index)}
              className={cn(
                'min-h-11 min-w-0 rounded-md px-1.5 py-1 text-center text-[11px] leading-tight font-semibold break-words whitespace-normal sm:min-h-8 sm:w-auto sm:px-3 sm:py-1.5 sm:text-xs',
                view === item
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`overview.views.${item}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-w-0">
        <div
          id="overview-summary-panel"
          role="tabpanel"
          aria-labelledby="overview-summary-tab"
          className={cn(
            'col-start-1 row-start-1 min-w-0 p-4 sm:p-6',
            view !== 'summary' && 'hidden'
          )}
          hidden={view !== 'summary'}
          aria-hidden={view !== 'summary'}
          inert={view !== 'summary'}
        >
          <div
            className="grid w-full min-w-0 items-stretch gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-0"
            aria-label={t('overview.views.summary')}
          >
            <div className="flex min-w-0 flex-col lg:pr-8">
              <SummaryRangeControl period={period} onPeriodChange={onPeriodChange} />
              <SummaryVisualSlot
                visual={summaryVisual}
                period={period}
                periodLabel={summaryPeriodLabel}
                historyUnavailableMessage={historyUnavailableMessage}
              />
              <div className="mt-4 lg:mt-auto lg:pt-6">
                <span className="text-muted-foreground text-xs">{t('overview.netWorth')}</span>
                <strong className="mt-1.5 block text-3xl font-semibold tracking-tight break-all tabular-nums sm:text-4xl">
                  {hasCurrentValue ? (
                    formatMoney(currentAmount, currentCurrency)
                  ) : (
                    <span className="text-warning">—</span>
                  )}
                </strong>
                {hasCurrentValue ? (
                  <p className="text-muted-foreground mt-2 text-xs break-words">
                    {currentAsOfLabel}
                  </p>
                ) : (
                  <p role="alert" className="text-warning mt-2 text-xs break-words">
                    {t('currency.totalUnavailable')}
                    {unavailableMessage ? ` · ${unavailableMessage}` : ''}
                  </p>
                )}
              </div>
            </div>
            <div className="border-border min-w-0 lg:border-l lg:pl-8">
              <p className="text-muted-foreground mb-1 text-xs">{monthlySummaryLabel}</p>
              <div className="divide-border divide-y">
                <MonthlyMetricRow
                  icon={Banknote}
                  iconClassName="bg-success/10 text-success"
                  label={t('cards.income')}
                  value={income}
                  detail={incomeDetail}
                />
                <MonthlyMetricRow
                  icon={Receipt}
                  iconClassName="bg-muted text-muted-foreground"
                  label={t('cards.spent')}
                  value={spent}
                  detail={spentDetail}
                />
                <MonthlyMetricRow
                  icon={PiggyBank}
                  iconClassName="bg-accent-muted text-accent"
                  label={t('cards.saved')}
                  value={saved}
                  valueClassName={cn(
                    savedTone === 'positive' && 'text-accent',
                    savedTone === 'negative' && 'text-destructive'
                  )}
                  detail={
                    savingsRate ? (
                      <>
                        <span>{savingsRate}</span> {t('cards.savings')}
                      </>
                    ) : undefined
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div
          id="overview-history-panel"
          role="tabpanel"
          aria-labelledby="overview-history-tab"
          className={cn(
            'col-start-1 row-start-1 min-w-0 p-4 sm:p-6',
            view !== 'history' && 'hidden'
          )}
          hidden={view !== 'history'}
          aria-hidden={view !== 'history'}
          inert={view !== 'history'}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{t('overview.netWorthHistory')}</h3>
              <p className="text-muted-foreground mt-1 text-xs">{t('overview.focusDate')}</p>
            </div>
            <HistoryPeriodControl period={period} onPeriodChange={onPeriodChange} />
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {hasHistory && history.length > 0 ? (
              <strong className="text-2xl font-semibold tracking-tight tabular-nums">
                {formatMoney(history[history.length - 1].netWorth, historyCurrency)}
              </strong>
            ) : null}
            {hasChange ? (
              <span
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  changeAmount >= 0 ? 'text-accent' : 'text-destructive'
                )}
              >
                {t('overview.changeOverPeriod', {
                  delta: `${changeAmount >= 0 ? '+' : '-'}${formatMoney(Math.abs(changeAmount), historyCurrency)}`,
                  period: t(`overview.period.${period}`),
                })}
              </span>
            ) : null}
            {hasHistory ? (
              <span className="text-muted-foreground text-xs">{historyAsOfLabel}</span>
            ) : null}
          </div>

          {!hasHistory ? (
            <div
              className="border-warning/30 bg-warning/10 mt-4 rounded-xl border px-4 py-8 text-center"
              role="alert"
            >
              <p className="text-warning text-sm font-semibold">
                {t('overview.historyUnavailable')}
              </p>
              {historyUnavailableMessage ? (
                <p className="text-muted-foreground mt-1 text-xs">{historyUnavailableMessage}</p>
              ) : null}
            </div>
          ) : history.length > 1 ? (
            <>
              <div
                className="mt-3 h-48 min-w-0 sm:h-72"
                role="img"
                aria-label={t('overview.chartTitle')}
              >
                <SafeChart>
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="overviewNetWorthFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                      tickFormatter={(date) => dayjs(String(date)).format('MMM D')}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                      tickFormatter={(value) => formatMoney(Number(value), historyCurrency)}
                      width={62}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      itemStyle={CHART_ITEM_STYLE}
                      labelStyle={CHART_LABEL_STYLE}
                      labelFormatter={(date) => dayjs(String(date)).format('MMM D, YYYY')}
                      formatter={(value) => [
                        formatMoney(Number(value), historyCurrency),
                        t('overview.netWorth'),
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="netWorth"
                      isAnimationActive={false}
                      stroke="var(--color-chart-1)"
                      strokeWidth={2.2}
                      fill="url(#overviewNetWorthFill)"
                    />
                  </AreaChart>
                </SafeChart>
              </div>
              <details className="mt-2">
                <summary className="text-accent cursor-pointer text-xs font-semibold">
                  {t('overview.viewChartData')}
                </summary>
                <div className="max-w-full overflow-x-auto">
                  <table className="mt-2 text-xs">
                    <caption className="sr-only">{t('overview.chartTitle')}</caption>
                    <thead>
                      <tr>
                        <th className="pr-6 text-left font-medium">{t('analytics.month')}</th>
                        <th className="text-left font-medium">{t('overview.netWorth')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((point, index) => (
                        <tr key={`${point.date}-${index}`}>
                          <td className="py-0.5 pr-6">{dayjs(point.date).format('MMM D, YYYY')}</td>
                          <td className="tabular-nums">
                            {formatMoney(point.netWorth, historyCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <div className="bg-muted mt-4 flex h-48 items-center justify-center rounded-xl px-4 text-center">
              <p className="text-muted-foreground text-sm">{emptyHistoryMessage}</p>
            </div>
          )}
        </div>

        <div
          id="overview-comparison-panel"
          role="tabpanel"
          aria-labelledby="overview-comparison-tab"
          className={cn(
            'col-start-1 row-start-1 min-w-0 p-4 sm:p-6',
            view !== 'comparison' && 'hidden'
          )}
          hidden={view !== 'comparison'}
          aria-hidden={view !== 'comparison'}
          inert={view !== 'comparison'}
        >
          {preferredCurrency ? (
            <OverviewAccountComparison
              accounts={accounts}
              preferredCurrency={preferredCurrency}
              selection={comparisonSelection}
              onSelectionChange={setComparisonSelection}
              period={comparisonPeriod}
              onPeriodChange={setComparisonPeriod}
              mode={comparisonMode}
              onModeChange={setComparisonMode}
            />
          ) : (
            <div
              className="border-warning/30 bg-warning/10 rounded-xl border px-4 py-8 text-center"
              role="alert"
            >
              <p className="text-warning text-sm font-semibold">
                {t('overview.comparison.unavailable')}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{t('currency.mainRequired')}</p>
            </div>
          )}
        </div>
      </div>
    </NativePanel>
  )
}

const SUMMARY_RECORDED_TABLE_ID = 'overview-summary-recorded-snapshots'
const SUMMARY_COMPOSITION_TABLE_ID = 'overview-summary-composition'
const SUMMARY_RECORDED_CAPTION_ID = 'overview-summary-recorded-caption'
const SUMMARY_COMPOSITION_CAPTION_ID = 'overview-summary-composition-caption'

const COMPOSITION_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

const PLAIN_MESSAGE = {
  'one-snapshot': 'overview.summaryOneSnapshot',
  'no-snapshots': 'overview.summaryNoSnapshots',
  'history-unavailable': 'overview.summaryHistoryUnavailable',
  'history-loading': 'overview.summaryHistoryLoading',
  'composition-unproven': 'overview.summaryCompositionUnproven',
  'current-only': 'overview.summaryCurrentOnly',
} as const satisfies Record<SummaryPlainReason, `overview.${string}`>

function formatSnapshotDate(date: string) {
  return dayjs(date).format('MMM D, YYYY')
}

function formatEndpointDate(date: string, includeYear: boolean) {
  return dayjs(date).format(includeYear ? 'MMM D, YYYY' : 'MMM D')
}

function SummaryRecordedDot({
  cx,
  cy,
  index,
  payload,
  selected,
  onSelect,
}: {
  cx?: number
  cy?: number
  index?: number
  payload?: unknown
  selected: boolean
  onSelect: (selection: SummaryPointSelection) => void
}) {
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return <g />
  }
  const date = readSnapshotDate(payload)
  return (
    <circle
      className="recharts-line-dot"
      cx={cx}
      cy={cy}
      r={selected ? 4 : 2.5}
      fill="var(--color-chart-1)"
      stroke="none"
      data-testid="overview-summary-chart-point"
      data-date={date ?? ''}
      data-index={typeof index === 'number' ? String(index) : ''}
      data-selected={selected ? 'true' : 'false'}
      style={{ cursor: date ? 'pointer' : undefined }}
      onClick={(event) => {
        event.stopPropagation()
        if (typeof index === 'number' && date) onSelect({ index, date })
      }}
    />
  )
}

function SummaryRangeControl({
  period,
  onPeriodChange,
}: {
  period: NetWorthPeriod
  onPeriodChange: (period: NetWorthPeriod) => void
}) {
  const { t } = useTranslation('dashboard')
  return (
    <div
      className="border-border bg-muted mb-3 flex w-full max-w-full flex-wrap gap-0.5 rounded-lg border p-0.5 motion-reduce:transition-none"
      role="group"
      aria-label={t('overview.summaryRange.label')}
      data-testid="overview-summary-range"
    >
      {SUMMARY_RANGES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={period === item}
          aria-label={t(`overview.summaryRange.names.${item}`)}
          onClick={() => onPeriodChange(item)}
          className={cn(
            TOUCH_CONTROL,
            period === item
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span aria-hidden="true">{t(`overview.summaryRange.labels.${item}`)}</span>
        </button>
      ))}
      {(SUMMARY_RANGES as readonly string[]).includes(period) ? null : (
        <span className="text-muted-foreground px-2 py-2 text-xs">
          {t(`overview.period.${period}`)}
        </span>
      )}
    </div>
  )
}

function SummaryVisualSlot({
  visual,
  period,
  periodLabel,
  historyUnavailableMessage,
}: {
  visual: ReturnType<typeof selectSummaryVisual>
  period: NetWorthPeriod
  periodLabel: string
  historyUnavailableMessage?: string
}) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n?.resolvedLanguage ?? i18n?.language
  const [selection, setSelection] = useState<{
    period: NetWorthPeriod
    point: SummaryPointSelection
  } | null>(null)
  const active =
    visual.kind === 'line' && selection?.period === period
      ? summaryPointSelection(visual.points, selection.point.index, selection.point.date)
      : null

  if (visual.kind === 'line') {
    const start = visual.points[0]!
    const end = visual.points[visual.points.length - 1]!
    const caption = t('overview.summaryRecorded', {
      count: visual.points.length,
      period: periodLabel,
      start: formatSnapshotDate(start.date),
      end: formatSnapshotDate(end.date),
    })
    const valueDomain = summaryRecordedValueDomain(visual.points.map((point) => point.netWorth))
    const includeYear = start.date.slice(0, 4) !== end.date.slice(0, 4)
    const startAmount = summaryEndpointAmount(start.netWorth, end.netWorth, visual.currency, locale)
    const endAmount = summaryEndpointAmount(end.netWorth, start.netWorth, visual.currency, locale)
    return (
      <div className="shrink-0">
        <div className="h-28 min-w-0" data-testid="overview-summary-recorded-line">
          <div
            className="h-full min-h-0"
            role="img"
            aria-labelledby={SUMMARY_RECORDED_CAPTION_ID}
            aria-describedby={SUMMARY_RECORDED_TABLE_ID}
          >
            <SafeChart>
              <LineChart data={visual.points} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
                {/* Bind tooltip labels to snapshot dates; hide keeps the axis off the summary. */}
                <XAxis dataKey="date" hide />
                {valueDomain ? (
                  <YAxis
                    hide
                    width={0}
                    domain={[valueDomain[0], valueDomain[1]]}
                    allowDataOverflow
                    tick={false}
                    axisLine={false}
                    tickLine={false}
                  />
                ) : null}
                <Line
                  type="linear"
                  dataKey="netWorth"
                  stroke="var(--color-chart-1)"
                  strokeWidth={1.75}
                  dot={(dotProps: {
                    cx?: number
                    cy?: number
                    index?: number
                    payload?: unknown
                  }) => (
                    <SummaryRecordedDot
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      index={dotProps.index}
                      payload={dotProps.payload}
                      selected={
                        active !== null &&
                        active.index === dotProps.index &&
                        active.date === readSnapshotDate(dotProps.payload)
                      }
                      onSelect={(candidate) => {
                        const valid = summaryPointSelection(
                          visual.points,
                          candidate.index,
                          candidate.date
                        )
                        if (valid) setSelection({ period, point: valid })
                      }}
                    />
                  )}
                  activeDot={{ r: 3.5, strokeWidth: 0, style: { pointerEvents: 'none' } }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  itemStyle={CHART_ITEM_STYLE}
                  labelStyle={CHART_LABEL_STYLE}
                  labelFormatter={(date) => formatSnapshotDate(String(date))}
                  formatter={(value) => [
                    typeof value === 'number' && Number.isSafeInteger(value)
                      ? formatMoney(value, visual.currency)
                      : '—',
                    t('overview.netWorth'),
                  ]}
                />
              </LineChart>
            </SafeChart>
          </div>
        </div>
        <div
          className="text-muted-foreground mt-1 grid min-w-0 grid-cols-2 gap-x-3 text-[10px] leading-tight"
          data-testid="overview-summary-endpoints"
          aria-hidden="true"
        >
          <span className="min-w-0" data-testid="overview-summary-endpoint-start">
            <time dateTime={start.date} className="block tabular-nums">
              {formatEndpointDate(start.date, includeYear)}
            </time>
            <span className="text-foreground mt-0.5 block font-medium break-all tabular-nums">
              {startAmount}
            </span>
          </span>
          <span className="min-w-0 text-right" data-testid="overview-summary-endpoint-end">
            <time dateTime={end.date} className="block tabular-nums">
              {formatEndpointDate(end.date, includeYear)}
            </time>
            <span className="text-foreground mt-0.5 block font-medium break-all tabular-nums">
              {endAmount}
            </span>
          </span>
        </div>
        <SummaryPointInspection
          points={visual.points}
          currency={visual.currency}
          active={active}
          onSelect={(point) => setSelection({ period, point })}
          onClear={() => setSelection(null)}
        />
        <p id={SUMMARY_RECORDED_CAPTION_ID} className="sr-only">
          {caption}
        </p>
        <div className="sr-only">
          <table id={SUMMARY_RECORDED_TABLE_ID}>
            <caption>{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{t('overview.summaryDate')}</th>
                <th scope="col">{t('overview.netWorth')}</th>
              </tr>
            </thead>
            <tbody>
              {visual.points.map((point, index) => (
                <tr key={`${point.date}-${index}`}>
                  <th scope="row">
                    <time dateTime={point.date}>{formatSnapshotDate(point.date)}</time>
                  </th>
                  <td>{formatMoney(point.netWorth, visual.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (visual.kind === 'point') {
    const { point, currency } = visual
    const caption = t('overview.summaryRecorded', {
      count: 1,
      period: periodLabel,
      start: formatSnapshotDate(point.date),
      end: formatSnapshotDate(point.date),
    })
    return (
      <div className="shrink-0" data-testid="overview-summary-recorded-point">
        <div
          className="flex h-28 min-w-0 items-end"
          role="img"
          aria-labelledby={SUMMARY_RECORDED_CAPTION_ID}
          aria-describedby={SUMMARY_RECORDED_TABLE_ID}
        >
          <span
            data-testid="overview-summary-single-dot"
            className="mb-1 block size-2 rounded-full"
            style={{ backgroundColor: 'var(--color-chart-1)' }}
            aria-hidden="true"
          />
        </div>
        <p className="text-foreground mt-1 text-xs leading-snug break-words">
          <time dateTime={point.date} className="tabular-nums">
            {formatSnapshotDate(point.date)}
          </time>
          <span className="mt-0.5 block font-medium break-all tabular-nums">
            {formatMoney(point.netWorth, currency)}
          </span>
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-snug break-words">
          {t('overview.summaryOneSnapshot')}
        </p>
        <p id={SUMMARY_RECORDED_CAPTION_ID} className="sr-only">
          {caption}
        </p>
        <div className="sr-only">
          <table id={SUMMARY_RECORDED_TABLE_ID}>
            <caption>{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{t('overview.summaryDate')}</th>
                <th scope="col">{t('overview.netWorth')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  <time dateTime={point.date}>{formatSnapshotDate(point.date)}</time>
                </th>
                <td>{formatMoney(point.netWorth, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (visual.kind === 'composition') {
    const { composition } = visual
    const caption = t('overview.summaryComposition', { currency: composition.currency })
    const liabilityLine =
      composition.liabilities > 0
        ? t('overview.summaryLiabilities', {
            amount: formatMoney(composition.liabilities, composition.currency),
          })
        : null
    return (
      <div className="shrink-0">
        <div
          className="flex h-28 min-w-0 items-end"
          data-testid="overview-summary-composition"
          role="img"
          aria-labelledby={SUMMARY_COMPOSITION_CAPTION_ID}
          aria-describedby={SUMMARY_COMPOSITION_TABLE_ID}
        >
          {composition.segments.length > 0 ? (
            <div
              className="flex h-2 w-full min-w-0 overflow-hidden rounded-full"
              aria-hidden="true"
            >
              {composition.segments.map((segment, index) => (
                <span
                  key={segment.id}
                  data-testid="composition-segment"
                  data-segment={segment.id}
                  data-kind={segment.kind}
                  title={`${segment.kind === 'holdings' ? t('overview.summaryHoldings') : segment.name} ${formatMoney(segment.amount, composition.currency)}`}
                  className="h-full"
                  style={{
                    flexGrow: segment.amount,
                    flexBasis: 0,
                    backgroundColor: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
                  }}
                />
              ))}
            </div>
          ) : liabilityLine ? (
            <p className="text-muted-foreground text-xs leading-snug break-words tabular-nums">
              {liabilityLine}
            </p>
          ) : null}
        </div>
        <p
          data-testid="overview-summary-range-context"
          className="text-muted-foreground mt-2 text-xs leading-snug break-words"
        >
          {t('overview.summaryRangeEmpty', { range: periodLabel })}
        </p>
        <p
          id={SUMMARY_COMPOSITION_CAPTION_ID}
          className="text-muted-foreground mt-1 text-xs leading-snug break-words"
        >
          {caption}
        </p>
        {composition.segments.length > 0 && liabilityLine ? (
          <p className="text-muted-foreground mt-1 text-xs leading-snug break-words tabular-nums">
            {liabilityLine}
          </p>
        ) : null}
        <div className="sr-only">
          <table id={SUMMARY_COMPOSITION_TABLE_ID}>
            <caption>{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{t('overview.summarySegment')}</th>
                <th scope="col">{t('overview.summaryAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {composition.segments.map((segment) => (
                <tr key={segment.id}>
                  <th scope="row">
                    {segment.kind === 'holdings' ? t('overview.summaryHoldings') : segment.name}
                  </th>
                  <td>{formatMoney(segment.amount, composition.currency)}</td>
                </tr>
              ))}
              {composition.totalAssets > 0 ? (
                <tr>
                  <th scope="row">{t('overview.summaryAssets')}</th>
                  <td>{formatMoney(composition.totalAssets, composition.currency)}</td>
                </tr>
              ) : null}
              {composition.liabilities > 0 ? (
                <tr>
                  <th scope="row">{t('overview.summaryLiabilitiesLabel')}</th>
                  <td>{formatMoney(composition.liabilities, composition.currency)}</td>
                </tr>
              ) : null}
              <tr>
                <th scope="row">{t('overview.netWorth')}</th>
                <td>{formatMoney(composition.netWorth, composition.currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const message =
    visual.reason === 'history-loading'
      ? t('overview.summaryHistoryLoading', { range: periodLabel })
      : t(PLAIN_MESSAGE[visual.reason])
  return (
    <div className="flex h-28 shrink-0 items-end">
      <div className="min-w-0">
        <p
          data-testid="overview-summary-plain"
          data-reason={visual.reason}
          role="status"
          aria-busy={visual.reason === 'history-loading' ? true : undefined}
          className="text-muted-foreground max-w-prose text-xs leading-snug break-words"
        >
          {message}
          {visual.reason === 'history-unavailable' && historyUnavailableMessage
            ? ` · ${historyUnavailableMessage}`
            : ''}
        </p>
        {visual.reason === 'history-loading' ? null : (
          <p
            data-testid="overview-summary-range-context"
            className="text-muted-foreground mt-1 text-xs leading-snug break-words"
          >
            {periodLabel}
          </p>
        )}
      </div>
    </div>
  )
}

function SummaryPointInspection({
  points,
  currency,
  active,
  onSelect,
  onClear,
}: {
  points: readonly SummaryHistoryPoint[]
  currency: string
  active: SummaryPointSelection | null
  onSelect: (selection: SummaryPointSelection) => void
  onClear: () => void
}) {
  const { t } = useTranslation('dashboard')
  const activePoint = active ? points[active.index] : undefined
  const atStart = active?.index === 0
  const atEnd = active !== null && active.index === points.length - 1
  const move = (direction: -1 | 1) => {
    const next = stepSummarySelection(points, active, direction)
    if (next && (next.index !== active?.index || next.date !== active?.date)) onSelect(next)
  }
  return (
    <div
      className="mt-2 flex max-w-full flex-wrap items-center gap-1 motion-reduce:transition-none"
      role="group"
      aria-label={t('overview.summaryInspect.label')}
      data-testid="overview-summary-inspect"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onClear()
        }
      }}
    >
      <button
        type="button"
        className={cn(
          TOUCH_CONTROL,
          'text-muted-foreground hover:text-foreground',
          atStart && 'opacity-50'
        )}
        aria-label={t('overview.summaryInspect.previous')}
        aria-disabled={atStart || undefined}
        onClick={() => {
          if (!atStart) move(-1)
        }}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={cn(
          TOUCH_CONTROL,
          'text-muted-foreground hover:text-foreground',
          atEnd && 'opacity-50'
        )}
        aria-label={t('overview.summaryInspect.next')}
        aria-disabled={atEnd || undefined}
        onClick={() => {
          if (!atEnd) move(1)
        }}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
      {active && activePoint ? (
        <button
          type="button"
          className={cn(TOUCH_CONTROL, 'text-muted-foreground hover:text-foreground')}
          aria-label={t('overview.summaryInspect.clear')}
          onClick={onClear}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      <p
        data-testid="overview-summary-inspection"
        aria-live="polite"
        aria-atomic="true"
        className="text-foreground min-w-0 text-xs leading-snug break-words"
      >
        {active && activePoint ? (
          <>
            <time dateTime={active.date} className="tabular-nums">
              {formatSnapshotDate(active.date)}
            </time>
            <span className="mt-0.5 block font-medium break-all tabular-nums">
              {formatMoney(activePoint.netWorth, currency)}
            </span>
          </>
        ) : null}
      </p>
    </div>
  )
}

function HistoryPeriodControl({
  period,
  onPeriodChange,
}: {
  period: NetWorthPeriod
  onPeriodChange: (period: NetWorthPeriod) => void
}) {
  const { t } = useTranslation('dashboard')
  return (
    <div
      className="border-border bg-muted flex max-w-full overflow-x-auto rounded-lg border p-0.5"
      role="group"
      aria-label={t('overview.historyPeriod')}
    >
      {OVERVIEW_PERIODS.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={period === item}
          onClick={() => onPeriodChange(item)}
          className={cn(
            'min-h-10 min-w-10 shrink-0 rounded-md px-2 py-2 text-xs font-semibold sm:min-h-0 sm:min-w-11 sm:py-1.5',
            period === item
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t(`overview.period.${item}`)}
        </button>
      ))}
    </div>
  )
}

function MonthlyMetricRow({
  icon: Icon,
  iconClassName,
  label,
  value,
  valueClassName,
  detail,
}: {
  icon: typeof Banknote
  iconClassName: string
  label: string
  value: string
  valueClassName?: string
  detail?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 py-2.5 first:pt-0 last:pb-0 md:gap-4 md:py-5">
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg md:size-10',
          iconClassName
        )}
        aria-hidden="true"
      >
        <Icon className="size-4 md:size-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline justify-between gap-x-3">
          <span className="text-muted-foreground shrink-0 text-xs md:text-sm">{label}</span>
          <strong
            className={cn(
              'min-w-0 text-right text-base font-semibold break-all tabular-nums md:text-2xl',
              valueClassName
            )}
          >
            {value}
          </strong>
        </div>
        {detail ? <p className="text-muted-foreground mt-1 text-xs break-words">{detail}</p> : null}
      </div>
    </div>
  )
}
