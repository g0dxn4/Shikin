import { useTranslation } from 'react-i18next'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { formatMoney } from '@/lib/money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import type { PaceResult } from '@/lib/dashboard-analytics'
import { SafeChart } from '@/components/ui/safe-chart'
import { cn } from '@/lib/utils'
import { formatCompactChartMoney } from './chart-money'

interface SpendingPacePanelProps {
  pace: PaceResult
  displayCurrency: string
  notice: string | null
}

export function SpendingPacePanel({ pace, displayCurrency, notice }: SpendingPacePanelProps) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n?.resolvedLanguage ?? i18n?.language

  const data = pace.points.map((point) => ({
    day: point.day,
    current: point.current,
    previous: point.previous,
    priorAverage: point.priorAverage,
    runRate: point.runRate,
  }))

  const hasCurrent = data.some((point) => point.current !== null)
  const hasPrevious = data.some((point) => point.previous !== null)
  const hasPriorAverage = data.some(
    (point) => point.priorAverage !== null && point.priorAverage > 0
  )

  return (
    <div className="space-y-3">
      {notice ? <Notice>{notice}</Notice> : null}

      <dl className="border-border grid grid-cols-2 border-b sm:grid-cols-4">
        <Metric
          label={t('analytics.spentMtd')}
          value={formatMoney(pace.spentMTD, displayCurrency, locale)}
          color="text-destructive"
        />
        <Metric
          label={t('analytics.projectedMonthEnd')}
          value={formatMoney(pace.projectedMonthEnd, displayCurrency, locale)}
          color="text-warning"
        />
        <Metric
          label={t('analytics.priorAverage')}
          value={formatMoney(pace.priorAverageTotal, displayCurrency, locale)}
        />
        <Metric
          label={t('analytics.vsPriorAverage')}
          value={`${pace.vsPriorAverage >= 0 ? '+' : '−'}${formatMoney(
            Math.abs(pace.vsPriorAverage),
            displayCurrency,
            locale
          )}`}
          color={pace.vsPriorAverage >= 0 ? 'text-destructive' : 'text-success'}
        />
      </dl>

      <ChartLegend
        ariaLabel={t('analytics.legend')}
        items={[
          ...(hasCurrent
            ? [{ label: t('analytics.currentMonth'), color: 'var(--color-chart-1)' }]
            : []),
          ...(hasPrevious
            ? [{ label: t('analytics.previousMonth'), color: 'var(--color-muted-foreground)' }]
            : []),
          ...(hasPriorAverage
            ? [{ label: t('analytics.priorMonthsAverage'), color: 'var(--color-success)' }]
            : []),
          { label: t('analytics.runRate'), color: 'var(--color-warning)' },
        ]}
      />

      <div
        className="h-56 min-w-0 sm:h-60"
        role="img"
        aria-label={t('analytics.paceChartLabel')}
        aria-describedby="spending-pace-data"
      >
        <SafeChart>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
              tickMargin={8}
              minTickGap={18}
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
              formatter={(value, name) => {
                if (value === null || value === undefined) return ['—', name]
                return [formatMoney(Number(value), displayCurrency, locale), name]
              }}
            />
            {hasPrevious ? (
              <Line
                type="monotone"
                dataKey="previous"
                name={t('analytics.previousMonth')}
                stroke="var(--color-muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ) : null}
            {hasPriorAverage ? (
              <Line
                type="monotone"
                dataKey="priorAverage"
                name={t('analytics.priorMonthsAverage')}
                stroke="var(--color-success)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="runRate"
              name={t('analytics.runRate')}
              stroke="var(--color-warning)"
              strokeWidth={1.5}
              strokeDasharray="8 4"
              dot={false}
              isAnimationActive={false}
            />
            {hasCurrent ? (
              <Line
                type="monotone"
                dataKey="current"
                name={t('analytics.currentMonth')}
                stroke="var(--color-chart-1)"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
          </LineChart>
        </SafeChart>
      </div>

      <div className="sr-only">
        <table id="spending-pace-data">
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
                <td>
                  {point.current === null
                    ? '—'
                    : formatMoney(point.current, displayCurrency, locale)}
                </td>
                <td>
                  {point.previous === null
                    ? '—'
                    : formatMoney(point.previous, displayCurrency, locale)}
                </td>
                <td>
                  {point.priorAverage === null
                    ? '—'
                    : formatMoney(point.priorAverage, displayCurrency, locale)}
                </td>
                <td>
                  {point.runRate === null
                    ? '—'
                    : formatMoney(point.runRate, displayCurrency, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border-border min-w-0 px-2.5 py-2.5 odd:border-r sm:px-3 sm:odd:border-r sm:[&:not(:last-child)]:border-r">
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

function ChartLegend({
  ariaLabel,
  items,
}: {
  ariaLabel: string
  items: Array<{ label: string; color: string }>
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label={ariaLabel}>
      {items.map((item) => (
        <li
          key={item.label}
          className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight"
        >
          <span
            aria-hidden="true"
            className="h-0.5 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-muted-foreground [overflow-wrap:anywhere]">{item.label}</span>
        </li>
      ))}
    </ul>
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
