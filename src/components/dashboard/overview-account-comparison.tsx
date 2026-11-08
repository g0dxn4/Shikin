import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import {
  buildRecordedBalanceModel,
  formatRecordedAxisDate,
  type RecordedBalanceDateTicks,
  type RecordedBalanceModel,
} from '@/components/charts/recorded-balance-model'
import { SafeChart } from '@/components/ui/safe-chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Account } from '@/types/database'
import {
  prepareAccountComparison,
  reconcileComparisonSelection,
  type ComparisonChartPoint,
  type ComparisonDisplayMode,
  type ConvertToPreferred,
  type NetWorthPeriod,
  type PreparedAccountComparison,
} from '@/components/dashboard/overview-account-comparison-helpers'
import { useOverviewAccountComparison } from '@/components/dashboard/use-overview-account-comparison'
import {
  overviewChartLocale,
  overviewDateTickBudget,
} from '@/components/dashboard/overview-chart-policy'
import { useCurrencyStore } from '@/stores/currency-store'

interface OverviewAccountComparisonProps {
  accounts: Account[]
  preferredCurrency?: string
  rates?: unknown
  invalidRates?: unknown
  convertToPreferred?: unknown
  selection: [string, string]
  onSelectionChange: (selection: [string, string]) => void
  period: NetWorthPeriod
  onPeriodChange: (period: NetWorthPeriod) => void
  mode: ComparisonDisplayMode
  onModeChange: (mode: ComparisonDisplayMode) => void
}

const PERIODS: NetWorthPeriod[] = ['month', '3m', '6m', 'ytd', '1y', 'all']

/** Chart box. Inner plot is the box minus the top margin and the date-axis band. */
const COMPARE_CHART_BOX_PX = 300
const COMPARE_MARGIN_TOP = 12
const COMPARE_X_AXIS_HEIGHT = 36
const COMPARE_PLOT_INNER_PX = COMPARE_CHART_BOX_PX - COMPARE_MARGIN_TOP - COMPARE_X_AXIS_HEIGHT
const COMPARE_CHART_MARGIN = { top: COMPARE_MARGIN_TOP, right: 4, bottom: 0, left: 0 } as const
const COMPARE_TICK_FILL = 'var(--color-foreground)'
const COMPARE_CAPTION_ID = 'overview-comparison-recorded-caption'
const COMPARE_TABLE_ID = 'overview-comparison-recorded-snapshots'
const COMPARE_DISCLOSURE =
  'text-accent focus-visible:ring-ring inline-flex min-h-11 cursor-pointer list-none items-center rounded-md px-1 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none sm:min-h-8 [&::-webkit-details-marker]:hidden'
const COMPARE_FOOTER_BUTTON =
  'focus-visible:ring-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface px-2.5 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none sm:min-h-8 sm:min-w-8'

type ComparePlottedModel = Exclude<RecordedBalanceModel, { status: 'invalid' | 'empty' }>
type CompareSeriesModel = ComparePlottedModel & { status: 'series' }

function isCompareSeries(model: RecordedBalanceModel | null): model is CompareSeriesModel {
  return model?.status === 'series'
}

