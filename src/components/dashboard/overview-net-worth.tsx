import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Banknote, PiggyBank, Receipt } from 'lucide-react'
import {
  buildRecordedBalanceModel,
  formatRecordedAxisDate,
  type RecordedBalanceDateTicks,
  type RecordedBalanceModel,
  type RecordedBalancePoint,
} from '@/components/charts/recorded-balance-model'
import { NativePanel } from '@/components/ui/native-layout'
import { SafeChart } from '@/components/ui/safe-chart'
import {
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Account } from '@/types/database'
import type {
  ComparisonDisplayMode,
  NetWorthPeriod,
} from '@/components/dashboard/overview-account-comparison-helpers'
import { OverviewAccountComparison } from '@/components/dashboard/overview-account-comparison'
import { OverviewRecordedFigure } from '@/components/dashboard/overview-recorded-figure'
import {
  selectSummaryVisual,
  type SummaryCompositionAccount,
} from '@/components/dashboard/overview-summary-visual'

type OverviewView = 'summary' | 'history' | 'comparison'

const OVERVIEW_PERIODS: NetWorthPeriod[] = ['month', '3m', '6m', 'ytd', '1y', 'all']
const OVERVIEW_VIEWS: OverviewView[] = ['summary', 'history', 'comparison']

type SummaryRangeName = 'month' | '3m' | '6m' | '1y' | 'all'

function summaryPeriodKey(
  period: NetWorthPeriod
): `overview.period.ytd` | `overview.summaryRange.names.${SummaryRangeName}` {
  if (period === 'ytd') return 'overview.period.ytd'
  return `overview.summaryRange.names.${period}`
}

/** Chart box. Inner plot is the box minus the top margin and the date-axis band. */
const HISTORY_CHART_BOX_PX = 300
const HISTORY_MARGIN_TOP = 12
const HISTORY_X_AXIS_HEIGHT = 36
const HISTORY_PLOT_INNER_PX = HISTORY_CHART_BOX_PX - HISTORY_MARGIN_TOP - HISTORY_X_AXIS_HEIGHT
const HISTORY_CHART_MARGIN = { top: HISTORY_MARGIN_TOP, right: 4, bottom: 0, left: 0 } as const
const HISTORY_TICK_FILL = 'var(--color-foreground)'
const HISTORY_STROKE = 'var(--color-chart-1)'
const HISTORY_CAPTION_ID = 'overview-history-recorded-caption'
const HISTORY_TABLE_ID = 'overview-history-recorded-snapshots'
const HISTORY_DISCLOSURE =
  'text-accent focus-visible:ring-ring inline-flex min-h-11 cursor-pointer list-none items-center rounded-md px-1 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none sm:min-h-8 [&::-webkit-details-marker]:hidden'
const HISTORY_FOOTER_BUTTON =
  'focus-visible:ring-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface px-2 text-xs font-semibold text-foreground focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none sm:min-h-8 sm:min-w-8'

type HistoryPlottedModel = Exclude<RecordedBalanceModel, { status: 'invalid' | 'empty' }>
type HistorySeriesModel = HistoryPlottedModel & { status: 'series' }
type HistoryFlatModel = HistoryPlottedModel & { status: 'flat' }
type HistorySingleModel = HistoryPlottedModel & { status: 'single' }

function isHistorySeries(model: RecordedBalanceModel | null): model is HistorySeriesModel {
  return model?.status === 'series'
}

function isHistoryFlat(model: RecordedBalanceModel | null): model is HistoryFlatModel {
  return model?.status === 'flat'
}

function isHistorySingle(model: RecordedBalanceModel | null): model is HistorySingleModel {
  return model?.status === 'single'
}

function isHistoryPlotted(model: RecordedBalanceModel | null): model is HistoryPlottedModel {
  return model !== null && model.status !== 'invalid' && model.status !== 'empty'
}

