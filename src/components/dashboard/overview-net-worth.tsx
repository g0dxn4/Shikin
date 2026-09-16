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
import type { ConvertToPreferred } from '@/components/dashboard/overview-account-comparison-helpers'
import { OverviewAccountComparison } from '@/components/dashboard/overview-account-comparison'

export type NetWorthPeriod = '3m' | '6m' | '1y' | 'all'
type OverviewView = 'summary' | 'history' | 'comparison'

const NET_WORTH_PERIODS: NetWorthPeriod[] = ['3m', '6m', '1y', 'all']
const OVERVIEW_VIEWS: OverviewView[] = ['summary', 'history', 'comparison']

export interface OverviewHistoryPoint {
  date: string
  netWorth: number
}

interface OverviewNetWorthProps {
  currentComplete: boolean
  currentAmount: number
  currentCurrency: string
  unavailableMessage?: string
  income: string
  incomeDetail?: string
  spent: string
  spentDetail?: string
  saved: string
  savingsRate?: string
  savedTone: 'positive' | 'negative' | 'muted'
  cashFlowLabel: string
  asOfLabel: string
  history: OverviewHistoryPoint[]
  period: NetWorthPeriod
  onPeriodChange: (period: NetWorthPeriod) => void
  historyCurrency: string
  emptyHistoryMessage: string
  accounts: Account[]
  preferredCurrency: string
  rates: Readonly<Record<string, number>>
  invalidRates: ReadonlyArray<unknown>
  convertToPreferred: ConvertToPreferred
}

export function OverviewNetWorth({
  currentComplete,
  currentAmount,
  currentCurrency,
  unavailableMessage,
  income,
  incomeDetail,
  spent,
  spentDetail,
  saved,
  savingsRate,
  savedTone,
  cashFlowLabel,
  asOfLabel,
  history,
  period,
  onPeriodChange,
  historyCurrency,
  emptyHistoryMessage,
  accounts,
  preferredCurrency,
  rates,
  invalidRates,
  convertToPreferred,
}: OverviewNetWorthProps) {
  const { t } = useTranslation('dashboard')
  const [view, setView] = useState<OverviewView>('summary')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const firstPoint = history[0]
  const lastPoint = history.length > 1 ? history[history.length - 1] : null
  const changeAmount = lastPoint && firstPoint ? lastPoint.netWorth - firstPoint.netWorth : 0
  const hasChange = currentComplete && history.length > 1

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

      {view === 'summary' ? (
        <div
          id="overview-summary-panel"
          role="tabpanel"
          aria-labelledby="overview-summary-tab"
          className="p-4 sm:p-6"
        >
          <p className="text-muted-foreground mb-3 text-xs">{cashFlowLabel}</p>
          <MetricStrip aria-label={t('overview.views.summary')}>
            <MetricItem
              label={t('overview.netWorth')}
              value={
                currentComplete ? (
                  formatMoney(currentAmount, currentCurrency)
                ) : (
                  <span className="text-warning">—</span>
                )
              }
              detail={
                currentComplete ? (
                  asOfLabel
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
        </div>
      ) : null}

      {view === 'history' ? (
        <div
          id="overview-history-panel"
          role="tabpanel"
          aria-labelledby="overview-history-tab"
          className="min-w-0 p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{t('overview.netWorthHistory')}</h3>
              <p className="text-muted-foreground mt-1 text-xs">{t('overview.focusDate')}</p>
            </div>
            <HistoryPeriodControl period={period} onPeriodChange={onPeriodChange} />
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {currentComplete ? (
              <strong className="text-2xl font-semibold tracking-tight tabular-nums">
                {formatMoney(currentAmount, currentCurrency)}
              </strong>
            ) : (
              <span className="text-warning text-sm font-semibold" role="alert">
                {t('currency.totalUnavailable')}
                {unavailableMessage ? ` · ${unavailableMessage}` : ''}
              </span>
            )}
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
            <span className="text-muted-foreground text-xs">{asOfLabel}</span>
          </div>

          {history.length > 1 ? (
            <>
              <div
                className="mt-3 h-64 min-w-0 sm:h-72"
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
            <div className="bg-muted mt-4 flex h-64 items-center justify-center rounded-xl px-4 text-center">
              <p className="text-muted-foreground text-sm">{emptyHistoryMessage}</p>
            </div>
          )}
        </div>
      ) : null}

      {view === 'comparison' ? (
        <div
          id="overview-comparison-panel"
          role="tabpanel"
          aria-labelledby="overview-comparison-tab"
          className="min-w-0 p-4 sm:p-6"
        >
          <OverviewAccountComparison
            accounts={accounts}
            preferredCurrency={preferredCurrency}
            rates={rates}
            invalidRates={invalidRates}
            convertToPreferred={convertToPreferred}
          />
        </div>
      ) : null}
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
      className="border-border bg-muted flex rounded-lg border p-0.5"
      role="group"
      aria-label={t('overview.historyPeriod')}
    >
      {NET_WORTH_PERIODS.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={period === item}
          onClick={() => onPeriodChange(item)}
          className={cn(
            'min-h-10 min-w-10 rounded-md px-2 py-2 text-xs font-semibold sm:min-h-0 sm:min-w-11 sm:py-1.5',
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
