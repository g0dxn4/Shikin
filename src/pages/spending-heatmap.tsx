import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Flame } from 'lucide-react'
import { FilterPills } from '@/components/ui/filter-pills'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { query } from '@/lib/database'
import { fromCentavos, formatMoney } from '@/lib/money'
import dayjs from 'dayjs'

const TIME_OPTIONS = [
  { label: 'This Month', value: 'month' },
  { label: '3 Months', value: '3months' },
  { label: '6 Months', value: '6months' },
  { label: 'This Year', value: 'year' },
]

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface DailySpend {
  date: string
  total: number // centavos
}

interface CategoryTotal {
  name: string
  color: string
  total: number // centavos
}

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
  const [dailySpends, setDailySpends] = useState<DailySpend[]>([])
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotal[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const loadCountRef = useRef(0)

  const { start, end } = useMemo(() => getDateRange(timeRange), [timeRange])

  useEffect(() => {
    const loadId = ++loadCountRef.current

    async function load() {
      const [spends, cats] = await Promise.all([
        query<{ date: string; total: number }>(
          `SELECT date, COALESCE(SUM(amount), 0) as total
           FROM transactions
           WHERE type = 'expense' AND date >= ? AND date <= ?
           GROUP BY date
           ORDER BY date`,
          [start, end]
        ),
        query<{ name: string; color: string; total: number }>(
          `SELECT c.name, c.color, COALESCE(SUM(t.amount), 0) as total
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.type = 'expense' AND t.date >= ? AND t.date <= ?
           GROUP BY t.category_id
           ORDER BY total DESC
           LIMIT 6`,
          [start, end]
        ),
      ])

      if (loadId === loadCountRef.current) {
        setDailySpends(spends)
        setCategoryTotals(
          cats.map((c) => ({
            name: c.name || 'Uncategorized',
            color: c.color || '#6b7280',
            total: c.total,
          }))
        )
        setIsLoading(false)
      }
    }

    load()
  }, [start, end])

  // Build lookup and compute stats
  const spendMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of dailySpends) map.set(s.date, s.total)
    return map
  }, [dailySpends])

  const stats = useMemo(() => {
    if (dailySpends.length === 0) return null

    let highestDate = ''
    let highestAmount = 0
    let totalSpent = 0
    const dayOfWeekTotals = [0, 0, 0, 0, 0, 0, 0]
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]

    // Count all days in range for proper average
    let daysCounted = 0
    let d = dayjs(start)
    const endDay = dayjs(end)
    while (d.isBefore(endDay) || d.isSame(endDay, 'day')) {
      const dateStr = d.format('YYYY-MM-DD')
      const amount = spendMap.get(dateStr) ?? 0
      const dow = (d.day() + 6) % 7 // Monday=0

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

    // Most active day of week (highest average)
    let maxDowAvg = 0
    let mostActiveIdx = 0
    for (let i = 0; i < 7; i++) {
      const avg = dayOfWeekCounts[i] > 0 ? dayOfWeekTotals[i] / dayOfWeekCounts[i] : 0
      if (avg > maxDowAvg) {
        maxDowAvg = avg
        mostActiveIdx = i
      }
    }

    // Low-spend streak (consecutive days under $50)
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
        break // Only count current streak from today backwards
      }
      d = d.subtract(1, 'day')
    }

    return {
      highestDate: highestDate ? dayjs(highestDate).format('MMM D') : '-',
      highestAmount,
      avgDaily,
      mostActiveDay: DAY_LABELS[mostActiveIdx],
      streak,
    }
  }, [dailySpends, spendMap, start, end])

  // Build heatmap grid: 7 rows (Mon-Sun) x weeksCount columns
  const { grid, weekLabels, maxSpend, gridStartDate, computedWeeksCount } = useMemo(() => {
    // Find the Monday of the start week (same logic used everywhere)
    let startDate = dayjs(start)
    const startDow = (startDate.day() + 6) % 7 // Monday=0
    startDate = startDate.subtract(startDow, 'day')

    const today = dayjs()
    // Compute weeksCount from actual Monday-aligned start to end
    const daysSpan = today.diff(startDate, 'day') + 1
    const weeksCount = Math.max(1, Math.ceil(daysSpan / 7))

    const grid: (number | null)[][] = []
    const weekLabels: string[] = []
    let maxSpend = 0

    for (let w = 0; w < weeksCount; w++) {
      const weekStart = startDate.add(w * 7, 'day')
      // Show month label at start of each month
      if (w === 0 || weekStart.date() <= 7) {
        weekLabels.push(weekStart.format('MMM'))
      } else {
        weekLabels.push('')
      }
    }

    for (let dow = 0; dow < 7; dow++) {
      const row: (number | null)[] = []
      for (let w = 0; w < weeksCount; w++) {
        const cellDate = startDate.add(w * 7 + dow, 'day')
        if (cellDate.isAfter(today, 'day') || cellDate.isBefore(dayjs(start), 'day')) {
          row.push(null) // Future or before range
        } else {
          const amount = spendMap.get(cellDate.format('YYYY-MM-DD')) ?? 0
          if (amount > maxSpend) maxSpend = amount
          row.push(amount)
        }
      }
      grid.push(row)
    }

    return { grid, weekLabels, maxSpend, gridStartDate: startDate, computedWeeksCount: weeksCount }
  }, [spendMap, start])

  function intensityClass(value: number | null): string {
    if (value === null) return 'bg-white/[0.02]'
    if (value === 0) return 'bg-accent/5'
    if (maxSpend === 0) return 'bg-accent/5'
    const ratio = value / maxSpend
    if (ratio < 0.15) return 'bg-accent/10'
    if (ratio < 0.3) return 'bg-accent/20'
    if (ratio < 0.45) return 'bg-accent/30'
    if (ratio < 0.6) return 'bg-accent/50'
    if (ratio < 0.8) return 'bg-accent/65'
    return 'bg-accent/80'
  }

  // Category max for progress bars
  const catMax = categoryTotals.length > 0 ? categoryTotals[0].total : 1

  if (isLoading) {
    return (
      <div className="animate-fade-in-up page-content" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <div className="liquid-card page-header p-5">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              {t('spendingHeatmap.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('spendingHeatmap.description')}</p>
          </div>
        </div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header p-5">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {t('spendingHeatmap.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('spendingHeatmap.description')}</p>
        </div>
      </div>

      <FilterPills
        options={TIME_OPTIONS}
        selected={timeRange}
        onChange={setTimeRange}
        ariaLabel="Time range"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Heatmap */}
        <div className="liquid-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Flame size={16} className="text-accent" aria-hidden="true" />
            <h3 className="font-heading text-sm font-semibold">
              {t('spendingHeatmap.dailyActivity')}
            </h3>
          </div>

          {dailySpends.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground text-sm">{t('spendingHeatmap.noData')}</p>
            </div>
          ) : (
            <>
              {/* Week labels */}
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

              {/* Grid */}
              <div className="flex gap-[3px]">
                <div className="flex w-7 shrink-0 flex-col gap-[3px]">
                  {DAY_LABELS.map((label, i) => (
                    <div
                      key={i}
                      className="text-muted-foreground flex h-[14px] items-center font-mono text-[8px]"
                      aria-hidden="true"
                    >
                      {i % 2 === 0 ? label.slice(0, 2) : ''}
                    </div>
                  ))}
                </div>

                <div
                  className="grid flex-1 gap-[3px]"
                  style={{ gridTemplateColumns: `repeat(${computedWeeksCount}, minmax(0, 1fr))` }}
                  role="grid"
                  aria-label={t('spendingHeatmap.dailyActivity')}
                >
                  {grid.map((row, r) => (
                    <div key={r} role="row" className="contents">
                      {row.map((value, c) => {
                        const cellDate = gridStartDate.add(c * 7 + r, 'day')
                        const dateLabel = cellDate.format('YYYY-MM-DD')
                        return (
                          <div
                            key={`${r}-${c}`}
                            className={`aspect-square rounded-[2px] transition-colors ${intensityClass(value)}`}
                            title={
                              value !== null
                                ? `${cellDate.format('MMM D')}: ${formatMoney(value)}`
                                : ''
                            }
                            role="gridcell"
                            aria-label={
                              value !== null ? `${dateLabel}: ${formatMoney(value)}` : 'No data'
                            }
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Legend */}
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
        </div>

        {/* Stats panel */}
        <div className="space-y-3">
          <div className="liquid-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('spendingHeatmap.highestDay')}
            </span>
            <StatRow
              label={stats?.highestDate ?? '-'}
              value={stats ? formatMoney(stats.highestAmount) : '-'}
              valueColor="text-destructive"
            />
          </div>
          <div className="liquid-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('spendingHeatmap.avgDaily')}
            </span>
            <StatRow
              label={t('spendingHeatmap.lastNDays', { n: dayjs(end).diff(dayjs(start), 'day') })}
              value={stats ? formatMoney(Math.round(stats.avgDaily)) : '-'}
            />
          </div>
          <div className="liquid-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('spendingHeatmap.mostActive')}
            </span>
            <StatRow
              label={t('spendingHeatmap.dayOfWeek')}
              value={stats?.mostActiveDay ?? '-'}
              valueColor="text-accent"
            />
          </div>
          <div className="liquid-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              {t('spendingHeatmap.currentStreak')}
            </span>
            <StatRow
              label={t('spendingHeatmap.under50Day')}
              value={stats ? `${stats.streak} days` : '-'}
              valueColor="text-success"
            />
          </div>
        </div>
      </div>

      {/* Top Categories */}
      {categoryTotals.length > 0 && (
        <div className="liquid-card space-y-4 p-5">
          <h3 className="font-heading text-sm font-semibold">
            {t('spendingHeatmap.topCategories')}
          </h3>
          <div className="space-y-3">
            {categoryTotals.map((cat) => {
              const percent = catMax > 0 ? (cat.total / catMax) * 100 : 0
              return (
                <div key={cat.name} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-sm">{cat.name}</span>
                    </div>
                    <span className="text-muted-foreground font-mono text-xs">
                      {formatMoney(cat.total)}
                    </span>
                  </div>
                  <ProgressBar
                    value={percent}
                    color="accent"
                    size="sm"
                    ariaLabel={`${cat.name} share of top category`}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
