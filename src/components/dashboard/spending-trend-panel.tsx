import { useTranslation } from 'react-i18next'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { formatMoney } from '@/lib/money'
import { CHART_TOOLTIP_STYLE, CHART_ITEM_STYLE, CHART_LABEL_STYLE } from '@/lib/constants'
import type { TrendResult } from '@/lib/dashboard-analytics'
import { SafeChart } from '@/components/ui/safe-chart'
import { cn } from '@/lib/utils'

interface SpendingTrendPanelProps {
  trend: TrendResult
  displayCurrency: string
  notice: string | null
}

export function SpendingTrendPanel({ trend, displayCurrency, notice }: SpendingTrendPanelProps) {
  const { t } = useTranslation('dashboard')

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
          className="border-warning/30 bg-warning/8 text-warning rounded-xl border px-3 py-2 text-xs font-semibold"
          role="status"
        >
          {notice}
        </div>
      )}

      <div className="h-72" role="img" aria-label={t('analytics.trendChartLabel')}>
        <SafeChart>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#A9A9B4', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#A9A9B4', fontSize: 11 }}
              tickFormatter={(v) => formatMoney(Number(v), displayCurrency)}
              width={64}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              itemStyle={CHART_ITEM_STYLE}
              labelStyle={CHART_LABEL_STYLE}
              formatter={(value, name) => [formatMoney(Number(value), displayCurrency), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#A9A9B4' }} />
            <Bar
              dataKey="expenses"
              name={t('analytics.expenses')}
              fill="rgba(255,255,255,0.16)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="income"
              name={t('analytics.income')}
              stroke="#34D399"
              strokeWidth={2}
              dot={{ r: 3, fill: '#34D399' }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </SafeChart>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MetricPill
          label={t('analytics.income')}
          value={formatMoney(trend.totalIncome, displayCurrency)}
          color="text-success"
        />
        <MetricPill
          label={t('analytics.expenses')}
          value={formatMoney(trend.totalExpenses, displayCurrency)}
          color="text-destructive"
        />
        <MetricPill
          label={t('analytics.net')}
          value={formatMoney(trend.totalNet, displayCurrency)}
          color={trend.totalNet >= 0 ? 'text-success' : 'text-destructive'}
        />
      </div>

      {!hasData && (
        <p className="text-muted-foreground text-center text-sm">
          {t('analytics.noEligibleData')}
        </p>
      )}
    </div>
  )
}

function MetricPill({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3">
      <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">{label}</p>
      <p className={cn('font-heading mt-1 text-lg font-bold tracking-tight', color)}>{value}</p>
    </div>
  )
}
