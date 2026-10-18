import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { MetricItem, MetricStrip, NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { heatmapCellStyle, heatmapLegendStyles } from '@/components/insights/heatmap-intensity'
import { fromCentavos, formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import {
  aggregateHeatmapSpending,
  fetchHeatmapLedgerRows,
  type HeatmapConvertedTransaction,
  type HeatmapLedgerRow,
} from '@/lib/spending-heatmap'
import { buildTransactionsHref } from '@/lib/transaction-query-href'
import { useCurrencyStore } from '@/stores/currency-store'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'

const TIME_OPTION_VALUES = ['month', '3months', '6months', 'year'] as const
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function getDateRange(period: string): { start: string; end: string } {
  const now = dayjs()
  const end = now.format('YYYY-MM-DD')
  switch (period) {
    case 'month': {
      const start = now.startOf('month').format('YYYY-MM-DD')
      return { start, end }
    }
    case '3months': {
      const start = now.subtract(3, 'month').startOf('week').format('YYYY-MM-DD')
      return { start, end }
    }
    case '6months': {
      const start = now.subtract(6, 'month').startOf('week').format('YYYY-MM-DD')
      return { start, end }
    }
    case 'year':
    default: {
      const start = now.startOf('year').format('YYYY-MM-DD')
      return { start, end }
    }
  }
}

export function SpendingHeatmap() {
  const { t } = useTranslation('analytics')
  const [timeRange, setTimeRange] = useState('3months')
  const [ledgerRows, setLedgerRows] = useState<HeatmapLedgerRow[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const loadCountRef = useRef(0)
  const { preferredCurrency, mainCurrency, manualRates, loadRates } = useCurrencyStore()

  const { start, end } = useMemo(() => getDateRange(timeRange), [timeRange])
  const timeOptions = useMemo(
    () =>
      TIME_OPTION_VALUES.map((value) => ({
        value,
        label: t(`spendingHeatmap.ranges.${value}`),
      })),
    [t]
  )
  const dayLabels = useMemo(() => DAY_KEYS.map((key) => t(`spendingHeatmap.days.${key}`)), [t])

  useEffect(() => {
    void loadRates().catch(() => {})
  }, [loadRates])

  useEffect(() => {
    const loadId = ++loadCountRef.current

    async function load() {
      try {
        const rows = await fetchHeatmapLedgerRows(start, end)
        if (loadId !== loadCountRef.current) return
        setLedgerRows(rows)
        setLoadError(null)
        setIsLoading(false)
      } catch (error) {
        if (loadId !== loadCountRef.current) return
        setLoadError(getErrorMessage(error))
        setLedgerRows(null)
        setIsLoading(false)
      }
    }

    void load()
  }, [start, end, reloadToken])

  const aggregation = useMemo(() => {
    return ledgerRows
      ? aggregateHeatmapSpending(ledgerRows, {
          mainCurrency,
          manualRates,
          today: dayjs().format('YYYY-MM-DD'),
        })
      : null
  }, [ledgerRows, mainCurrency, manualRates])

  const spendMap = useMemo(
    () => aggregation?.dailyTotals ?? new Map<string, number>(),
    [aggregation]
  )
  const categoryTotals = aggregation?.categoryTotals ?? []
  const complete = aggregation?.complete ?? true
  const displayCurrency = aggregation?.currency ?? preferredCurrency

  const stats = useMemo(() => {
    if (!aggregation?.complete || aggregation.dailyTotals.size === 0) return null

    let highestDate = ''
    let highestAmount = 0
    let totalSpent = 0
    const dayOfWeekTotals = [0, 0, 0, 0, 0, 0, 0]
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]
    let daysCounted = 0
    let d = dayjs(start)
    const endDay = dayjs(end)
    while (d.isBefore(endDay) || d.isSame(endDay, 'day')) {
      const dateStr = d.format('YYYY-MM-DD')
      const amount = spendMap.get(dateStr) ?? 0
      const dow = (d.day() + 6) % 7

      if (amount > highestAmount) {
        highestAmount = amount
        highestDate = dateStr
      }
      totalSpent += amount
      dayOfWeekTotals[dow] += amount
      dayOfWeekCounts[dow]++
      daysCounted++
      d = d.add(1, 'day')
    }

    const avgDaily = daysCounted > 0 ? totalSpent / daysCounted : 0
    let maxDowAvg = 0
    let mostActiveIdx = 0
    for (let i = 0; i < 7; i++) {
      const avg = dayOfWeekCounts[i] > 0 ? dayOfWeekTotals[i] / dayOfWeekCounts[i] : 0
      if (avg > maxDowAvg) {
        maxDowAvg = avg
        mostActiveIdx = i
      }
    }

    let streak = 0
    let currentStreak = 0
    d = dayjs(end)
    const startDay = dayjs(start)
    while (d.isAfter(startDay) || d.isSame(startDay, 'day')) {
      const amount = spendMap.get(d.format('YYYY-MM-DD')) ?? 0
      if (fromCentavos(amount) < 50) {
        currentStreak++
        if (currentStreak > streak) streak = currentStreak
      } else {
        break
      }
      d = d.subtract(1, 'day')
    }

    return {
      highestDate: highestDate ? dayjs(highestDate).format('MMM D') : '-',
      highestAmount,
      avgDaily,
      mostActiveDay: dayLabels[mostActiveIdx],
      streak,
      activeDays: [...spendMap.values()].filter((value) => value > 0).length,
    }
  }, [aggregation, dayLabels, spendMap, start, end])

  const { grid, weekLabels, maxSpend, gridStartDate, computedWeeksCount } = useMemo(() => {
    let startDate = dayjs(start)
    const startDow = (startDate.day() + 6) % 7
    startDate = startDate.subtract(startDow, 'day')
    const today = dayjs()
    const daysSpan = today.diff(startDate, 'day') + 1
    const weeksCount = Math.max(1, Math.ceil(daysSpan / 7))
    const nextGrid: (number | null)[][] = []
    const nextWeekLabels: string[] = []
    let nextMaxSpend = 0

    for (let w = 0; w < weeksCount; w++) {
      const weekStart = startDate.add(w * 7, 'day')
      nextWeekLabels.push(w === 0 || weekStart.date() <= 7 ? weekStart.format('MMM') : '')
    }

    for (let dow = 0; dow < 7; dow++) {
      const row: (number | null)[] = []
      for (let w = 0; w < weeksCount; w++) {
        const cellDate = startDate.add(w * 7 + dow, 'day')
        if (cellDate.isAfter(today, 'day') || cellDate.isBefore(dayjs(start), 'day')) {
          row.push(null)
        } else {
          const amount = spendMap.get(cellDate.format('YYYY-MM-DD')) ?? 0
          if (amount > nextMaxSpend) nextMaxSpend = amount
          row.push(amount)
        }
      }
      nextGrid.push(row)
    }

    return {
      grid: nextGrid,
      weekLabels: nextWeekLabels,
      maxSpend: nextMaxSpend,
      gridStartDate: startDate,
      computedWeeksCount: weeksCount,
    }
  }, [spendMap, start])

  const rangeDays = useMemo(() => {
    if (!aggregation?.complete) return []
    const days: { date: string; amount: number }[] = []
    let cursor = dayjs(start)
    const endDay = dayjs(end)
    const today = dayjs()
    while (cursor.isBefore(endDay) || cursor.isSame(endDay, 'day')) {
      if (!cursor.isAfter(today, 'day')) {
        const date = cursor.format('YYYY-MM-DD')
        days.push({ date, amount: spendMap.get(date) ?? 0 })
      }
      cursor = cursor.add(1, 'day')
    }
    return days
  }, [aggregation, spendMap, start, end])

  const selectedDayTransactions: HeatmapConvertedTransaction[] = selectedDate
    ? (aggregation?.eligibleTransactions ?? []).filter((tx) => tx.date === selectedDate)
    : []
  const catMax = categoryTotals[0]?.total ?? 1
  const totalsUnavailable = Boolean(aggregation && !complete)

  function handleTimeRangeChange(value: string) {
    const currentRange = getDateRange(timeRange)
    const nextRange = getDateRange(value)
    const equivalentRange =
      currentRange.start === nextRange.start && currentRange.end === nextRange.end
    if (value === timeRange && equivalentRange) {
      return
    }
    setTimeRange(value)
    setSelectedDate(null)
    if (!equivalentRange) {
      setIsLoading(true)
    }
  }

  if (isLoading) {
    return (
      <div className="page-content min-w-0" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-content min-w-0">
        <ErrorState
          title={t('spendingHeatmap.loadError')}
          description={loadError}
          onRetry={() => {
            setIsLoading(true)
            setLoadError(null)
            setReloadToken((token) => token + 1)
          }}
        />
      </div>
    )
  }

  const heatmapColumns = `1.75rem repeat(${computedWeeksCount}, minmax(12px, 1fr))`

  return (
    <div className="page-content min-w-0">
      <PageToolbar
        className="items-start gap-3 max-sm:flex-col max-sm:items-stretch"
        leading={
          <div
            className="border-border bg-muted flex max-w-full min-w-0 flex-wrap gap-1 rounded-lg border p-0.5"
            role="group"
            aria-label={t('spendingHeatmap.timeRange')}
          >
            {timeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={timeRange === option.value}
                onClick={() => handleTimeRangeChange(option.value)}
                className={cn(
                  'focus-visible:ring-ring min-h-11 rounded-md px-3 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none',
                  timeRange === option.value
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {totalsUnavailable ? (
        <div
          className="border-warning/30 bg-warning/10 text-warning rounded-xl border px-4 py-3 text-sm"
          role="alert"
        >
          {!mainCurrency
            ? t('reportingFx.unconfigured')
            : aggregation?.reason === 'invalid_currency_data'
              ? t('spendingHeatmap.invalidData', {
                  details: aggregation.missingCurrencies.join(', '),
                })
              : t('spendingHeatmap.incompleteTotals', {
                  currencies: aggregation?.missingCurrencies.join(', ') ?? '',
                })}
          {aggregation?.evidence.currency && (
            <p>
              {t('reportingFx.known', {
                amount:
                  aggregation.evidence.knownTotalCentavos === null
                    ? '—'
                    : formatMoney(
                        aggregation.evidence.knownTotalCentavos,
                        aggregation.evidence.currency
                      ),
              })}
            </p>
          )}
          <p>
            {t('reportingFx.native', {
              amounts:
                aggregation?.evidence.nativeTotals
                  .map((row) => formatMoney(row.amountCentavos, row.currency))
                  .join(' · ') || '—',
            })}
          </p>
        </div>
      ) : null}

      {totalsUnavailable ? null : (
        <NativePanel className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-sm font-semibold">{t('spendingHeatmap.dailyActivity')}</h2>
            <div className="flex items-center gap-2" aria-label={t('spendingHeatmap.legend')}>
              <span className="text-muted-foreground text-[10px]">{t('spendingHeatmap.less')}</span>
              <div className="flex gap-0.5" aria-hidden="true">
                {heatmapLegendStyles().map((style, index) => (
                  <div key={index} className="h-3 w-3 rounded-sm" style={style} />
                ))}
              </div>
              <span className="text-muted-foreground text-[10px]">{t('spendingHeatmap.more')}</span>
            </div>
          </div>
          {!aggregation || aggregation.dailyTotals.size === 0 ? (
            <p className="text-muted-foreground text-sm">{t('spendingHeatmap.noData')}</p>
          ) : (
            <>
              <div className="min-w-0 overflow-x-auto pb-1">
                <div
                  data-heatmap-frame
                  className="w-full"
                  style={{ minWidth: computedWeeksCount * 12 + 28 }}
                >
                  <div
                    className="mb-1 grid gap-[3px]"
                    style={{ gridTemplateColumns: heatmapColumns }}
                  >
                    <span />
                    {weekLabels.map((label, i) => (
                      <span
                        key={i}
                        className="text-muted-foreground truncate font-mono text-[10px]"
                      >
                        {label}
                      </span>
                    ))}
                  </div>

                  <div
                    className="grid gap-[3px]"
                    style={{ gridTemplateColumns: heatmapColumns }}
                    role="grid"
                    aria-label={t('spendingHeatmap.dailyActivity')}
                  >
                    {grid.map((row, r) => (
                      <div key={r} role="row" className="contents">
                        <div className="text-muted-foreground flex items-center font-mono text-[10px]">
                          {r % 2 === 0 ? dayLabels[r].slice(0, 2) : ''}
                        </div>
                        {row.map((value, c) => {
                          const cellDate = gridStartDate.add(c * 7 + r, 'day')
                          const dateLabel = cellDate.format('YYYY-MM-DD')
                          const selected = selectedDate === dateLabel
                          return (
                            <button
                              key={`${r}-${c}`}
                              type="button"
                              disabled={value === null}
                              aria-pressed={selected}
                              onClick={() => {
                                if (value !== null) setSelectedDate(dateLabel)
                              }}
                              className={cn(
                                'focus-visible:ring-ring h-[clamp(20px,3.2vw,36px)] w-full min-w-[12px] rounded-[2px] focus-visible:ring-2 focus-visible:outline-none',
                                selected && 'ring-ring ring-2 ring-inset'
                              )}
                              style={heatmapCellStyle(value, maxSpend)}
                              title={
                                value !== null
                                  ? `${cellDate.format('MMM D')}: ${formatMoney(value, displayCurrency)}`
                                  : ''
                              }
                              role="gridcell"
                              aria-label={
                                value !== null
                                  ? `${dayLabels[r]}, ${dateLabel}: ${formatMoney(value, displayCurrency)}`
                                  : `${dayLabels[r]}: ${t('spendingHeatmap.noData')}`
                              }
                            />
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <details className="mt-4 min-w-0">
                <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none">
                  {t('spendingHeatmap.dayList')}
                </summary>
                <ul className="mt-2 max-h-72 min-w-0 overflow-y-auto">
                  {rangeDays.map((day) => (
                    <li key={day.date}>
                      <button
                        type="button"
                        aria-pressed={selectedDate === day.date}
                        onClick={() => setSelectedDate(day.date)}
                        className={cn(
                          'focus-visible:ring-ring flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none',
                          selectedDate === day.date && 'bg-muted'
                        )}
                        aria-label={`${t('spendingHeatmap.dayList')} ${day.date}: ${formatMoney(day.amount, displayCurrency)}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={heatmapCellStyle(day.amount, maxSpend)}
                          />
                          <span className="truncate tabular-nums">{day.date}</span>
                        </span>
                        <span className="shrink-0 overflow-x-auto whitespace-nowrap tabular-nums">
                          {formatMoney(day.amount, displayCurrency)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </NativePanel>
      )}

      {!totalsUnavailable ? (
        <NativePanel className="min-w-0 p-4 sm:p-5">
          <h3 className="text-sm font-semibold">
            {selectedDate
              ? dayjs(selectedDate).format('MMM D, YYYY')
              : t('spendingHeatmap.dayDetail')}
          </h3>
          {!selectedDate ? (
            <p className="text-muted-foreground mt-2 text-sm">{t('spendingHeatmap.selectDay')}</p>
          ) : selectedDayTransactions.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {t('spendingHeatmap.noDayExpenses')}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {selectedDayTransactions.map((tx) => (
                <div key={tx.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{tx.description || tx.category_name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {tx.category_name || t('reports.uncategorized')}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(tx.convertedAmount, displayCurrency)}
                  </span>
                </div>
              ))}
              <Link
                to={buildTransactionsHref({
                  type: 'expense',
                  dateFrom: selectedDate,
                  dateTo: selectedDate,
                })}
                className="text-accent mt-2 inline-flex min-h-11 items-center text-xs font-semibold"
              >
                {t('spendingHeatmap.openDay')}
              </Link>
            </div>
          )}
        </NativePanel>
      ) : null}

      <MetricStrip>
        <MetricItem
          label={t('spendingHeatmap.totalSpending')}
          value={
            totalsUnavailable ? '—' : formatMoney(aggregation?.totalSpent ?? 0, displayCurrency)
          }
        />
        <MetricItem
          label={t('spendingHeatmap.activeDays')}
          value={totalsUnavailable ? '—' : String(stats?.activeDays ?? 0)}
        />
        <MetricItem
          label={t('spendingHeatmap.highestDay')}
          value={stats?.highestDate ?? '—'}
          detail={
            totalsUnavailable || !stats
              ? undefined
              : formatMoney(stats.highestAmount, displayCurrency)
          }
        />
        <MetricItem
          label={t('spendingHeatmap.avgDaily')}
          value={
            totalsUnavailable || !stats
              ? '—'
              : formatMoney(Math.round(stats.avgDaily), displayCurrency)
          }
          detail={t('spendingHeatmap.lastNDays', { n: dayjs(end).diff(dayjs(start), 'day') })}
        />
        <MetricItem
          label={t('spendingHeatmap.mostActive')}
          value={stats?.mostActiveDay ?? '—'}
          detail={t('spendingHeatmap.dayOfWeek')}
        />
        <MetricItem
          label={t('spendingHeatmap.currentStreak')}
          value={stats ? t('spendingHeatmap.daysCount', { count: stats.streak }) : '—'}
          detail={t('spendingHeatmap.under50Day')}
        />
      </MetricStrip>

      {categoryTotals.length > 0 && !totalsUnavailable && (
        <NativePanel className="space-y-4 p-5 sm:p-6">
          <h3 className="text-sm font-semibold">{t('spendingHeatmap.topCategories')}</h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {categoryTotals.slice(0, 6).map((cat) => {
              const percent = catMax > 0 ? (cat.total / catMax) * 100 : 0
              return (
                <Link
                  key={cat.categoryId ?? cat.name}
                  to={buildTransactionsHref({
                    type: 'expense',
                    categoryId: cat.categoryId,
                    dateFrom: start,
                    dateTo: end,
                  })}
                  className="hover:bg-muted space-y-2 rounded-xl p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-sm">{cat.name}</span>
                    </div>
                    <span className="text-muted-foreground font-mono text-xs">
                      {formatMoney(cat.total, displayCurrency)}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${cat.name} share of top category`}
                    aria-valuenow={Math.round(percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="bg-muted h-1 overflow-hidden rounded-full"
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, percent))}%`,
                        backgroundColor: cat.color || 'var(--color-chart-3)',
                      }}
                    />
                  </div>
                </Link>
              )
            })}
          </div>
        </NativePanel>
      )}
    </div>
  )
}
