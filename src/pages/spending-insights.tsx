import { useEffect, useState } from 'react'
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Lightbulb,
  Minus,
  Calendar,
  CalendarRange,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import type { SpendingComparison, SpendingInsight } from '@/stores/spending-insights-store'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'

type Tab = 'insights' | 'mom' | 'yoy'

export function SpendingInsights() {
  const [tab, setTab] = useState<Tab>('insights')
  const {
    momComparisons,
    momCurrentTotal,
    momPreviousTotal,
    yoyComparisons,
    yoyCurrentTotal,
    yoyPreviousTotal,
    insights,
    isLoading,
    loadComparisons,
  } = useSpendingInsightsStore()

  useEffect(() => {
    loadComparisons()
  }, [loadComparisons])

  if (isLoading) {
    return (
      <div className="animate-fade-in-up page-content">
        <PageHeader title="Spending Insights" />
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'insights', label: 'Insights', icon: <Lightbulb size={14} /> },
    { id: 'mom', label: 'Month / Month', icon: <Calendar size={14} /> },
    { id: 'yoy', label: 'Year / Year', icon: <CalendarRange size={14} /> },
  ]

  return (
    <div className="animate-fade-in-up page-content">
      <PageHeader title="Spending Insights" />

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl bg-white/[0.03] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-mono text-xs transition-colors',
              tab === t.id
                ? 'bg-accent/15 text-accent'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'insights' && <InsightsTab insights={insights} />}
      {tab === 'mom' && (
        <ComparisonTab
          comparisons={momComparisons}
          currentTotal={momCurrentTotal}
          previousTotal={momPreviousTotal}
          currentLabel={dayjs().format('MMMM YYYY')}
          previousLabel={dayjs().subtract(1, 'month').format('MMMM YYYY')}
        />
      )}
      {tab === 'yoy' && (
        <ComparisonTab
          comparisons={yoyComparisons}
          currentTotal={yoyCurrentTotal}
          previousTotal={yoyPreviousTotal}
          currentLabel={dayjs().format('MMMM YYYY')}
          previousLabel={dayjs().subtract(1, 'year').format('MMMM YYYY')}
        />
      )}
    </div>
  )
}

// ── Insights Tab ──────────────────────────────────────────────────────────

function InsightsTab({ insights }: { insights: SpendingInsight[] }) {
  if (insights.length === 0) {
    return (
      <div className="glass-card flex h-48 items-center justify-center p-5">
        <div className="text-center">
          <Lightbulb size={24} className="text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">
            No notable spending changes this month. Keep it up!
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </div>
  )
}

function InsightCard({ insight }: { insight: SpendingInsight }) {
  const severityStyles = {
    alert: 'border-destructive/20 bg-destructive/5',
    warning: 'border-warning/20 bg-warning/5',
    info: 'border-accent/10 bg-accent/5',
  }

  const severityIcon = {
    alert: <AlertTriangle size={16} className="text-destructive" />,
    warning: <AlertTriangle size={16} className="text-warning" />,
    info: <Lightbulb size={16} className="text-accent" />,
  }

  const typeIcon = {
    increase: <ArrowUpRight size={14} className="text-destructive" />,
    decrease: <ArrowDownRight size={14} className="text-success" />,
    new: <TrendingUp size={14} className="text-accent" />,
    gone: <TrendingDown size={14} className="text-muted-foreground" />,
  }

  return (
    <div
      className={cn(
        'glass-card flex items-start gap-3 border p-4',
        severityStyles[insight.severity]
      )}
    >
      <div className="mt-0.5">{severityIcon[insight.severity]}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: insight.categoryColor }}
          />
          <span className="font-heading text-sm font-semibold">{insight.categoryName}</span>
          {typeIcon[insight.type]}
        </div>
        <p className="text-muted-foreground text-sm">{insight.message}</p>
        <div className="mt-2 flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              'font-mono text-[10px]',
              insight.type === 'increase' ? 'border-destructive/30 text-destructive' : '',
              insight.type === 'decrease' ? 'border-success/30 text-success' : ''
            )}
          >
            {insight.type === 'decrease' ? '-' : '+'}${Math.abs(insight.amount).toFixed(0)}
          </Badge>
          <span className="text-muted-foreground font-mono text-[10px]">vs 3-month avg</span>
        </div>
      </div>
    </div>
  )
}

