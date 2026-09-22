import { useTranslation } from 'react-i18next'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { formatMoney } from '@/lib/money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_LEGEND_STYLE,
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

  const data = trend.months.map((m) => ({
    key: m.key,
    label: m.label,
    expenses: m.expenses,
    income: m.income,
    net: m.net,
  }))

  const hasData = data.some((d) => d.expenses !== 0 || d.income !== 0)

  return (
    <div className="space-y-4">
      {notice && (
        <div
          className="border-warning/30 bg-warning/10 text-warning rounded-xl border px-3 py-2 text-xs font-semibold"
          role="status"
        >
          {notice}
        </div>
      )}

      <div
        className="h-68 min-w-0 sm:h-72"
        role="img"
        aria-label={t('analytics.trendChartLabel')}
        aria-describedby="spending-trend-data"
      >
        <SafeChart>
          <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
              tickMargin={8}
              minTickGap={14}
              height={28}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
              tickMargin={6}
              tickFormatter={(v) => formatCompactChartMoney(Number(v), displayCurrency, locale)}
              width={62}
            />
            <Tooltip
              contentStyle={{
                ...CHART_TOOLTIP_STYLE,
                maxWidth: 'min(260px, calc(100vw - 32px))',
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
              itemStyle={{ ...CHART_ITEM_STYLE, whiteSpace: 'normal' }}
              labelStyle={CHART_LABEL_STYLE}
              formatter={(value, name) => [
                formatMoney(Number(value), displayCurrency, locale),
                name,
              ]}
            />
            <Legend wrapperStyle={{ ...CHART_LEGEND_STYLE, fontSize: 11 }} />
            <Bar
              dataKey="expenses"
              name={t('analytics.expenses')}
              fill="var(--color-chart-3)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="income"
              name={t('analytics.income')}
              stroke="var(--color-success)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-success)' }}
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

      <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-3 min-[560px]:gap-3">
        <MetricPill
          label={t('analytics.income')}
          value={formatMoney(trend.totalIncome, displayCurrency, locale)}
          color="text-success"
        />
        <MetricPill
          label={t('analytics.expenses')}
          value={formatMoney(trend.totalExpenses, displayCurrency, locale)}
          color="text-destructive"
        />
        <MetricPill
          label={t('analytics.net')}
          value={formatMoney(trend.totalNet, displayCurrency, locale)}
          color={trend.totalNet >= 0 ? 'text-success' : 'text-destructive'}
        />
      </div>

      {!hasData && (
        <p className="text-muted-foreground text-center text-sm">{t('analytics.noEligibleData')}</p>
      )}
    </div>
  )
}

function MetricPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border-border bg-muted/45 flex min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 min-[560px]:block min-[560px]:p-3">
      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p
        className={cn(
          'min-w-0 text-right text-base font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums min-[560px]:mt-1 min-[560px]:text-left min-[560px]:text-lg',
          color
        )}
      >
        {value}
      </p>
    </div>
  )
}
