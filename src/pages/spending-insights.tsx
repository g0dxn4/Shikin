import { useEffect, useState } from 'react'
import { Link } from 'react-router'
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
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { NativePanel } from '@/components/ui/native-layout'
import { ComparisonBars } from '@/components/insights/comparison-bars'
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import type { SpendingComparison, SpendingInsight } from '@/stores/spending-insights-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'

type Mode = 'mom' | 'yoy'

export function SpendingInsights() {
  const { t } = useTranslation('analytics')
  const [mode, setMode] = useState<Mode>('mom')
  const {
    momComparisons,
    momCurrentTotal,
    momPreviousTotal,
    yoyComparisons,
    yoyCurrentTotal,
    yoyPreviousTotal,
    insights,
    isLoading,
    complete: storedComplete,
    authority,
    evidence,
    currency,
    missingCurrencies,
    reason,
    error,
    loadComparisons,
  } = useSpendingInsightsStore()
  const { preferredCurrency, mainCurrency, manualRates, loadRates } = useCurrencyStore()

  useEffect(() => {
    void loadRates().catch(() => {})
  }, [loadRates])

  useEffect(() => {
    void loadComparisons()
  }, [loadComparisons, preferredCurrency, mainCurrency, manualRates])

  const complete =
    storedComplete &&
    authority?.mainCurrency === mainCurrency &&
    authority?.manualRates === manualRates
  const active =
    mode === 'yoy'
      ? {
          comparisons: yoyComparisons,
          currentTotal: yoyCurrentTotal,
          previousTotal: yoyPreviousTotal,
          currentLabel: dayjs().format('MMMM YYYY'),
          previousLabel: dayjs().subtract(1, 'year').format('MMMM YYYY'),
          title: t('spendingInsights.comparisonChartYear'),
          caption: t('spendingInsights.comparisonChartCaptionYear'),
        }
      : {
          comparisons: momComparisons,
          currentTotal: momCurrentTotal,
          previousTotal: momPreviousTotal,
          currentLabel: dayjs().format('MMMM YYYY'),
          previousLabel: dayjs().subtract(1, 'month').format('MMMM YYYY'),
          title: t('spendingInsights.comparisonChart'),
          caption: t('spendingInsights.comparisonTableCaption'),
        }
  const showChart = active.comparisons.length > 0 && currency.length > 0
  const hasTotals = active.currentTotal !== null && active.previousTotal !== null
  const totalChange = hasTotals ? active.currentTotal! - active.previousTotal! : null

  if (isLoading) {
    return (
      <div className="page-content min-w-0" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="page-content min-w-0">
      {error ? (
        <ErrorState title={t('spendingInsights.loadError')} description={error} />
      ) : !complete ? (
        <div
          className="border-warning/30 bg-warning/10 text-warning rounded-xl border px-4 py-3 text-sm"
          role="alert"
        >
          {!mainCurrency
            ? t('reportingFx.unconfigured')
            : reason === 'invalid_currency_data'
              ? t('spendingInsights.invalidData', { details: missingCurrencies.join(', ') })
              : t('spendingInsights.incompleteTotals', {
                  currencies: missingCurrencies.join(', '),
                })}
          {evidence[0]?.currency && (
            <p>
              {t('reportingFx.known', {
                amount:
                  evidence[0].knownTotalCentavos === null
                    ? '—'
                    : formatMoney(evidence[0].knownTotalCentavos, evidence[0].currency),
              })}
            </p>
          )}
          <p>
            {t('reportingFx.native', {
              amounts:
                evidence[0]?.nativeTotals
                  .map((row) => formatMoney(row.amountCentavos, row.currency))
                  .join(' · ') || '—',
            })}
          </p>
        </div>
      ) : (
        <>
          <NativePanel className="min-w-0 p-4 sm:p-5">
            <div
              className="border-border bg-muted mb-4 flex max-w-full flex-wrap gap-1 rounded-lg border p-0.5"
              role="group"
              aria-label={t('spendingInsights.mode')}
            >
              {(
                [
                  ['mom', t('spendingInsights.tabs.mom'), Calendar],
                  ['yoy', t('spendingInsights.tabs.yoy'), CalendarRange],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={mode === id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'focus-visible:ring-ring flex min-h-11 flex-1 basis-28 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none',
                    mode === id
                      ? 'bg-surface text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {showChart ? (
              <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    {active.currentLabel}
                  </p>
                  <p className="mt-1 max-w-full overflow-x-auto text-3xl font-medium tracking-tight whitespace-nowrap tabular-nums">
                    {active.currentTotal === null
                      ? '—'
                      : formatMoney(Math.round(active.currentTotal), currency)}
                  </p>
                </div>
                <div className="min-w-0 text-left sm:text-right">
                  <p className="text-muted-foreground text-[11px]">{active.previousLabel}</p>
                  <p className="overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums">
                    {active.previousTotal === null
                      ? '—'
                      : formatMoney(Math.round(active.previousTotal), currency)}
                  </p>
                  {totalChange !== null ? (
                    <p
                      className={cn(
                        'text-xs font-medium tabular-nums',
                        totalChange > 0
                          ? 'text-destructive'
                          : totalChange < 0
                            ? 'text-success'
                            : 'text-muted-foreground'
                      )}
                    >
                      {totalChange > 0 ? '+' : ''}
                      {formatMoney(Math.round(totalChange), currency)}
                      {hasTotals && active.previousTotal! > 0
                        ? ` · ${totalChange > 0 ? '+' : ''}${((totalChange / active.previousTotal!) * 100).toFixed(1)}%`
                        : ''}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{t('spendingInsights.noData')}</p>
            )}
            {showChart ? (
              <>
                <ComparisonBars
                  comparisons={active.comparisons}
                  currency={currency}
                  title={active.title}
                  caption={active.caption}
                  currentLabel={active.currentLabel}
                  previousLabel={active.previousLabel}
                  categoryLabel={t('spendingInsights.category')}
                />
                <ul className="divide-border mt-4 divide-y">
                  {active.comparisons.map((comp) => (
                    <ComparisonRow
                      key={comp.categoryName}
                      comp={comp}
                      currency={currency}
                      currentLabel={active.currentLabel}
                      previousLabel={active.previousLabel}
                    />
                  ))}
                </ul>
              </>
            ) : null}
          </NativePanel>

          <InsightsTab insights={insights} currency={currency} />
        </>
      )}
    </div>
  )
}

function InsightsTab({ insights, currency }: { insights: SpendingInsight[]; currency: string }) {
  const { t } = useTranslation('analytics')
  if (insights.length === 0) {
    return (
      <NativePanel className="flex items-center justify-center px-5 py-8">
        <div className="max-w-md text-center">
          <Lightbulb size={24} className="text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-muted-foreground text-sm">{t('spendingInsights.insightsEmpty')}</p>
          <p className="text-muted-foreground mt-3 text-sm">
            {t('spendingInsights.quietNextSteps')}
          </p>
          <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            <Button variant="secondary" asChild className="min-h-11">
              <Link to="/reports">{t('spendingInsights.openReports')}</Link>
            </Button>
            <Button variant="secondary" asChild className="min-h-11">
              <Link to="/spending-heatmap">{t('spendingInsights.openHeatmap')}</Link>
            </Button>
          </div>
        </div>
      </NativePanel>
    )
  }

  return (
    <NativePanel
      className="min-w-0 px-4 py-2 sm:px-5"
      aria-label={t('spendingInsights.tabs.insights')}
    >
      <ul>
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} currency={currency} />
        ))}
      </ul>
    </NativePanel>
  )
}

function InsightCard({ insight, currency }: { insight: SpendingInsight; currency: string }) {
  const { t } = useTranslation('analytics')
  const severityStyles = {
    alert: 'border-l-destructive',
    warning: 'border-l-warning',
    info: 'border-l-border',
  }

  const severityIcon = {
    alert: <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />,
    warning: <AlertTriangle size={16} className="text-warning" aria-hidden="true" />,
    info: <Lightbulb size={16} className="text-muted-foreground" aria-hidden="true" />,
  }

  const severityLabel = {
    alert: t('spendingInsights.severity.alert'),
    warning: t('spendingInsights.severity.warning'),
    info: t('spendingInsights.severity.info'),
  }

  const typeIcon = {
    increase: <ArrowUpRight size={14} className="text-destructive" aria-hidden="true" />,
    decrease: <ArrowDownRight size={14} className="text-success" aria-hidden="true" />,
    new: <TrendingUp size={14} className="text-foreground" aria-hidden="true" />,
    gone: <TrendingDown size={14} className="text-muted-foreground" aria-hidden="true" />,
  }

  return (
    <li className={cn('border-l-2 py-3 pl-3', severityStyles[insight.severity])}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5">{severityIcon[insight.severity]}</div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: insight.categoryColor }}
            />
            <span className="truncate text-sm font-semibold">{insight.categoryName}</span>
            {typeIcon[insight.type]}
            <span className="sr-only">{severityLabel[insight.severity]}</span>
          </div>
          <p className="text-muted-foreground text-sm">{insight.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'font-mono text-[10px]',
                insight.type === 'increase' ? 'border-destructive/30 text-destructive' : '',
                insight.type === 'decrease' ? 'border-success/30 text-success' : ''
              )}
            >
              {insight.type === 'decrease' ? '-' : '+'}
              {formatMoney(Math.round(Math.abs(insight.amount)), currency)}
            </Badge>
            <span className="text-muted-foreground font-mono text-[10px]">
              {t('spendingInsights.vs3MonthAvg')}
            </span>
          </div>
        </div>
      </div>
    </li>
  )
}

function ComparisonRow({
  comp,
  currency,
  currentLabel,
  previousLabel,
}: {
  comp: SpendingComparison
  currency: string
  currentLabel: string
  previousLabel: string
}) {
  const { t } = useTranslation('analytics')
  const isIncrease = comp.change > 0
  const isDecrease = comp.change < 0
  const isSignificant = Math.abs(comp.changePercent) > 20

  return (
    <li className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1.4fr)_7.5rem_7.5rem_5.5rem] sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: comp.categoryColor }}
        />
        <span className="truncate text-sm">{comp.categoryName}</span>
      </div>
      <div className="grid grid-cols-1 gap-1 sm:contents">
        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase sm:sr-only">
            {currentLabel}
          </span>
          <span className="overflow-x-auto font-mono text-sm whitespace-nowrap">
            {formatMoney(Math.round(comp.current), currency)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase sm:sr-only">
            {previousLabel}
          </span>
          <span className="text-muted-foreground overflow-x-auto font-mono text-sm whitespace-nowrap">
            {formatMoney(Math.round(comp.previous), currency)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase sm:sr-only">
            {t('spendingInsights.change')}
          </span>
          <span className="flex items-center gap-1">
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
          </span>
        </div>
      </div>
    </li>
  )
}