function safeCentavos(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** 2 at 320px, 3 at 375px, 5 once the plot is a desktop width. Ends stay anchored. */
function historyDateTickBudget(width: number): RecordedBalanceDateTicks {
  if (!Number.isFinite(width) || width <= 0) return 5
  if (width < 330) return 2
  if (width < 768) return 3
  return 5
}

function chartLocale(language: string | undefined): string {
  const value = language?.trim()
  return value && value.length > 0 ? value : 'en'
}

function historyFullDate(utcTimestamp: number, locale: string) {
  return formatRecordedAxisDate(utcTimestamp, locale, true)
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
  const { t, i18n } = useTranslation('dashboard')
  const locale = chartLocale(i18n?.resolvedLanguage ?? i18n?.language)
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
  const historyPeriodLabel = t(`overview.period.${period}`)
  const historyPlotRef = useRef<HTMLDivElement>(null)
  const [historyPlotWidth, setHistoryPlotWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth
  )
  const historyModel =
    hasHistory && historyCurrency
      ? buildRecordedBalanceModel(
          history.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
          historyCurrency,
          {
            includeZero: true,
            locale,
            maxDateTicks: historyDateTickBudget(historyPlotWidth),
          }
        )
      : null
  const historyAligned =
    historyModel !== null &&
    historyModel.status !== 'invalid' &&
    historyModel.status !== 'empty' &&
    historyModel.points.length === history.length &&
    historyModel.points.every(
      (point, index) =>
        point.date === history[index]?.date && point.amountCentavos === history[index]?.netWorth
    )
  const showHistoryChart = historyModel?.status === 'series' && historyAligned
  useLayoutEffect(() => {
    if (!showHistoryChart) return
    const element = historyPlotRef.current
    const read = () => {
      const measured = element?.clientWidth ?? 0
      const next = measured > 0 ? measured : typeof window === 'undefined' ? 0 : window.innerWidth
      setHistoryPlotWidth((current) => (current === next ? current : next))
    }
    read()
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [showHistoryChart])

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
          className={cn('col-start-1 row-start-1 min-w-0', view !== 'summary' && 'hidden')}
          hidden={view !== 'summary'}
          aria-hidden={view !== 'summary'}
          inert={view !== 'summary'}
        >
          <div className="px-4 pt-4 sm:px-6 sm:pt-5">
            <div
              className="grid w-full min-w-0 grid-cols-2 items-start gap-x-4 gap-y-3 sm:grid-cols-4"
              aria-label={t('overview.views.summary')}
              data-testid="overview-summary-metrics"
            >
              <div className="min-w-0">
                <span className="text-muted-foreground text-xs">{t('overview.netWorth')}</span>
                <strong className="mt-0.5 block text-xl font-semibold tracking-tight break-all tabular-nums sm:text-2xl">
                  {hasCurrentValue ? (
                    formatMoney(currentAmount, currentCurrency)
                  ) : (
                    <span className="text-warning">—</span>
                  )}
                </strong>
                {hasCurrentValue ? (
                  <p className="text-muted-foreground mt-1 text-xs break-words">
                    {currentAsOfLabel}
                  </p>
                ) : null}
              </div>
              <CompactMonthlyMetric
                icon={Banknote}
                label={t('cards.income')}
                value={income}
                detail={incomeDetail}
              />
              <CompactMonthlyMetric
                icon={Receipt}
                label={t('cards.spent')}
                value={spent}
                detail={spentDetail}
              />
              <CompactMonthlyMetric
                icon={PiggyBank}
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
            <p className="text-muted-foreground mt-2 text-xs break-words">{monthlySummaryLabel}</p>
            {hasCurrentValue ? null : (
              <p role="alert" className="text-warning mt-2 text-xs break-words">
                {t('currency.totalUnavailable')}
                {unavailableMessage ? ` · ${unavailableMessage}` : ''}
              </p>
            )}
          </div>
          <OverviewRecordedFigure
            visual={summaryVisual}
            period={period}
            periodLabel={summaryPeriodLabel}
            historyUnavailableMessage={historyUnavailableMessage}
            onPeriodChange={onPeriodChange}
          />
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
          <div>
            <h3 className="text-sm font-semibold">{t('overview.netWorthHistory')}</h3>
            <p className="text-muted-foreground mt-1 text-xs">{t('overview.focusDate')}</p>
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
                  period: historyPeriodLabel,
                })}
              </span>
            ) : null}
            {hasHistory ? (
              <span className="text-muted-foreground text-xs">{historyAsOfLabel}</span>
            ) : null}
          </div>

          {!hasHistory ? (
            <div
              className="border-warning/30 bg-warning/10 mt-4 rounded-xl border px-4 py-4 text-center"
              role="alert"
            >
              <p className="text-warning text-sm font-semibold">
                {t('overview.historyUnavailable')}
              </p>
              {historyUnavailableMessage ? (
                <p className="text-muted-foreground mt-1 text-xs">{historyUnavailableMessage}</p>
              ) : null}
            </div>
          ) : showHistoryChart && isHistorySeries(historyModel) ? (
            <HistorySeriesChart
              model={historyModel}
              rows={history}
              locale={locale}
              periodLabel={historyPeriodLabel}
              plotRef={historyPlotRef}
              tickBudget={historyDateTickBudget(historyPlotWidth)}
              seriesName={t('overview.netWorth')}
            />
          ) : isHistoryFlat(historyModel) && historyAligned ? (
            <HistoryFlatFact
              model={historyModel}
              locale={locale}
              periodLabel={historyPeriodLabel}
            />
          ) : isHistorySingle(historyModel) && historyAligned ? (
            <HistorySingleFact
              model={historyModel}
              locale={locale}
              periodLabel={historyPeriodLabel}
            />
          ) : historyModel?.status === 'invalid' ||
            (historyModel?.status === 'series' && !historyAligned) ? (
            <p
              data-testid="overview-history-invalid"
              role="status"
              className="text-muted-foreground mt-4 max-w-prose text-sm break-words"
            >
              {t('overview.historyUnavailable')}
            </p>
          ) : (
            <p className="text-muted-foreground mt-4 text-sm break-words">{emptyHistoryMessage}</p>
          )}

          {hasHistory && historyCurrency && history.length > 0 ? (
            <HistoryExactTable
              rows={history}
              currency={historyCurrency}
              locale={locale}
              periodLabel={historyPeriodLabel}
              timestamps={
                isHistoryPlotted(historyModel)
                  ? historyModel.points.map((point) => point.utcTimestamp)
                  : undefined
              }
            />
          ) : null}
          {showHistoryChart ? (
            <details className="mt-2">
              <summary className={HISTORY_DISCLOSURE}>{t('overview.summaryMethodLabel')}</summary>
              <p className="text-muted-foreground mt-1 max-w-prose text-xs leading-snug">
                {t('overview.summaryMethod')}
              </p>
            </details>
          ) : null}
          <HistoryPeriodControl period={period} onPeriodChange={onPeriodChange} />
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
      className="mt-3 flex max-w-full flex-wrap items-center justify-end gap-1 motion-reduce:transition-none"
      role="group"
      aria-label={t('overview.historyPeriod')}
      data-testid="overview-history-range"
    >
      {OVERVIEW_PERIODS.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={period === item}
          onClick={() => onPeriodChange(item)}
          className={cn(
            HISTORY_FOOTER_BUTTON,
            period === item
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t(`overview.period.${item}`)}
        </button>
      ))}
    </div>
  )
}