function safeCentavos(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

interface ComparisonPlotRow {
  date: string
  first: number | null
  second: number | null
  utcTimestamp: number
}

function comparisonFullDate(utcTimestamp: number, locale: string) {
  return formatRecordedAxisDate(utcTimestamp, locale, true)
}

/**
 * Axis extent only. Same-day rows are the two accounts' real observations,
 * not one financial series and not a derived balance.
 * Returns null when a non-null amount is not an integer centavo.
 */
function comparisonAxisRows(
  points: readonly ComparisonChartPoint[]
): { date: string; amountCentavos: number }[] | null {
  const rows: { date: string; amountCentavos: number }[] = []
  for (const point of points) {
    if (point.first !== null) {
      if (!Number.isSafeInteger(point.first)) return null
      rows.push({ date: point.date, amountCentavos: point.first })
    }
    if (point.second !== null) {
      if (!Number.isSafeInteger(point.second)) return null
      rows.push({ date: point.date, amountCentavos: point.second })
    }
  }
  return rows
}

function comparisonChartRows(
  points: readonly ComparisonChartPoint[],
  model: CompareSeriesModel
): ComparisonPlotRow[] | null {
  const utcByDate = new Map<string, number>()
  for (const point of model.points) {
    const existing = utcByDate.get(point.date)
    if (existing !== undefined && existing !== point.utcTimestamp) return null
    utcByDate.set(point.date, point.utcTimestamp)
  }
  const rows: ComparisonPlotRow[] = []
  for (const point of points) {
    const utcTimestamp = utcByDate.get(point.date)
    if (utcTimestamp === undefined) return null
    rows.push({
      date: point.date,
      first: point.first,
      second: point.second,
      utcTimestamp,
    })
  }
  return rows
}

function accountHasLine(points: readonly ComparisonChartPoint[]): boolean {
  let first = 0
  let second = 0
  for (const point of points) {
    if (point.first !== null) first += 1
    if (point.second !== null) second += 1
    if (first >= 2 || second >= 2) return true
  }
  return false
}

function observationCount(points: readonly ComparisonChartPoint[]): number {
  let count = 0
  for (const point of points) {
    if (point.first !== null) count += 1
    if (point.second !== null) count += 1
  }
  return count
}

const INVALID_COMPARISON: PreparedAccountComparison = {
  complete: false,
  points: [],
  firstStartDate: null,
  secondStartDate: null,
  missingCurrencies: [],
  reason: 'invalid_currency_data',
}

export function OverviewAccountComparison({
  accounts,
  preferredCurrency: legacyPreferredCurrency,
  selection,
  onSelectionChange,
  period,
  onPeriodChange,
  mode,
  onModeChange,
}: OverviewAccountComparisonProps) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = overviewChartLocale(i18n?.resolvedLanguage ?? i18n?.language)
  const mainCurrency = useCurrencyStore((state) => state.mainCurrency)
  const setupDraft = useCurrencyStore((state) => state.preferredCurrency)
  const manualRates = useCurrencyStore((state) => state.manualRates)
  const convertToPreferred: ConvertToPreferred = useCurrencyStore(
    (state) => state.convertHistoricalToPreferred
  )
  const preferredCurrency = mainCurrency ?? legacyPreferredCurrency ?? setupDraft
  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts])
  const effectiveSelection = reconcileComparisonSelection(accountIds, selection)

  const firstAccount = accounts.find((account) => account.id === effectiveSelection[0])
  const secondAccount = accounts.find((account) => account.id === effectiveSelection[1])
  const { firstHistory, secondHistory, isLoading, error } = useOverviewAccountComparison(
    firstAccount?.id ?? '',
    secondAccount?.id ?? '',
    period
  )

  const comparison = useMemo(() => {
    // The store converter is stable; manual authority is an explicit dependency.
    void preferredCurrency
    void manualRates
    if (!firstAccount || !secondAccount) return INVALID_COMPARISON
    return prepareAccountComparison(
      firstHistory,
      secondHistory,
      firstAccount,
      secondAccount,
      mode,
      convertToPreferred
    )
  }, [
    convertToPreferred,
    firstAccount,
    firstHistory,
    mode,
    preferredCurrency,
    manualRates,
    secondAccount,
    secondHistory,
  ])
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotWidth, setPlotWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth
  )
  const axisRows = comparison.complete ? comparisonAxisRows(comparison.points) : null
  const axisModel =
    axisRows && preferredCurrency
      ? buildRecordedBalanceModel(axisRows, preferredCurrency, {
          includeZero: false,
          locale,
          maxDateTicks: overviewDateTickBudget(plotWidth),
        })
      : null
  const chartRows = isCompareSeries(axisModel)
    ? comparisonChartRows(comparison.points, axisModel)
    : null
  const showComparisonChart = chartRows !== null && accountHasLine(comparison.points)
  useLayoutEffect(() => {
    if (!showComparisonChart) return
    const element = plotRef.current
    const read = () => {
      const measured = element?.clientWidth ?? 0
      const next = measured > 0 ? measured : typeof window === 'undefined' ? 0 : window.innerWidth
      setPlotWidth((current) => (current === next ? current : next))
    }
    read()
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [showComparisonChart])

  if (accounts.length < 2) {
    return (
      <div className="bg-muted flex min-h-52 items-center justify-center rounded-xl px-5 text-center">
        <p className="text-muted-foreground max-w-md text-sm">
          {accounts.length === 0
            ? t('overview.comparison.noAccounts')
            : t('overview.comparison.needTwoAccounts')}
        </p>
      </div>
    )
  }

  if (!firstAccount || !secondAccount) return null

  const firstLatest = findLatestRecord(comparison.points, 'first')
  const secondLatest = findLatestRecord(comparison.points, 'second')
  const hasNoHistory =
    !isLoading && !error && (firstHistory.length === 0 || secondHistory.length === 0)
  const conversionMessage =
    comparison.reason === 'invalid_currency_data'
      ? t('overview.comparison.invalidConversion')
      : comparison.reason === 'main_currency_unconfigured'
        ? t('overview.comparison.unavailable')
        : t('overview.comparison.missingRates', {
            currencies: comparison.missingCurrencies.join(', '),
          })

  const selectAccount = (side: 'first' | 'second', accountId: string) => {
    const [first, second] = effectiveSelection
    if (side === 'first') {
      onSelectionChange(accountId === second ? [accountId, first] : [accountId, second])
    } else {
      onSelectionChange(accountId === first ? [second, accountId] : [first, accountId])
    }
  }

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <AccountSelect
          id="overview-compare-first"
          label={t('overview.comparison.firstAccount')}
          value={firstAccount.id}
          accounts={accounts}
          onChange={(value) => selectAccount('first', value)}
        />
        <AccountSelect
          id="overview-compare-second"
          label={t('overview.comparison.secondAccount')}
          value={secondAccount.id}
          accounts={accounts}
          onChange={(value) => selectAccount('second', value)}
        />
      </div>

      <p className="text-muted-foreground mt-3 text-xs">
        {t('overview.comparison.recordedSnapshots')}
        {mainCurrency &&
        (firstAccount.currency !== preferredCurrency ||
          secondAccount.currency !== preferredCurrency)
          ? ` ${t('overview.comparison.currentFx', { currency: preferredCurrency })}`
          : ''}
      </p>

      {mode === 'change' && comparison.complete ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {t('overview.comparison.baseline', {
            first: firstAccount.name,
            firstDate: formatSnapshotDate(comparison.firstStartDate),
            second: secondAccount.name,
            secondDate: formatSnapshotDate(comparison.secondStartDate),
          })}
        </p>
      ) : null}

      {isLoading ? (
        <div className="mt-4" role="status">
          <p className="text-muted-foreground text-sm">{t('overview.comparison.loading')}</p>
        </div>
      ) : error ? (
        <div
          className="border-destructive/30 bg-destructive/10 mt-4 rounded-xl border px-4 py-4 text-center"
          role="alert"
        >
          <p className="text-destructive text-sm font-semibold">
            {t('overview.comparison.loadError')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{error}</p>
        </div>
      ) : !comparison.complete ? (
        <div
          className="border-warning/30 bg-warning/10 mt-4 rounded-xl border px-4 py-4 text-center"
          role="alert"
        >
          <p className="text-warning text-sm font-semibold">
            {t('overview.comparison.unavailable')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{conversionMessage}</p>
        </div>
      ) : hasNoHistory ? (
        <p className="text-muted-foreground mt-4 text-sm break-words">
          {t('overview.comparison.noHistory', {
            accounts: [
              firstHistory.length === 0 ? firstAccount.name : null,
              secondHistory.length === 0 ? secondAccount.name : null,
            ]
              .filter(Boolean)
              .join(', '),
          })}
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <ComparisonValue
              name={firstAccount.name}
              value={firstLatest?.value ?? null}
              recordedAt={firstLatest?.date ?? null}
              currency={preferredCurrency}
              isDebt={
                mode === 'balance' &&
                firstAccount.type === 'credit_card' &&
                firstLatest !== null &&
                firstLatest.value < 0
              }
              debtLabel={t('overview.comparison.debtBalance')}
              lastRecordedLabel={
                firstLatest
                  ? t('overview.comparison.lastRecorded', {
                      date: formatSnapshotDate(firstLatest.date),
                    })
                  : null
              }
            />
            <ComparisonValue
              name={secondAccount.name}
              value={secondLatest?.value ?? null}
              recordedAt={secondLatest?.date ?? null}
              currency={preferredCurrency}
              isDebt={
                mode === 'balance' &&
                secondAccount.type === 'credit_card' &&
                secondLatest !== null &&
                secondLatest.value < 0
              }
              debtLabel={t('overview.comparison.debtBalance')}
              lastRecordedLabel={
                secondLatest
                  ? t('overview.comparison.lastRecorded', {
                      date: formatSnapshotDate(secondLatest.date),
                    })
                  : null
              }
            />
          </dl>
          {showComparisonChart && chartRows && isCompareSeries(axisModel) && preferredCurrency ? (
            <ComparisonSeriesChart
              model={axisModel}
              rows={chartRows}
              locale={locale}
              periodLabel={t(`overview.period.${period}`)}
              firstName={firstAccount.name}
              secondName={secondAccount.name}
              currency={preferredCurrency}
              plotRef={plotRef}
              tickBudget={overviewDateTickBudget(plotWidth)}
            />
          ) : (
            <p
              data-testid="overview-comparison-no-line"
              className="text-muted-foreground mt-3 max-w-prose text-xs leading-snug break-words"
            >
              {axisModel?.status === 'flat'
                ? t('overview.summaryUnchanged')
                : observationCount(comparison.points) <= 1
                  ? t('overview.summaryOneSnapshot')
                  : t('overview.comparison.noLine')}
            </p>
          )}
          <details className="mt-2">
            <summary className={COMPARE_DISCLOSURE}>{t('overview.viewChartData')}</summary>
            <div className="max-w-full overflow-x-auto">
              <table id={COMPARE_TABLE_ID} className="mt-2 w-full min-w-[420px] text-xs">
                <caption className="text-muted-foreground py-1 text-left">
                  {t('overview.comparison.chartLabel', {
                    first: firstAccount.name,
                    second: secondAccount.name,
                  })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-1 pr-4 text-left font-medium">
                      {t('analytics.day')}
                    </th>
                    <th scope="col" className="py-1 pr-4 text-left font-medium">
                      {firstAccount.name}
                    </th>
                    <th scope="col" className="py-1 text-left font-medium">
                      {secondAccount.name}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.points.map((point) => (
                    <tr key={point.date}>
                      <th scope="row" className="py-1 pr-4 text-left font-normal">
                        <time dateTime={point.date}>{dayjs(point.date).format('MMM D, YYYY')}</time>
                      </th>
                      <td className="py-1 pr-4 tabular-nums">
                        {formatOptionalMoney(point.first, preferredCurrency)}
                      </td>
                      <td className="py-1 tabular-nums">
                        {formatOptionalMoney(point.second, preferredCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div
        className="mt-3 flex max-w-full flex-wrap items-end justify-end gap-x-3 gap-y-2 motion-reduce:transition-none"
        data-testid="overview-comparison-controls"
      >
        <SegmentedControl
          label={t('overview.comparison.display')}
          value={mode}
          items={[
            { value: 'balance', label: t('overview.comparison.balance') },
            { value: 'change', label: t('overview.comparison.change') },
          ]}
          onChange={(value) => onModeChange(value as ComparisonDisplayMode)}
        />
        <PeriodControl
          period={period}
          onChange={onPeriodChange}
          label={t('overview.comparison.period')}
        />
      </div>
    </div>
  )
}

function AccountSelect({
  id,
  label,
  value,
  accounts,
  onChange,
}: {
  id: string
  label: string
  value: string
  accounts: Account[]
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0 sm:flex-1 sm:basis-44">
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SegmentedControl({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground mb-1 block text-xs font-medium">{label}</span>
      <div className="flex max-w-full flex-wrap justify-end gap-1" role="group" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={value === item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              COMPARE_FOOTER_BUTTON,
              value === item.value
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PeriodControl({
  period,
  onChange,
  label,
}: {
  period: NetWorthPeriod
  onChange: (period: NetWorthPeriod) => void
  label: string
}) {
  const { t } = useTranslation('dashboard')
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground mb-1 block text-xs font-medium">{label}</span>
      <div className="flex max-w-full flex-wrap justify-end gap-1" role="group" aria-label={label}>
        {PERIODS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={period === item}
            onClick={() => onChange(item)}
            className={cn(
              COMPARE_FOOTER_BUTTON,
              period === item
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(`overview.period.${item}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

function ComparisonValue({
  name,
  value,
  recordedAt,
  currency,
  isDebt,
  debtLabel,
  lastRecordedLabel,
}: {
  name: string
  value: number | null
  recordedAt: string | null
  currency: string
  isDebt: boolean
  debtLabel: string
  lastRecordedLabel: string | null
}) {
  return (
    <div className="border-border min-w-0 rounded-lg border px-3 py-2">
      <dt className="text-muted-foreground text-xs break-words">{name}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="min-w-0 font-semibold break-all tabular-nums">
          {formatOptionalMoney(value, currency)}
        </span>
        {recordedAt && lastRecordedLabel ? (
          <span className="text-muted-foreground text-xs font-normal">{lastRecordedLabel}</span>
        ) : null}
      </dd>
      {isDebt ? (
        <span className="text-muted-foreground mt-0.5 block text-[10px]">{debtLabel}</span>
      ) : null}
    </div>
  )
}

function findLatestRecord(
  points: PreparedAccountComparison['points'],
  key: 'first' | 'second'
): { date: string; value: number } | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index][key]
    if (value !== null) return { date: points[index].date, value }
  }
  return null
}

function formatOptionalMoney(value: number | null, currency: string) {
  return value === null ? '—' : formatMoney(value, currency)
}

function formatSnapshotDate(date: string | null) {
  return date ? dayjs(date).format('MMM D, YYYY') : '—'
}

function ComparisonSeriesChart({
  model,
  rows,
  locale,
  periodLabel,
  firstName,
  secondName,
  currency,
  plotRef,
  tickBudget,
}: {
  model: CompareSeriesModel
  rows: readonly ComparisonPlotRow[]
  locale: string
  periodLabel: string
  firstName: string
  secondName: string
  currency: string
  plotRef: RefObject<HTMLDivElement | null>
  tickBudget: RecordedBalanceDateTicks
}) {
  const { t } = useTranslation('dashboard')
  const start = rows[0]
  const end = rows[rows.length - 1]
  if (!start || !end) return null
  const recordedCount = rows.reduce(
    (count, row) => count + (row.first !== null ? 1 : 0) + (row.second !== null ? 1 : 0),
    0
  )
  const caption = t('overview.summaryCoverage', {
    currency,
    start: comparisonFullDate(start.utcTimestamp, locale),
    end: comparisonFullDate(end.utcTimestamp, locale),
    count: recordedCount,
    period: periodLabel,
  })

  return (
    <figure className="mt-3 min-w-0" aria-labelledby={COMPARE_CAPTION_ID}>
      <figcaption id={COMPARE_CAPTION_ID}>
        <p className="text-foreground text-sm font-semibold">
          {t('overview.comparison.chartLabel', { first: firstName, second: secondName })}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs break-words">{caption}</p>
      </figcaption>
      <ul className="text-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: 'var(--color-chart-1)' }}
            aria-hidden="true"
          />
          {firstName}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: 'var(--color-chart-2)' }}
            aria-hidden="true"
          />
          {secondName}
        </li>
      </ul>
      <div
        ref={plotRef}
        className="-mx-4 mt-2 h-[300px] min-w-0 sm:mx-0"
        data-testid="overview-comparison-plot"
        data-chart-box={COMPARE_CHART_BOX_PX}
        data-plot-inner={COMPARE_PLOT_INNER_PX}
        data-max-date-ticks={model.dateTicks.length}
        data-tick-budget={tickBudget}
        data-include-zero="false"
        data-point-count={rows.length}
        role="img"
        aria-label={t('overview.comparison.chartLabel', { first: firstName, second: secondName })}
      >
        <SafeChart>
          <LineChart data={[...rows]} margin={COMPARE_CHART_MARGIN} accessibilityLayer={false}>
            <CompareAxes model={model} locale={locale} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: 'var(--color-border)' }}
              content={(props) => (
                <CompareTooltip
                  active={props.active}
                  payload={props.payload}
                  formatExact={model.formatExact}
                  locale={locale}
                  firstName={firstName}
                  secondName={secondName}
                />
              )}
            />
            {/*
              connectNulls joins each account's own observations across a union-timeline
              slot where only the other account has a date. Null stays null in the data:
              it is not zero, not a forward-filled measurement, and not a third series.
              type="linear" is a straight segment between those observations, not a
              smoothed path or a balance between the dates.
            */}
            <Line
              type="linear"
              dataKey="first"
              name={firstName}
              connectNulls
              isAnimationActive={false}
              stroke="var(--color-chart-1)"
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0 }}
              activeDot={false}
            />
            <Line
              type="linear"
              dataKey="second"
              name={secondName}
              connectNulls
              isAnimationActive={false}
              stroke="var(--color-chart-2)"
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0 }}
              activeDot={false}
            />
          </LineChart>
        </SafeChart>
      </div>
      <details className="mt-2">
        <summary className={COMPARE_DISCLOSURE}>{t('overview.comparison.joinLabel')}</summary>
        <p className="text-muted-foreground mt-1 max-w-prose text-xs leading-snug">
          {t('overview.comparison.join')}
        </p>
      </details>
    </figure>
  )
}

function CompareAxes({ model, locale }: { model: CompareSeriesModel; locale: string }) {
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
        height={COMPARE_X_AXIS_HEIGHT}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-chart-axis)' }}
        padding={{ left: 0, right: 0 }}
        allowDataOverflow
        tick={(props) => (
          <CompareDateTick
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
          <CompareMoneyTick
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

function CompareDateTick({
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
  const full = comparisonFullDate(value, locale)
  return (
    <text
      x={x}
      y={y}
      dy={14}
      textAnchor={anchor}
      data-anchor={anchor}
      fill={COMPARE_TICK_FILL}
      fontSize={12}
      data-full={full}
    >
      <title>{full}</title>
      {formatDate(value)}
    </text>
  )
}

function CompareMoneyTick({
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
      fill={COMPARE_TICK_FILL}
      fontSize={12}
      data-full={full}
    >
      <title>{full}</title>
      {formatAxis(value)}
    </text>
  )
}

function CompareTooltip({
  active,
  payload,
  formatExact,
  locale,
  firstName,
  secondName,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: Partial<ComparisonPlotRow> }>
  formatExact: (centavos: number) => string
  locale: string
  firstName: string
  secondName: string
}) {
  const point = payload?.[0]?.payload
  const utcTimestamp = point?.utcTimestamp
  if (!active || !point || utcTimestamp === undefined || !Number.isFinite(utcTimestamp)) return null
  const rows = [
    { name: firstName, value: point.first },
    { name: secondName, value: point.second },
  ].flatMap((row) => (safeCentavos(row.value) ? [{ name: row.name, value: row.value }] : []))
  if (rows.length === 0) return null
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <p className="recharts-tooltip-label" style={{ ...CHART_LABEL_STYLE, margin: 0 }}>
        {comparisonFullDate(utcTimestamp, locale)}
      </p>
      {rows.map((row) => (
        <p key={row.name} style={{ ...CHART_ITEM_STYLE, margin: '2px 0 0' }}>
          <span className="recharts-tooltip-item-name">{row.name}</span>
          <span className="recharts-tooltip-item-value">{formatExact(row.value)}</span>
        </p>
      ))}
    </div>
  )
}
