import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import dayjs from 'dayjs'
import { Banknote, PiggyBank, Receipt } from 'lucide-react'
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
  type SummaryCompositionAccount,
  type SummaryPlainReason,
} from '@/components/dashboard/overview-summary-visual'

export type NetWorthPeriod = 'month' | '3m' | '6m' | 'ytd' | '1y' | 'all'
type OverviewView = 'summary' | 'history' | 'comparison'

const OVERVIEW_PERIODS: NetWorthPeriod[] = ['month', '3m', '6m', 'ytd', '1y', 'all']
const OVERVIEW_VIEWS: OverviewView[] = ['summary', 'history', 'comparison']

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
    currentComplete,
    currentAmount,
    currentCurrency,
    totalAssets,
    totalLiabilities,
    totalInvestments,
    accountAssets,
    accountLiabilities,
  })

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
          className="border-border bg-muted flex max-w-full overflow-x-auto rounded-lg border p-0.5"
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
                'min-h-10 shrink-0 rounded-md px-3 py-2 text-xs font-semibold sm:min-h-0 sm:py-1.5',
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
              <SummaryVisualSlot
                visual={summaryVisual}
                periodLabel={t(`overview.period.${period}`)}
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
                      {history.map((point) => (
                        <tr key={point.date}>
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
  'composition-unproven': 'overview.summaryCompositionUnproven',
  'current-only': 'overview.summaryCurrentOnly',
} as const satisfies Record<SummaryPlainReason, `overview.${string}`>

function formatSnapshotDate(date: string) {
  return dayjs(date).format('MMM D, YYYY')
}

function SummaryVisualSlot({
  visual,
  periodLabel,
}: {
  visual: ReturnType<typeof selectSummaryVisual>
  periodLabel: string
}) {
  const { t } = useTranslation('dashboard')

  if (visual.kind === 'line') {
    const start = visual.points[0]!
    const end = visual.points[visual.points.length - 1]!
    const caption = t('overview.summaryRecorded', {
      count: visual.points.length,
      period: periodLabel,
      start: formatSnapshotDate(start.date),
      end: formatSnapshotDate(end.date),
    })
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
                <Line
                  type="linear"
                  dataKey="netWorth"
                  stroke="var(--color-chart-1)"
                  strokeWidth={1.75}
                  dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--color-chart-1)' }}
                  activeDot={{ r: 3.5, strokeWidth: 0 }}
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
        <p
          id={SUMMARY_RECORDED_CAPTION_ID}
          className="text-muted-foreground mt-2 text-xs leading-snug break-words"
        >
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
          id={SUMMARY_COMPOSITION_CAPTION_ID}
          className="text-muted-foreground mt-2 text-xs leading-snug break-words"
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

  return (
    <div className="flex h-28 shrink-0 items-end">
      <p
        data-testid="overview-summary-plain"
        data-reason={visual.reason}
        className="text-muted-foreground max-w-prose text-xs leading-snug break-words"
      >
        {t(PLAIN_MESSAGE[visual.reason])}
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