function HistorySeriesChart({
  model,
  rows,
  locale,
  periodLabel,
  plotRef,
  tickBudget,
  seriesName,
}: {
  model: HistorySeriesModel
  rows: readonly OverviewHistoryPoint[]
  locale: string
  periodLabel: string
  plotRef: RefObject<HTMLDivElement | null>
  tickBudget: RecordedBalanceDateTicks
  seriesName: string
}) {
  const { t } = useTranslation('dashboard')
  const start = model.points[0]
  const end = model.points[model.points.length - 1]
  const caption = t('overview.summaryCoverage', {
    currency: model.currency,
    start: historyFullDate(start.utcTimestamp, locale),
    end: historyFullDate(end.utcTimestamp, locale),
    count: rows.length,
    period: periodLabel,
  })
  const chartData = rows.map((row, index) => ({
    date: row.date,
    netWorth: row.netWorth,
    amountCentavos: row.netWorth,
    utcTimestamp: model.points[index].utcTimestamp,
    sourceIndex: model.points[index].sourceIndex,
  }))

  return (
    <figure className="mt-3 min-w-0" aria-labelledby={HISTORY_CAPTION_ID}>
      <figcaption id={HISTORY_CAPTION_ID}>
        <p className="text-foreground text-sm font-semibold">{t('overview.chartTitle')}</p>
        <p className="text-muted-foreground mt-0.5 text-xs break-words">{caption}</p>
      </figcaption>
      <div
        ref={plotRef}
        className="-mx-4 mt-2 h-[300px] min-w-0 sm:mx-0"
        data-testid="overview-history-plot"
        data-chart-box={HISTORY_CHART_BOX_PX}
        data-plot-inner={HISTORY_PLOT_INNER_PX}
        data-max-date-ticks={model.dateTicks.length}
        data-tick-budget={tickBudget}
        data-include-zero="true"
        data-point-count={rows.length}
        role="img"
        aria-label={t('overview.chartTitle')}
      >
        <SafeChart>
          <AreaChart data={chartData} margin={HISTORY_CHART_MARGIN} accessibilityLayer={false}>
            <HistoryAxes model={model} locale={locale} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: 'var(--color-border)' }}
              content={(props) => (
                <HistoryTooltip
                  active={props.active}
                  payload={props.payload}
                  formatExact={model.formatExact}
                  locale={locale}
                  name={seriesName}
                />
              )}
            />
            <Area
              type="linear"
              dataKey="netWorth"
              stroke={HISTORY_STROKE}
              strokeWidth={2}
              fill={HISTORY_STROKE}
              fillOpacity={0.12}
              baseValue={0}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={false}
              dot={{ r: 2.5, strokeWidth: 0 }}
            />
          </AreaChart>
        </SafeChart>
      </div>
    </figure>
  )
}

