import { useState, useMemo } from 'react'
import { Flame } from 'lucide-react'
import { FilterPills } from '@/components/ui/filter-pills'
import { PageHeader } from '@/components/ui/page-header'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'

const TIME_OPTIONS = [
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: '3 Months', value: '3months' },
  { label: 'This Year', value: 'year' },
]

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CATEGORIES = [
  { name: 'Groceries', value: 78, color: 'success' as const },
  { name: 'Dining', value: 62, color: 'accent' as const },
  { name: 'Transport', value: 45, color: 'warning' as const },
  { name: 'Entertainment', value: 38, color: 'destructive' as const },
  { name: 'Shopping', value: 30, color: 'accent' as const },
]

// Generate deterministic-looking pseudo-random intensity values
function generateHeatmapData(rows: number, cols: number): number[][] {
  const data: number[][] = []
  for (let r = 0; r < rows; r++) {
    const row: number[] = []
    for (let c = 0; c < cols; c++) {
      // Use a simple hash-like formula for consistency
      const seed = (r * 17 + c * 31 + 7) % 100
      row.push(seed)
    }
    data.push(row)
  }
  return data
}

function intensityToClass(value: number): string {
  if (value < 10) return 'bg-accent/5'
  if (value < 25) return 'bg-accent/10'
  if (value < 40) return 'bg-accent/20'
  if (value < 55) return 'bg-accent/30'
  if (value < 70) return 'bg-accent/50'
  if (value < 85) return 'bg-accent/65'
  return 'bg-accent/80'
}

export function SpendingHeatmap() {
  const [timeRange, setTimeRange] = useState('3months')
  const heatmapData = useMemo(() => generateHeatmapData(7, 12), [])

  return (
    <div className="animate-fade-in-up page-content">
      <PageHeader title="Spending Heatmap" />

      <FilterPills options={TIME_OPTIONS} selected={timeRange} onChange={setTimeRange} />

      {/* Main content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Heatmap */}
        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Flame size={16} className="text-accent" />
              <h3 className="font-heading text-sm font-semibold">Daily Spending Activity</h3>
            </div>

            {/* Month labels */}
            <div className="ml-10 mb-1 grid gap-1" style={{ gridTemplateColumns: `repeat(12, minmax(0, 1fr))` }}>
              {MONTH_LABELS.map((month) => (
                <span
                  key={month}
                  className="text-muted-foreground text-center font-mono text-[9px]"
                >
                  {month}
                </span>
              ))}
            </div>

            {/* Grid with day labels */}
            <div className="flex gap-1">
              {/* Day labels */}
              <div className="flex w-8 shrink-0 flex-col gap-1">
                {DAY_LABELS.map((label, i) => (
                  <div
                    key={i}
                    className="text-muted-foreground flex h-4 w-4 items-center font-mono text-[9px]"
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Heatmap cells */}
              <div
                className="grid flex-1 gap-1"
                style={{ gridTemplateColumns: `repeat(12, minmax(0, 1fr))` }}
              >
                {heatmapData.map((row, r) =>
                  row.map((value, c) => (
                    <div
                      key={`${r}-${c}`}
                      className={`h-4 w-4 rounded-sm transition-colors ${intensityToClass(value)}`}
                      title={`$${Math.round(value * 3.5)}`}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <span className="text-muted-foreground font-mono text-[9px]">Less</span>
              <div className="flex gap-0.5">
                {['bg-accent/5', 'bg-accent/15', 'bg-accent/30', 'bg-accent/50', 'bg-accent/70', 'bg-accent/90'].map(
                  (cls, i) => (
                    <div key={i} className={`h-3 w-3 rounded-sm ${cls}`} />
                  )
                )}
              </div>
              <span className="text-muted-foreground font-mono text-[9px]">More</span>
            </div>
          </div>
        </div>

        {/* Stats panel */}
        <div className="space-y-3">
          <div className="glass-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              Highest Day
            </span>
            <StatRow label="Feb 14" value="$890" valueColor="text-destructive" />
          </div>
          <div className="glass-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              Average Daily
            </span>
            <StatRow label="Last 90 days" value="$96.33" />
          </div>
          <div className="glass-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              Most Active
            </span>
            <StatRow label="Day of Week" value="Saturday" valueColor="text-accent" />
          </div>
          <div className="glass-card space-y-1 p-4">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              Streak
            </span>
            <StatRow label="Under $50/day" value="5 days" valueColor="text-success" />
          </div>
        </div>
      </div>

      {/* Top Categories */}
      <div className="glass-card space-y-4 p-5">
        <h3 className="font-heading text-sm font-semibold">Top Categories</h3>
        <div className="space-y-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.name} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm">{cat.name}</span>
                <span className="text-muted-foreground font-mono text-xs">{cat.value}%</span>
              </div>
              <ProgressBar value={cat.value} color={cat.color} size="sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
