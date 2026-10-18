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
import type { ForecastPoint } from '@/lib/forecast-service'
import { formatMoney } from '@/lib/money'
import {
  FORECAST_SERIES_COLOR,
  forecastProjectionRows,
} from '@/components/planning-scenarios/scenario-series'

interface ForecastProjectionChartProps {
  points: ForecastPoint[]
  currency: string
}

export function ForecastProjectionChart({ points, currency }: ForecastProjectionChartProps) {
  const { t, i18n } = useTranslation('forecast')
  const locale = i18n?.resolvedLanguage ?? i18n?.language
  const gradientId = `forecast-projected-${useId().replace(/:/g, '')}`
  const rows = forecastProjectionRows(points)

  if (rows.length === 0) return null

  const chartRows = rows.map((row) => ({
    ...row,
    label: dayjs(row.date).format('MMM D'),
  }))
  const money = (amount: number) => formatMoney(amount, currency)

  return (
    <div className="min-w-0" data-projected-stroke={FORECAST_SERIES_COLOR.projected}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label={t('chart.title')}>
        {(
          [
            ['projected', FORECAST_SERIES_COLOR.projected],
            ['optimistic', FORECAST_SERIES_COLOR.optimistic],
            ['pessimistic', FORECAST_SERIES_COLOR.pessimistic],
          ] as const
        ).map(([key, color]) => (
          <li key={key} className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              className="inline-block h-0.5 w-4"
              style={{
                backgroundColor: color,
                opacity: key === 'projected' ? 1 : 0.85,
              }}
              aria-hidden="true"
            />
            {t(`chart.${key}`)}
          </li>
        ))}
      </ul>
      <div className="mt-3 h-64 min-w-0 sm:h-80" role="img" aria-label={t('chart.title')}>
        <SafeChart>
          <ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={FORECAST_SERIES_COLOR.projected} stopOpacity={0.2} />
                <stop offset="100%" stopColor={FORECAST_SERIES_COLOR.projected} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={8}
              minTickGap={24}
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
                const date = payload?.[0]?.payload?.date
                return typeof date === 'string' ? dayjs(date).format('MMM D, YYYY') : String(_label)
              }}
              formatter={(value, name) => [money(Number(value)), name]}
            />
            <Line
              type="linear"
              dataKey="optimistic"
              name={t('chart.optimistic')}
              stroke={FORECAST_SERIES_COLOR.optimistic}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="pessimistic"
              name={t('chart.pessimistic')}
              stroke={FORECAST_SERIES_COLOR.pessimistic}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="projected"
              name={t('chart.projected')}
              stroke={FORECAST_SERIES_COLOR.projected}
              strokeWidth={2.25}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={false}
            />
          </ComposedChart>
        </SafeChart>
      </div>
      <details className="mt-3">
        <summary className="text-accent cursor-pointer text-xs font-semibold">
          {t('chart.data')}
        </summary>
        <div className="mt-2 max-h-64 max-w-full overflow-auto">
          <table className="w-max min-w-full text-left text-xs">
            <caption className="sr-only">{t('chart.title')}</caption>
            <thead>
              <tr>
                {(['date', 'projected', 'optimistic', 'pessimistic'] as const).map((key) => (
                  <th scope="col" key={key} className="px-3 py-2 font-medium whitespace-nowrap">
                    {t(`chart.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((point) => (
                <tr key={point.date} className="border-border border-t">
                  <th scope="row" className="px-3 py-2 font-normal whitespace-nowrap">
                    {point.date}
                  </th>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {money(point.projected)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {money(point.optimistic)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {money(point.pessimistic)}
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