function HistoryAxes({ model, locale }: { model: HistorySeriesModel; locale: string }) {
  return (
    <>
      <CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} />
      <XAxis
        dataKey="utcTimestamp"
        type="number"
        scale="utc"
        domain={[model.xDomain[0], model.xDomain[1]]}
        ticks={[...model.dateTicks]}
        interval={0}
        minTickGap={0}
        height={HISTORY_X_AXIS_HEIGHT}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-chart-axis)' }}
        padding={{ left: 0, right: 0 }}
        allowDataOverflow
        tick={(props) => (
          <HistoryDateTick
            x={props.x}
            y={props.y}
            index={props.index}
            visibleTicksCount={props.visibleTicksCount}
            value={Number(props.payload?.value)}
            locale={locale}
            formatDate={model.formatDate}
          />
        )}
      />
      <YAxis
        type="number"
        domain={[model.yDomain[0], model.yDomain[1]]}
        ticks={[...model.yTicks]}
        width={model.suggestedYWidth}
        interval={0}
        tickLine={false}
        axisLine={false}
        allowDataOverflow
        tick={(props) => (
          <HistoryMoneyTick
            x={props.x}
            y={props.y}
            value={Number(props.payload?.value)}
            formatAxis={model.formatAxis}
            formatExact={model.formatExact}
          />
        )}
      />
    </>
  )
}

function HistoryDateTick({
  x,
  y,
  index,
  visibleTicksCount,
  value,
  locale,
  formatDate,
}: {
  x?: number | string
  y?: number | string
  index?: number
  visibleTicksCount?: number
  value: number
  locale: string
  formatDate: (utcTimestamp: number) => string
}) {
  if (!Number.isFinite(value)) return <g />
  const last = (visibleTicksCount ?? 1) - 1
  const anchor = index === 0 ? 'start' : index === last ? 'end' : 'middle'
  const full = historyFullDate(value, locale)
  return (
    <text
      x={x}
      y={y}
      dy={14}
      textAnchor={anchor}
      data-anchor={anchor}
      fill={HISTORY_TICK_FILL}
      fontSize={12}
      data-full={full}
    >
      <title>{full}</title>
      {formatDate(value)}
    </text>
  )
}

function HistoryMoneyTick({
  x,
  y,
  value,
  formatAxis,
  formatExact,
}: {
  x?: number | string
  y?: number | string
  value: number
  formatAxis: (centavos: number) => string
  formatExact: (centavos: number) => string
}) {
  if (!Number.isFinite(value)) return <g />
  const full = formatExact(value)
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fill={HISTORY_TICK_FILL}
      fontSize={12}
      data-full={full}
    >
      <title>{full}</title>
      {formatAxis(value)}
    </text>
  )
}

function HistoryTooltip({
  active,
  payload,
  formatExact,
  locale,
  name,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: Partial<RecordedBalancePoint> & { netWorth?: number } }>
  formatExact: (centavos: number) => string
  locale: string
  name: string
}) {
  const point = payload?.[0]?.payload
  const utcTimestamp = point?.utcTimestamp
  if (!active || !point || utcTimestamp === undefined || !Number.isFinite(utcTimestamp)) return null
  const recorded = point.amountCentavos
  const fallback = point.netWorth
  const amount = safeCentavos(recorded) ? recorded : safeCentavos(fallback) ? fallback : null
  if (amount === null) return null
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <p className="recharts-tooltip-label" style={{ ...CHART_LABEL_STYLE, margin: 0 }}>
        {historyFullDate(utcTimestamp, locale)}
      </p>
      <p style={{ ...CHART_ITEM_STYLE, margin: '2px 0 0' }}>
        <span className="recharts-tooltip-item-name">{name}</span>
        <span className="recharts-tooltip-item-value">{formatExact(amount)}</span>
      </p>
    </div>
  )
}

