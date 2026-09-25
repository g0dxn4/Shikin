import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import dayjs from 'dayjs'
import { MetricItem, MetricStrip, NativePanel } from '@/components/ui/native-layout'
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

export type NetWorthPeriod = 'month' | '3m' | '6m' | 'ytd' | '1y' | 'all'
type OverviewView = 'summary' | 'history' | 'comparison'

const OVERVIEW_PERIODS: NetWorthPeriod[] = ['month', '3m', '6m', 'ytd', 'all']
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
  incomeAmount?: number
  spentAmount?: number
  cashFlowCurrency?: string | null
  spentDetail?: string
  saved: string
  savingsRate?: string
  savedTone: 'positive' | 'negative' | 'muted'
  cashFlowLabel: string
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
}

export function OverviewNetWorth({
  currentComplete,
  currentAmount,
  currentCurrency,
  unavailableMessage,
  income,
  incomeDetail,
  spent,
  incomeAmount,
  spentAmount,
  cashFlowCurrency,
  spentDetail,
  saved,
  savingsRate,
  savedTone,
  cashFlowLabel,
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
  const hasCashFlowVisual =
    incomeAmount !== undefined &&
    spentAmount !== undefined &&
    cashFlowCurrency !== null &&
    cashFlowCurrency !== undefined &&
    Number.isFinite(incomeAmount) &&
    Number.isFinite(spentAmount) &&
    incomeAmount >= 0 &&
    spentAmount >= 0 &&
    Math.max(incomeAmount, spentAmount) > 0

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
            'col-start-1 row-start-1 flex min-w-0 flex-col justify-center p-4 sm:p-6',
            view !== 'summary' && 'pointer-events-none invisible'
          )}
          aria-hidden={view !== 'summary'}
          inert={view !== 'summary'}
        >
          <p className="text-muted-foreground mb-3 text-xs">{cashFlowLabel}</p>
          <MetricStrip className="[&_strong]:break-words" aria-label={t('overview.views.summary')}>
            <MetricItem
              label={t('overview.netWorth')}
              value={
                hasCurrentValue ? (
                  formatMoney(currentAmount, currentCurrency)
                ) : (
                  <span className="text-warning">—</span>
                )
              }
              detail={
                hasCurrentValue ? (
                  currentAsOfLabel
                ) : (
                  <span role="alert" className="text-warning block font-normal">
                    {t('currency.totalUnavailable')}
                    {unavailableMessage ? ` · ${unavailableMessage}` : ''}
                  </span>
                )
              }
            />
            <MetricItem label={t('cards.income')} value={income} detail={incomeDetail} />
            <MetricItem label={t('cards.spent')} value={spent} detail={spentDetail} />
            <MetricItem
              label={t('cards.saved')}
              value={
                <span
                  className={cn(
                    savedTone === 'positive' && 'text-accent',
                    savedTone === 'negative' && 'text-destructive'
                  )}
                >
                  {saved}
                </span>
              }
              detail={
                savingsRate ? (
                  <span>
                    <span>{savingsRate}</span> {t('cards.savings')}
                  </span>
                ) : undefined
              }
            />
          </MetricStrip>
          {hasCashFlowVisual ? (
            <div
              className="border-border mt-6 border-t pt-5"
              role="img"
              aria-label={t('overview.cashFlowComparison', {
                income: formatMoney(incomeAmount, cashFlowCurrency),
                spent: formatMoney(spentAmount, cashFlowCurrency),
              })}
            >
              <p className="mb-3 text-sm font-semibold">{t('overview.cashFlow')}</p>
              {(
                [
                  { label: t('cards.income'), amount: incomeAmount, color: 'bg-chart-1' },
                  { label: t('cards.spent'), amount: spentAmount, color: 'bg-chart-2' },
                ] as const
              ).map(({ label, amount, color }) => (
                <div
                  key={label}
                  className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs"
                >
                  <span>{label}</span>
                  <span className="min-w-0 text-right break-all tabular-nums">
                    {formatMoney(amount, cashFlowCurrency)}
                  </span>
                  <div className="bg-muted col-span-2 h-2 overflow-hidden rounded-full">
                    <div
                      className={cn('h-full rounded-full', color)}
                      style={{ width: `${(amount / Math.max(incomeAmount, spentAmount)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div
          id="overview-history-panel"
          role="tabpanel"
          aria-labelledby="overview-history-tab"
          className={cn(
            'col-start-1 row-start-1 min-w-0 p-4 sm:p-6',
            view !== 'history' && 'pointer-events-none invisible'
          )}
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
            view !== 'comparison' && 'pointer-events-none invisible'
          )}
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
