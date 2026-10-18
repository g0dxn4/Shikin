import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import type { Debt, PayoffPlan } from '@/lib/debt-service'
import { formatMoney } from '@/lib/money'
import type { DebtStrategy } from '@/stores/debt-store'
import {
  debtLineColor,
  debtTrajectoryRows,
  strategyTrajectoryColor,
} from '@/components/planning-scenarios/scenario-series'

interface DebtTrajectoryChartProps {
  payoffPlan: PayoffPlan
  debts: Debt[]
  currency: string
  strategy: DebtStrategy
}

export function DebtTrajectoryChart({
  payoffPlan,
  debts,
  currency,
  strategy,
}: DebtTrajectoryChartProps) {
  const { t, i18n } = useTranslation('debtPayoff')
  const locale = i18n?.resolvedLanguage ?? i18n?.language
  const gradientId = `debt-trajectory-${useId().replace(/:/g, '')}`
  const rows = debtTrajectoryRows(
    payoffPlan.schedule,
    debts.map((debt) => debt.id)
  )
  const trajectoryColor = strategyTrajectoryColor(strategy)

  if (rows.length === 0) return null

  const chartRows = rows.map((row) => ({
    ...row.balances,
    month: row.month,
    label: dayjs().add(row.month, 'month').format('MMM YY'),
    fullLabel: dayjs().add(row.month, 'month').format('MMM YYYY'),
    total: row.total,
  }))

  return (
    <div className="min-w-0" data-trajectory={trajectoryColor} data-zero-baseline="true">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-xs font-semibold">{t('chart.title')}</h2>
        <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1" aria-label={t('chart.title')}>
          <li className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              className="inline-block h-0.5 w-4"
              style={{ backgroundColor: trajectoryColor }}
              aria-hidden="true"
            />
            {t('chart.total')}
          </li>
          {debts.map((debt, index) => (
            <li key={debt.id} className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span
                className="inline-block h-0.5 w-4"
                style={{ backgroundColor: debtLineColor(index, strategy) }}
                aria-hidden="true"
              />
              <span className="break-words">{debt.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <div
        className="mt-2 h-48 min-w-0 sm:h-72"
        role="img"
        aria-label={`${t('chart.title')} · ${t(`strategy.${strategy}`)}`}
      >
        <SafeChart>
          <ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={trajectoryColor} stopOpacity={0.18} />
                <stop offset="100%" stopColor={trajectoryColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={8}
              minTickGap={28}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={4}
              width={56}
              tickFormatter={(value) => formatCompactChartMoney(Number(value), currency, locale)}
            />
            <Tooltip
              contentStyle={{
                ...CHART_TOOLTIP_STYLE,
                maxWidth: 'min(280px, calc(100vw - 32px))',
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
              itemStyle={{
                ...CHART_ITEM_STYLE,
                whiteSpace: 'normal',
              }}
              labelStyle={CHART_LABEL_STYLE}
              labelFormatter={(_label, payload) => {
                const fullLabel = payload?.[0]?.payload?.fullLabel
                return typeof fullLabel === 'string' ? fullLabel : String(_label)
              }}
              formatter={(value, name) => [formatMoney(Number(value), currency), name]}
            />
            {debts.map((debt, index) => (
              <Line
                key={debt.id}
                type="linear"
                dataKey={debt.id}
                name={debt.name}
                stroke={debtLineColor(index, strategy)}
                strokeWidth={1.25}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            <Area
              type="linear"
              dataKey="total"
              name={t('chart.total')}
              stroke={trajectoryColor}
              strokeWidth={2.25}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={false}
            />
          </ComposedChart>
        </SafeChart>
      </div>
      <details className="mt-2">
        <summary className="focus-visible:ring-ring text-accent cursor-pointer text-xs font-semibold focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none">
          {t('chart.data')}
        </summary>
        <div className="mt-2 max-h-64 max-w-full overflow-auto">
          <table className="w-max min-w-full text-left text-xs">
            <caption className="sr-only">{t('chart.title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {t('chart.month')}
                </th>
                {debts.map((debt) => (
                  <th scope="col" key={debt.id} className="px-3 py-2 font-medium whitespace-nowrap">
                    {debt.name}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {t('chart.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {payoffPlan.schedule.map((snapshot) => (
                <tr key={snapshot.month} className="border-border border-t">
                  <th scope="row" className="px-3 py-2 font-normal whitespace-nowrap">
                    {dayjs().add(snapshot.month, 'month').format('MMM YYYY')}
                  </th>
                  {debts.map((debt) => (
                    <td key={debt.id} className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {formatMoney(snapshot.balances[debt.id] ?? 0, currency)}
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatMoney(snapshot.totalBalance, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
