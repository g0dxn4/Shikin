import { useTranslation } from 'react-i18next'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { formatMoney } from '@/lib/money'
import { CHART_TOOLTIP_STYLE, CHART_ITEM_STYLE, CHART_LABEL_STYLE } from '@/lib/constants'
import type { PaceResult } from '@/lib/dashboard-analytics'
import { SafeChart } from '@/components/ui/safe-chart'
import { cn } from '@/lib/utils'

interface SpendingPacePanelProps {
  pace: PaceResult
  displayCurrency: string
  notice: string | null
}

export function SpendingPacePanel({ pace, displayCurrency, notice }: SpendingPacePanelProps) {
  const { t } = useTranslation('dashboard')

  const data = pace.points.map((p) => ({
    day: p.day,
    current: p.current,
    previous: p.previous,
    priorAverage: p.priorAverage,
    runRate: p.runRate,
  }))

  const hasCurrent = data.some((d) => d.current !== null)
  const hasPrevious = data.some((d) => d.previous !== null)
  const hasPriorAverage = data.some((d) => d.priorAverage !== null && d.priorAverage > 0)

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

      <div
        className="h-72"
        role="img"
        aria-label={t('analytics.paceChartLabel')}
        aria-describedby="spending-pace-data"
      >
        <SafeChart>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="day"
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
              formatter={(value, name) => {
                if (value === null || value === undefined) return ['—', name]
                return [formatMoney(Number(value), displayCurrency), name]
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#A9A9B4' }} />
            {hasPrevious && (
              <Line
                type="monotone"
                dataKey="previous"
                name={t('analytics.previousMonth')}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {hasPriorAverage && (
              <Line
                type="monotone"
                dataKey="priorAverage"
                name={t('analytics.priorMonthsAverage')}
                stroke="#34D399"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="runRate"
              name={t('analytics.runRate')}
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="8 4"
              dot={false}
              isAnimationActive={false}
            />
            {hasCurrent && (
              <Line
                type="monotone"
                dataKey="current"
                name={t('analytics.currentMonth')}
                stroke="#7C5CFF"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </LineChart>
        </SafeChart>
      </div>

      <table id="spending-pace-data" className="sr-only">
        <caption>{t('analytics.paceChartLabel')}</caption>
        <thead>
          <tr>
            <th>{t('analytics.day')}</th>
            <th>{t('analytics.currentMonth')}</th>
            <th>{t('analytics.previousMonth')}</th>
            <th>{t('analytics.priorMonthsAverage')}</th>
            <th>{t('analytics.runRate')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.day}>
              <th>{point.day}</th>
              <td>{point.current === null ? '—' : formatMoney(point.current, displayCurrency)}</td>
              <td>
                {point.previous === null ? '—' : formatMoney(point.previous, displayCurrency)}
              </td>
              <td>
                {point.priorAverage === null
                  ? '—'
                  : formatMoney(point.priorAverage, displayCurrency)}
              </td>
              <td>{point.runRate === null ? '—' : formatMoney(point.runRate, displayCurrency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricPill
          label={t('analytics.spentMtd')}
          value={formatMoney(pace.spentMTD, displayCurrency)}
          color="text-destructive"
        />
        <MetricPill
          label={t('analytics.projectedMonthEnd')}
          value={formatMoney(pace.projectedMonthEnd, displayCurrency)}
          color="text-warning"
        />
        <MetricPill
          label={t('analytics.priorAverage')}
          value={formatMoney(pace.priorAverageTotal, displayCurrency)}
          color="text-muted-foreground"
        />
        <MetricPill
          label={t('analytics.vsPriorAverage')}
          value={formatMoney(Math.abs(pace.vsPriorAverage), displayCurrency)}
          prefix={pace.vsPriorAverage >= 0 ? '+' : '−'}
          color={pace.vsPriorAverage >= 0 ? 'text-destructive' : 'text-success'}
        />
      </div>
    </div>
  )
}

function MetricPill({
  label,
  value,
  prefix,
  color,
}: {
  label: string
  value: string
  prefix?: string
  color?: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3">
      <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
        {label}
      </p>
      <p className={cn('font-heading mt-1 text-lg font-bold tracking-tight', color)}>
        {prefix}
        {value}
      </p>
    </div>
  )
}