// ── Comparison Tab ────────────────────────────────────────────────────────

function ComparisonTab({
  comparisons,
  currentTotal,
  previousTotal,
  currentLabel,
  previousLabel,
}: {
  comparisons: SpendingComparison[]
  currentTotal: number
  previousTotal: number
  currentLabel: string
  previousLabel: string
}) {
  const totalChange = currentTotal - previousTotal
  const totalChangePercent = previousTotal > 0 ? (totalChange / previousTotal) * 100 : 0

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="glass-card border-accent/10 border p-5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Total Change
            </span>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'font-heading text-2xl font-bold',
                  totalChange > 0 ? 'text-destructive' : totalChange < 0 ? 'text-success' : ''
                )}
              >
                {totalChange > 0 ? '+' : ''}${totalChange.toFixed(0)}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'font-mono text-[10px]',
                  totalChange > 0
                    ? 'border-destructive/30 text-destructive'
                    : 'border-success/30 text-success'
                )}
              >
                {totalChange > 0 ? '+' : ''}
                {totalChangePercent.toFixed(1)}%
              </Badge>
            </div>
          </div>
          <div className="text-right">
            <div className="text-muted-foreground text-xs">{currentLabel}</div>
            <div className="font-heading font-semibold">${currentTotal.toFixed(0)}</div>
            <div className="text-muted-foreground text-xs">{previousLabel}</div>
            <div className="text-muted-foreground font-heading text-sm">
              ${previousTotal.toFixed(0)}
            </div>
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      {comparisons.length === 0 ? (
        <div className="glass-card flex h-32 items-center justify-center p-5">
          <p className="text-muted-foreground text-sm">No spending data for this comparison.</p>
        </div>
      ) : (
        <div className="glass-card divide-y divide-white/[0.04] p-0">
          {/* Header */}
          <div className="text-muted-foreground grid grid-cols-[1fr_80px_80px_90px] gap-2 px-5 py-3 font-mono text-[10px] tracking-wider uppercase">
            <span>Category</span>
            <span className="text-right">Current</span>
            <span className="text-right">Previous</span>
            <span className="text-right">Change</span>
          </div>

          {comparisons.map((comp) => (
            <ComparisonRow key={comp.categoryName} comp={comp} />
          ))}
        </div>
      )}
    </div>
  )
}

function ComparisonRow({ comp }: { comp: SpendingComparison }) {
  const isIncrease = comp.change > 0
  const isDecrease = comp.change < 0
  const isSignificant = Math.abs(comp.changePercent) > 20

  return (
    <div className="grid grid-cols-[1fr_80px_80px_90px] items-center gap-2 px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: comp.categoryColor }}
        />
        <span className="truncate text-sm">{comp.categoryName}</span>
      </div>
      <span className="text-right font-mono text-sm">${comp.current.toFixed(0)}</span>
      <span className="text-muted-foreground text-right font-mono text-sm">
        ${comp.previous.toFixed(0)}
      </span>
      <div className="flex items-center justify-end gap-1">
        {comp.change !== 0 ? (
          <>
            {isIncrease ? (
              <ArrowUpRight
                size={12}
                className={isSignificant ? 'text-destructive' : 'text-muted-foreground'}
              />
            ) : (
              <ArrowDownRight
                size={12}
                className={isSignificant ? 'text-success' : 'text-muted-foreground'}
              />
            )}
            <span
              className={cn(
                'font-mono text-xs',
                isSignificant && isIncrease && 'text-destructive',
                isSignificant && isDecrease && 'text-success',
                !isSignificant && 'text-muted-foreground'
              )}
            >
              {isIncrease ? '+' : ''}
              {comp.changePercent.toFixed(0)}%
            </span>
          </>
        ) : (
          <Minus size={12} className="text-muted-foreground" />
        )}
      </div>
    </div>
  )
}
