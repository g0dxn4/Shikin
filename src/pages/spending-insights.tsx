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
import { NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { ComparisonBars } from '@/components/insights/comparison-bars'
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import type { SpendingComparison, SpendingInsight } from '@/stores/spending-insights-store'
import { useCurrencyStore } from '@/stores/currency-store'
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

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'insights', label: t('spendingInsights.tabs.insights'), icon: <Lightbulb size={14} /> },
    { id: 'mom', label: t('spendingInsights.tabs.mom'), icon: <Calendar size={14} /> },
    { id: 'yoy', label: t('spendingInsights.tabs.yoy'), icon: <CalendarRange size={14} /> },
  ]
  const showMonthChart = complete && !error && momComparisons.length > 0 && currency.length > 0

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
      <PageToolbar
        leading={
          <p className="text-muted-foreground text-sm">{t('spendingInsights.description')}</p>
        }
      />

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
          {showMonthChart ? (
            <NativePanel className="min-w-0 p-4 sm:p-5">
              <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    {t('spendingInsights.comparisonChart')}
                  </p>
                  <p className="mt-1 text-3xl font-medium tracking-tight tabular-nums">
                    {momCurrentTotal === null
                      ? '—'
                      : formatMoney(Math.round(momCurrentTotal), currency)}
                  </p>
                  <p className="text-muted-foreground text-xs">{t('spendingInsights.current')}</p>
                </div>
                <div className="min-w-0 sm:text-right">
                  <p className="text-muted-foreground text-xs">{t('spendingInsights.previous')}</p>
                  <p className="text-lg font-medium tabular-nums">
                    {momPreviousTotal === null
                      ? '—'
                      : formatMoney(Math.round(momPreviousTotal), currency)}
                  </p>
                </div>
              </div>
              <ComparisonBars
                comparisons={momComparisons}
                currency={currency}
                title={t('spendingInsights.comparisonChart')}
                caption={t('spendingInsights.comparisonTableCaption')}
                currentLabel={t('spendingInsights.current')}
                previousLabel={t('spendingInsights.previous')}
                categoryLabel={t('spendingInsights.category')}
              />
            </NativePanel>
          ) : null}

          <InsightsTab insights={insights} currency={currency} />

          <div
            className="border-border bg-muted flex flex-wrap gap-1 rounded-xl border p-1"
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
                  'flex min-h-11 flex-1 basis-28 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors',
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  tab === tItem.id
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span aria-hidden="true">{tItem.icon}</span>
                {tItem.label}
              </button>
            ))}
          </div>

          <div role="region" aria-label={tabs.find((item) => item.id === tab)?.label}>
            {tab === 'mom' ? (
              <ComparisonTab
                comparisons={momComparisons}
                currentTotal={momCurrentTotal}
                previousTotal={momPreviousTotal}
                currentLabel={dayjs().format('MMMM YYYY')}
                previousLabel={dayjs().subtract(1, 'month').format('MMMM YYYY')}
                currency={currency}
              />
            ) : null}
            {tab === 'yoy' ? (
              <ComparisonTab
                comparisons={yoyComparisons}
                currentTotal={yoyCurrentTotal}
                previousTotal={yoyPreviousTotal}
                currentLabel={dayjs().format('MMMM YYYY')}
                previousLabel={dayjs().subtract(1, 'year').format('MMMM YYYY')}
                currency={currency}
              />
            ) : null}
          </div>
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
    <NativePanel className="min-w-0 px-4 py-2 sm:px-5">
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

function ComparisonTab({
  comparisons,
  currentTotal,
  previousTotal,
  currentLabel,
  previousLabel,
  currency,
}: {
  comparisons: SpendingComparison[]
  currentTotal: number | null
  previousTotal: number | null
  currentLabel: string
  previousLabel: string
  currency: string
}) {
  const { t } = useTranslation('analytics')
  const hasTotals = currentTotal !== null && previousTotal !== null
  const totalChange = hasTotals ? currentTotal - previousTotal : null
  const totalChangePercent =
    hasTotals && previousTotal > 0 ? (totalChange! / previousTotal) * 100 : 0

  return (
    <div className="min-w-0 space-y-3">
      <NativePanel className="min-w-0 p-4 sm:p-5">
        <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {t('spendingInsights.totalChange')}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'text-2xl font-medium tracking-tight tabular-nums',
                  totalChange !== null && totalChange > 0
                    ? 'text-destructive'
                    : totalChange !== null && totalChange < 0
                      ? 'text-success'
                      : ''
                )}
              >
                {totalChange === null
                  ? '—'
                  : `${totalChange > 0 ? '+' : ''}${formatMoney(Math.round(totalChange), currency)}`}
              </span>
              {hasTotals ? (
                <Badge
                  variant="outline"
                  className={cn(
                    'font-mono text-[10px]',
                    totalChange !== null && totalChange > 0
                      ? 'border-destructive/30 text-destructive'
                      : 'border-success/30 text-success'
                  )}
                >
                  {totalChange !== null && totalChange > 0 ? '+' : ''}
                  {totalChangePercent.toFixed(1)}%
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="min-w-0 sm:text-right">
            <div className="text-muted-foreground text-xs">{currentLabel}</div>
            <div className="overflow-x-auto font-medium whitespace-nowrap tabular-nums">
              {currentTotal === null ? '—' : formatMoney(Math.round(currentTotal), currency)}
            </div>
            <div className="text-muted-foreground text-xs">{previousLabel}</div>
            <div className="text-muted-foreground overflow-x-auto text-sm whitespace-nowrap tabular-nums">
              {previousTotal === null ? '—' : formatMoney(Math.round(previousTotal), currency)}
            </div>
          </div>
        </div>
      </NativePanel>

      {comparisons.length === 0 ? (
        <NativePanel className="flex h-32 items-center justify-center p-5">
          <p className="text-muted-foreground text-sm">{t('spendingInsights.noData')}</p>
        </NativePanel>
      ) : (
        <NativePanel className="min-w-0 overflow-hidden p-0">
          <div className="text-muted-foreground hidden grid-cols-[minmax(0,1.4fr)_7.5rem_7.5rem_5.5rem] gap-2 px-4 py-3 text-[10px] font-semibold tracking-wider uppercase sm:grid">
            <span>{t('spendingInsights.category')}</span>
            <span className="text-right">{t('spendingInsights.current')}</span>
            <span className="text-right">{t('spendingInsights.previous')}</span>
            <span className="text-right">{t('spendingInsights.change')}</span>
          </div>
          <ul className="divide-border divide-y">
            {comparisons.map((comp) => (
              <ComparisonRow key={comp.categoryName} comp={comp} currency={currency} />
            ))}
          </ul>
        </NativePanel>
      )}
    </div>
  )
}

function ComparisonRow({ comp, currency }: { comp: SpendingComparison; currency: string }) {
  const { t } = useTranslation('analytics')
  const isIncrease = comp.change > 0
  const isDecrease = comp.change < 0
  const isSignificant = Math.abs(comp.changePercent) > 20

  return (
    <li className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_7.5rem_7.5rem_5.5rem] sm:items-center">
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
            {t('spendingInsights.current')}
          </span>
          <span className="overflow-x-auto font-mono text-sm whitespace-nowrap">
            {formatMoney(Math.round(comp.current), currency)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase sm:sr-only">
            {t('spendingInsights.previous')}
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
