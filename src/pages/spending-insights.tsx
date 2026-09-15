import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import type { SpendingComparison, SpendingInsight } from '@/stores/spending-insights-store'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'

type Tab = 'insights' | 'mom' | 'yoy'

export function SpendingInsights() {
  const { t } = useTranslation('analytics')
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

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'insights', label: t('spendingInsights.tabs.insights'), icon: <Lightbulb size={14} /> },
    { id: 'mom', label: t('spendingInsights.tabs.mom'), icon: <Calendar size={14} /> },
    { id: 'yoy', label: t('spendingInsights.tabs.yoy'), icon: <CalendarRange size={14} /> },
  ]

  if (isLoading) {
    return (
      <div className="page-content" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageToolbar
        leading={
          <p className="text-muted-foreground text-sm">{t('spendingInsights.description')}</p>
        }
      />

      <div
        className="border-border bg-muted flex gap-1 rounded-xl border p-1"
        role="group"
        aria-label={t('spendingInsights.title')}
      >
        {tabs.map((tItem) => (
          <button
            key={tItem.id}
            type="button"
            aria-pressed={tab === tItem.id}
            onClick={() => setTab(tItem.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              tab === tItem.id
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tItem.icon}
            {tItem.label}
          </button>
        ))}
      </div>

      <div role="region" aria-label={tabs.find((item) => item.id === tab)?.label}>
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
    </div>
  )
}

function InsightsTab({ insights }: { insights: SpendingInsight[] }) {
  const { t } = useTranslation('analytics')
  if (insights.length === 0) {
    return (
      <NativePanel className="flex h-64 items-center justify-center p-5">
        <div className="text-center">
          <Lightbulb size={24} className="text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-muted-foreground text-sm">{t('spendingInsights.insightsEmpty')}</p>
        </div>
      </NativePanel>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </div>
  )
}

function InsightCard({ insight }: { insight: SpendingInsight }) {
  const { t } = useTranslation('analytics')
  const severityStyles = {
    alert: 'border-destructive/20 bg-destructive/5',
    warning: 'border-warning/20 bg-warning/5',
    info: 'border-accent/10 bg-accent-muted/40',
  }

  const severityIcon = {
    alert: <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />,
    warning: <AlertTriangle size={16} className="text-warning" aria-hidden="true" />,
    info: <Lightbulb size={16} className="text-accent" aria-hidden="true" />,
  }

  const severityLabel = {
    alert: t('spendingInsights.severity.alert'),
    warning: t('spendingInsights.severity.warning'),
    info: t('spendingInsights.severity.info'),
  }

  const typeIcon = {
    increase: <ArrowUpRight size={14} className="text-destructive" aria-hidden="true" />,
    decrease: <ArrowDownRight size={14} className="text-success" aria-hidden="true" />,
    new: <TrendingUp size={14} className="text-accent" aria-hidden="true" />,
    gone: <TrendingDown size={14} className="text-muted-foreground" aria-hidden="true" />,
  }

  return (
    <NativePanel className={cn('min-h-[150px] p-5', severityStyles[insight.severity])}>
      <div className="flex items-start gap-3">
        <div className="border-border bg-surface mt-0.5 rounded-xl border p-2">
          {severityIcon[insight.severity]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: insight.categoryColor }}
            />
            <span className="text-sm font-semibold">{insight.categoryName}</span>
            {typeIcon[insight.type]}
            <span className="sr-only">{severityLabel[insight.severity]}</span>
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
              {insight.type === 'decrease' ? '-' : '+'}
              {formatMoney(Math.round(Math.abs(insight.amount)))}
            </Badge>
            <span className="text-muted-foreground font-mono text-[10px]">
              {t('spendingInsights.vs3MonthAvg')}
            </span>
          </div>
        </div>
      </div>
    </NativePanel>
  )
}

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
  const { t } = useTranslation('analytics')
  const totalChange = currentTotal - previousTotal
  const totalChangePercent = previousTotal > 0 ? (totalChange / previousTotal) * 100 : 0

  return (
    <div className="space-y-3">
      <NativePanel className="p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {t('spendingInsights.totalChange')}
            </span>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={cn(
                  'text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl',
                  totalChange > 0 ? 'text-destructive' : totalChange < 0 ? 'text-success' : ''
                )}
              >
                {totalChange > 0 ? '+' : ''}
                {formatMoney(Math.round(totalChange))}
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
            <div className="font-semibold tabular-nums">
              {formatMoney(Math.round(currentTotal))}
            </div>
            <div className="text-muted-foreground text-xs">{previousLabel}</div>
            <div className="text-muted-foreground text-sm tabular-nums">
              {formatMoney(Math.round(previousTotal))}
            </div>
          </div>
        </div>
      </NativePanel>

      {comparisons.length === 0 ? (
        <NativePanel className="flex h-32 items-center justify-center p-5">
          <p className="text-muted-foreground text-sm">{t('spendingInsights.noData')}</p>
        </NativePanel>
      ) : (
        <NativePanel className="overflow-x-auto p-0">
          <div className="divide-border min-w-[520px] divide-y">
            <div className="text-muted-foreground grid grid-cols-[1fr_80px_80px_90px] gap-2 px-5 py-3 text-[10px] font-semibold tracking-wider uppercase">
              <span>{t('spendingInsights.category')}</span>
              <span className="text-right">{t('spendingInsights.current')}</span>
              <span className="text-right">{t('spendingInsights.previous')}</span>
              <span className="text-right">{t('spendingInsights.change')}</span>
            </div>

            {comparisons.map((comp) => (
              <ComparisonRow key={comp.categoryName} comp={comp} />
            ))}
          </div>
        </NativePanel>
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
      <span className="text-right font-mono text-sm">{formatMoney(Math.round(comp.current))}</span>
      <span className="text-muted-foreground text-right font-mono text-sm">
        {formatMoney(Math.round(comp.previous))}
      </span>
      <div className="flex items-center justify-end gap-1">
        {comp.change !== 0 ? (
          <>
            {isIncrease ? (
              <ArrowUpRight
                size={12}
                className={isSignificant ? 'text-destructive' : 'text-muted-foreground'}
                aria-hidden="true"
              />
            ) : (
              <ArrowDownRight
                size={12}
                className={isSignificant ? 'text-success' : 'text-muted-foreground'}
                aria-hidden="true"
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
          <Minus size={12} className="text-muted-foreground" aria-hidden="true" />
        )}
      </div>
    </div>
  )
}