function HistoryFlatFact({
  model,
  locale,
  periodLabel,
}: {
  model: HistoryFlatModel
  locale: string
  periodLabel: string
}) {
  const { t } = useTranslation('dashboard')
  const start = model.points[0]
  const end = model.points[model.points.length - 1]
  return (
    <div className="mt-4" data-testid="overview-history-flat">
      <p className="text-foreground text-sm font-semibold">{t('overview.chartTitle')}</p>
      <p className="text-foreground mt-1 text-xs leading-snug break-words">
        <time dateTime={start.date} className="tabular-nums">
          {historyFullDate(start.utcTimestamp, locale)}
        </time>
        {start.date === end.date ? null : (
          <>
            <span aria-hidden="true"> – </span>
            <time dateTime={end.date} className="tabular-nums">
              {historyFullDate(end.utcTimestamp, locale)}
            </time>
          </>
        )}
        <span className="mt-0.5 block font-medium break-all tabular-nums">
          {model.formatExact(start.amountCentavos)}
        </span>
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-snug break-words">
        {t('overview.summaryUnchanged')}
      </p>
      <p className="text-muted-foreground mt-1 text-xs break-words">
        {t('overview.summaryCoverage', {
          currency: model.currency,
          start: historyFullDate(start.utcTimestamp, locale),
          end: historyFullDate(end.utcTimestamp, locale),
          count: model.points.length,
          period: periodLabel,
        })}
      </p>
    </div>
  )
}

function HistorySingleFact({
  model,
  locale,
  periodLabel,
}: {
  model: HistorySingleModel
  locale: string
  periodLabel: string
}) {
  const { t } = useTranslation('dashboard')
  const point = model.points[0]
  return (
    <div className="mt-4" data-testid="overview-history-single">
      <p className="text-foreground text-sm font-semibold">{t('overview.chartTitle')}</p>
      <p className="text-foreground mt-1 text-xs leading-snug break-words">
        <time dateTime={point.date} className="tabular-nums">
          {historyFullDate(point.utcTimestamp, locale)}
        </time>
        <span className="mt-0.5 block font-medium break-all tabular-nums">
          {model.formatExact(point.amountCentavos)}
        </span>
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-snug break-words">
        {t('overview.summaryOneSnapshot')}
      </p>
      <p className="text-muted-foreground mt-1 text-xs break-words">
        {t('overview.summaryCoverage', {
          currency: model.currency,
          start: historyFullDate(point.utcTimestamp, locale),
          end: historyFullDate(point.utcTimestamp, locale),
          count: 1,
          period: periodLabel,
        })}
      </p>
    </div>
  )
}

function HistoryExactTable({
  rows,
  currency,
  locale,
  periodLabel,
  timestamps,
}: {
  rows: readonly OverviewHistoryPoint[]
  currency: string
  locale: string
  periodLabel: string
  timestamps?: readonly number[]
}) {
  const { t } = useTranslation('dashboard')
  const start = timestamps?.[0]
  const end = timestamps?.[timestamps.length - 1]
  const caption =
    start !== undefined && end !== undefined
      ? t('overview.summaryCoverage', {
          currency,
          start: historyFullDate(start, locale),
          end: historyFullDate(end, locale),
          count: rows.length,
          period: periodLabel,
        })
      : t('overview.chartTitle')
  return (
    <details className="mt-2">
      <summary className={HISTORY_DISCLOSURE}>{t('overview.viewChartData')}</summary>
      <div className="max-w-full overflow-x-auto">
        <table id={HISTORY_TABLE_ID} className="mt-2 text-xs">
          <caption className="text-muted-foreground py-1 text-left">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-6 text-left font-medium">
                {t('overview.summaryDate')}
              </th>
              <th scope="col" className="text-left font-medium">
                {t('overview.netWorth')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point, index) => {
              const utc = timestamps?.[index]
              const label =
                utc !== undefined ? historyFullDate(utc, locale) || point.date : point.date
              return (
                <tr key={`${point.date}-${index}`}>
                  <th scope="row" className="py-0.5 pr-6 text-left font-normal">
                    <time dateTime={point.date}>{label}</time>
                  </th>
                  <td className="tabular-nums">{formatMoney(point.netWorth, currency, locale)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function CompactMonthlyMetric({
  icon: Icon,
  label,
  value,
  valueClassName,
  detail,
}: {
  icon: typeof Banknote
  label: string
  value: string
  valueClassName?: string
  detail?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" strokeWidth={1.75} />
        {label}
      </span>
      <strong
        className={cn(
          'mt-0.5 block text-base font-semibold break-all tabular-nums sm:text-lg',
          valueClassName
        )}
      >
        {value}
      </strong>
      {detail ? <p className="text-muted-foreground mt-1 text-xs break-words">{detail}</p> : null}
    </div>
  )
}
