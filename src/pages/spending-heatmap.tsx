import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FilterPills } from '@/components/ui/filter-pills'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { MetricItem, MetricStrip, NativePanel, PageToolbar } from '@/components/ui/native-layout'
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
  const { preferredCurrency, rates, invalidRates, convertToPreferred, loadRates } =
    useCurrencyStore()

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
    // The stable converter reads rates and diagnostics from the current store state.
    void rates
    void invalidRates
    return ledgerRows
      ? aggregateHeatmapSpending(ledgerRows, preferredCurrency, convertToPreferred)
      : null
  }, [ledgerRows, preferredCurrency, rates, invalidRates, convertToPreferred])

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

  function intensityClass(value: number | null): string {
    if (value === null) return 'bg-muted/40'
    if (value === 0 || maxSpend === 0) return 'bg-accent/5'
    const ratio = value / maxSpend
    if (ratio < 0.15) return 'bg-accent/10'
    if (ratio < 0.3) return 'bg-accent/20'
    if (ratio < 0.45) return 'bg-accent/30'
    if (ratio < 0.6) return 'bg-accent/50'
    if (ratio < 0.8) return 'bg-accent/65'
    return 'bg-accent/80'
  }

  const selectedDayTransactions: HeatmapConvertedTransaction[] = selectedDate
    ? (aggregation?.eligibleTransactions ?? []).filter((tx) => tx.date === selectedDate)
    : []
  const catMax = categoryTotals[0]?.total ?? 1
  const totalsUnavailable = Boolean(aggregation && !complete)

  if (isLoading) {
    return (
      <div className="page-content" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-content">
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

  return (
    <div className="page-content">
      <PageToolbar
        leading={
          <p className="text-muted-foreground text-sm">{t('spendingHeatmap.description')}</p>
        }
        actions={
          <FilterPills
            options={timeOptions}
            selected={timeRange}
            onChange={(value) => {
              setIsLoading(true)
              setTimeRange(value)
              setSelectedDate(null)
            }}
            ariaLabel={t('spendingHeatmap.timeRange')}
          />
        }
      />

      {totalsUnavailable ? (
        <div
          className="border-warning/30 bg-warning/10 text-warning rounded-xl border px-4 py-3 text-sm"
          role="alert"
        >
          {aggregation?.reason === 'invalid_currency_data'
            ? t('spendingHeatmap.invalidData', {
                details: aggregation.missingCurrencies.join(', '),
              })
            : t('spendingHeatmap.incompleteTotals', {
                currencies: aggregation?.missingCurrencies.join(', ') ?? '',
              })}
        </div>
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
          label={t('spendingHeatmap.topCategories')}
          value={totalsUnavailable || categoryTotals.length === 0 ? '—' : categoryTotals[0].name}
        />
        <MetricItem
          label={t('spendingHeatmap.selectedDay')}
          value={
            selectedDate ? dayjs(selectedDate).format('MMM D') : t('spendingHeatmap.selectDay')
          }
        />
      </MetricStrip>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <NativePanel className="p-5 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold">{t('spendingHeatmap.dailyActivity')}</h2>
          {totalsUnavailable ? (
            <div className="bg-muted flex h-72 items-center justify-center rounded-xl">
              <p className="text-warning text-sm">
                {t('spendingHeatmap.incompleteTotals', {
                  currencies: aggregation?.missingCurrencies.join(', ') ?? '',
                })}
              </p>
            </div>
          ) : !aggregation || aggregation.dailyTotals.size === 0 ? (
            <div className="bg-muted flex h-72 items-center justify-center rounded-xl">
              <p className="text-muted-foreground text-sm">{t('spendingHeatmap.noData')}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto pb-1">
                <div
                  className="min-w-[560px]"
                  style={{ minWidth: Math.max(560, computedWeeksCount * 18 + 32) }}
                >
                  <div
                    className="mb-1 ml-8 grid gap-[3px]"
                    style={{ gridTemplateColumns: `repeat(${computedWeeksCount}, minmax(0, 1fr))` }}
                  >
                    {weekLabels.map((label, i) => (
                      <span key={i} className="text-muted-foreground truncate font-mono text-[8px]">
                        {label}
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-[3px]">
                    <div className="flex w-7 shrink-0 flex-col gap-[3px]">
                      {dayLabels.map((label, i) => (
                        <div
                          key={label}
                          className="text-muted-foreground flex h-[14px] items-center font-mono text-[8px]"
                        >
                          {i % 2 === 0 ? label.slice(0, 2) : ''}
                        </div>
                      ))}
                    </div>

                    <div
                      className="grid flex-1 gap-[3px]"
                      style={{
                        gridTemplateColumns: `repeat(${computedWeeksCount}, minmax(0, 1fr))`,
                      }}
                      role="grid"
                      aria-label={t('spendingHeatmap.dailyActivity')}
                    >
                      {grid.map((row, r) => (
                        <div key={r} role="row" className="contents">
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
                                  'aspect-square rounded-[2px] transition-colors',
                                  intensityClass(value),
                                  selected && 'ring-ring ring-2 ring-offset-1'
                                )}
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
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <span className="text-muted-foreground font-mono text-[9px]">
                  {t('spendingHeatmap.less')}
                </span>
                <div className="flex gap-0.5">
                  {[
                    'bg-accent/5',
                    'bg-accent/10',
                    'bg-accent/20',
                    'bg-accent/30',
                    'bg-accent/50',
                    'bg-accent/65',
                    'bg-accent/80',
                  ].map((cls, i) => (
                    <div key={i} className={`h-3 w-3 rounded-sm ${cls}`} />
                  ))}
                </div>
                <span className="text-muted-foreground font-mono text-[9px]">
                  {t('spendingHeatmap.more')}
                </span>
              </div>
            </>
          )}
        </NativePanel>

        <div className="space-y-3">
          <NativePanel className="space-y-1 p-4">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              {t('spendingHeatmap.highestDay')}
            </span>
            <StatRow
              label={stats?.highestDate ?? '-'}
              value={
                totalsUnavailable || !stats
                  ? '-'
                  : formatMoney(stats.highestAmount, displayCurrency)
              }
              valueColor="text-destructive"
            />
          </NativePanel>
          <NativePanel className="space-y-1 p-4">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              {t('spendingHeatmap.avgDaily')}
            </span>
            <StatRow
              label={t('spendingHeatmap.lastNDays', { n: dayjs(end).diff(dayjs(start), 'day') })}
              value={
                totalsUnavailable || !stats
                  ? '-'
                  : formatMoney(Math.round(stats.avgDaily), displayCurrency)
              }
            />
          </NativePanel>
          <NativePanel className="space-y-1 p-4">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              {t('spendingHeatmap.mostActive')}
            </span>
            <StatRow
              label={t('spendingHeatmap.dayOfWeek')}
              value={stats?.mostActiveDay ?? '-'}
              valueColor="text-accent"
            />
          </NativePanel>
          <NativePanel className="space-y-1 p-4">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              {t('spendingHeatmap.currentStreak')}
            </span>
            <StatRow
              label={t('spendingHeatmap.under50Day')}
              value={stats ? t('spendingHeatmap.daysCount', { count: stats.streak }) : '-'}
              valueColor="text-success"
            />
          </NativePanel>
          <NativePanel className="p-4">
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
                  className="text-accent mt-2 inline-flex min-h-8 text-xs font-semibold"
                >
                  {t('spendingHeatmap.openDay')}
                </Link>
              </div>
            )}
          </NativePanel>
        </div>
      </div>

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
                  <ProgressBar
                    value={percent}
                    color="accent"
                    size="sm"
                    ariaLabel={`${cat.name} share of top category`}
                  />
                </Link>
              )
            })}
          </div>
        </NativePanel>
      )}
    </div>
  )
}
