import { useTranslation } from 'react-i18next'
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts'
import dayjs from 'dayjs'
import { NativePanel } from '@/components/ui/native-layout'
import { SafeChart } from '@/components/ui/safe-chart'
import {
  CHART_AXIS_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

export type NetWorthPeriod = '3m' | '6m' | '1y' | 'all'

const NET_WORTH_PERIODS: NetWorthPeriod[] = ['3m', '6m', '1y', 'all']

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
}: OverviewNetWorthProps) {
  const { t } = useTranslation('dashboard')
  const firstPoint = history[0]
  const lastPoint = history.length > 1 ? history[history.length - 1] : null
  const changeAmount = lastPoint && firstPoint ? lastPoint.netWorth - firstPoint.netWorth : 0
  const hasChange = history.length > 1

  return (
    <NativePanel
      className="grid overflow-hidden lg:grid-cols-[minmax(240px,270px)_minmax(0,1fr)]"
      aria-labelledby="overview-net-worth-heading"
    >
      <div className="border-border flex flex-col border-b p-5 sm:p-6 lg:border-r lg:border-b-0">
        <p
          id="overview-net-worth-heading"
          className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase"
        >
          {t('overview.netWorth')}
        </p>
        {currentComplete ? (
          <p className="mt-2 text-[32px] font-semibold tracking-tight tabular-nums sm:text-[35px]">
            {formatMoney(currentAmount, currentCurrency)}
          </p>
        ) : (
          <div
            className="border-warning/30 bg-warning/10 mt-3 rounded-xl border px-3 py-2"
            role="alert"
          >
            <p className="text-warning text-sm font-semibold">{t('currency.totalUnavailable')}</p>
            {unavailableMessage ? (
              <p className="text-muted-foreground mt-1 text-xs">{unavailableMessage}</p>
            ) : null}
          </div>
        )}
        {hasChange ? (
          <p
            className={cn(
              'mt-1 text-sm font-semibold',
              changeAmount >= 0 ? 'text-accent' : 'text-destructive'
            )}
          >
            {t('overview.changeOverPeriod', {
              delta: `${changeAmount >= 0 ? '+' : '-'}${formatMoney(Math.abs(changeAmount), historyCurrency)}`,
              period: t(`overview.period.${period}`),
            })}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-2 text-xs">{asOfLabel}</p>

        <p className="text-muted-foreground mt-auto pt-5 text-[11px] font-semibold">
          {cashFlowLabel}
        </p>
        <dl className="divide-border mt-1 divide-y">
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-muted-foreground text-xs">{t('cards.income')}</dt>
            <dd className="text-right">
              <strong className="text-success text-sm font-semibold tabular-nums">{income}</strong>
              {incomeDetail ? (
                <span className="text-muted-foreground mt-0.5 block text-[10px]">
                  {incomeDetail}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-muted-foreground text-xs">{t('cards.spent')}</dt>
            <dd className="text-right">
              <strong className="text-sm font-semibold tabular-nums">{spent}</strong>
              {spentDetail ? (
                <span className="text-muted-foreground mt-0.5 block text-[10px]">
                  {spentDetail}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-muted-foreground text-xs">{t('cards.saved')}</dt>
            <dd className="text-right">
              <strong
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  savedTone === 'positive' && 'text-accent',
                  savedTone === 'negative' && 'text-destructive'
                )}
              >
                {saved}
              </strong>
              {savingsRate ? (
                <span className="text-muted-foreground mt-0.5 block text-[10px]">
                  <span>{savingsRate}</span> {t('cards.savings')}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      </div>

      <div className="min-w-0 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{t('overview.netWorthHistory')}</p>
            <p className="text-muted-foreground mt-1 text-xs">{t('overview.focusDate')}</p>
          </div>
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
                  'min-w-11 rounded-md px-2.5 py-1.5 text-xs font-semibold',
                  period === item
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(`overview.period.${item}`)}
              </button>
            ))}
          </div>
        </div>

        {history.length > 1 ? (
          <>
            <div className="mt-3 h-52" role="img" aria-label={t('overview.chartTitle')}>
              <SafeChart>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="overviewNetWorthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                    tickFormatter={(d) => dayjs(d).format('MMM D')}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                    tickFormatter={(v) => formatMoney(Number(v), historyCurrency)}
                    width={56}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    itemStyle={CHART_ITEM_STYLE}
                    labelStyle={CHART_LABEL_STYLE}
                    labelFormatter={(d) => dayjs(String(d)).format('MMM D, YYYY')}
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
              <table className="mt-2 text-xs">
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
            </details>
          </>
        ) : (
          <div className="bg-muted mt-4 flex h-52 items-center justify-center rounded-xl px-4 text-center">
            <p className="text-muted-foreground text-sm">{emptyHistoryMessage}</p>
          </div>
        )}
      </div>
    </NativePanel>
  )
}
