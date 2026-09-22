import { useTranslation } from 'react-i18next'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { formatMoney } from '@/lib/money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import type { TrendResult } from '@/lib/dashboard-analytics'
import { SafeChart } from '@/components/ui/safe-chart'
import { cn } from '@/lib/utils'
import { formatCompactChartMoney } from './chart-money'

interface SpendingTrendPanelProps {
  trend: TrendResult
  displayCurrency: string
  notice: string | null
}

export function SpendingTrendPanel({ trend, displayCurrency, notice }: SpendingTrendPanelProps) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n?.resolvedLanguage ?? i18n?.language

  const data = trend.months.map((month) => ({
    key: month.key,
    label: month.label,
    expenses: month.expenses,
    income: month.income,
    net: month.net,
  }))

  const hasData = data.some((month) => month.expenses !== 0 || month.income !== 0)

  return (
    <div className="space-y-3">
      {notice ? <Notice>{notice}</Notice> : null}

      <dl className="border-border grid grid-cols-3 border-b">
        <Metric
          label={t('analytics.income')}
          value={formatMoney(trend.totalIncome, displayCurrency, locale)}
          color="text-success"
        />
        <Metric
          label={t('analytics.expenses')}
          value={formatMoney(trend.totalExpenses, displayCurrency, locale)}
          color="text-destructive"
        />
        <Metric
          label={t('analytics.net')}
          value={formatMoney(trend.totalNet, displayCurrency, locale)}
          color={trend.totalNet >= 0 ? 'text-success' : 'text-destructive'}
        />
      </dl>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label={t('analytics.legend')}>
        <LegendItem label={t('analytics.expenses')} color="var(--color-chart-3)" shape="bar" />
        <LegendItem label={t('analytics.income')} color="var(--color-success)" shape="line" />
      </ul>

      <div
        className="h-56 min-w-0 sm:h-60"
        role="img"
        aria-label={t('analytics.trendChartLabel')}
        aria-describedby="spending-trend-data"
      >
        <SafeChart>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={8}
              minTickGap={14}
              height={28}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={4}
              tickFormatter={(value) =>
                formatCompactChartMoney(Number(value), displayCurrency, locale)
              }
              width={58}
            />
            <Tooltip
              contentStyle={{
                ...CHART_TOOLTIP_STYLE,
                maxWidth: 'min(260px, calc(100vw - 32px))',
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
              itemStyle={{
                ...CHART_ITEM_STYLE,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                flexWrap: 'wrap',
                whiteSpace: 'normal',
              }}
              labelStyle={CHART_LABEL_STYLE}
              formatter={(value, name) => [
                formatMoney(Number(value), displayCurrency, locale),
                name,
              ]}
            />
            <Bar
              dataKey="expenses"
              name={t('analytics.expenses')}
              fill="var(--color-chart-3)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="income"
              name={t('analytics.income')}
              stroke="var(--color-success)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: 'var(--color-success)' }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </SafeChart>
      </div>

      <div className="sr-only">
        <table id="spending-trend-data">
          <caption>{t('analytics.trendChartLabel')}</caption>
          <thead>
            <tr>
              <th>{t('analytics.month')}</th>
              <th>{t('analytics.income')}</th>
              <th>{t('analytics.expenses')}</th>
              <th>{t('analytics.net')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((month) => (
              <tr key={month.key}>
                <th>{month.label}</th>
                <td>{formatMoney(month.income, displayCurrency, locale)}</td>
                <td>{formatMoney(month.expenses, displayCurrency, locale)}</td>
                <td>{formatMoney(month.net, displayCurrency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!hasData ? (
        <p className="text-muted-foreground text-center text-sm">{t('analytics.noEligibleData')}</p>
      ) : null}
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border-border min-w-0 px-2.5 py-2.5 sm:px-3 [&:not(:last-child)]:border-r">
      <dt className="text-muted-foreground text-[10px] leading-tight font-semibold tracking-wider [overflow-wrap:anywhere] uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-sm leading-tight font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums sm:text-base',
          color
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function LegendItem({
  label,
  color,
  shape,
}: {
  label: string
  color: string
  shape: 'bar' | 'line'
}) {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight">
      <span
        aria-hidden="true"
        className={cn('w-4 shrink-0 rounded-sm', shape === 'bar' ? 'h-2' : 'h-0.5')}
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground [overflow-wrap:anywhere]">{label}</span>
    </li>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs font-semibold"
      role="status"
    >
      {children}
    </div>
  )
}
