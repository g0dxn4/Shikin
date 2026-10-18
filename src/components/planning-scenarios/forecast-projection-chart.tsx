import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { CartesianGrid, ComposedChart, Line, Area, Tooltip, XAxis, YAxis } from 'recharts'
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
  forecastBandGeometry,
  forecastUncertaintyBand,
} from '@/components/planning-scenarios/forecast-band-geometry'
import {
  FORECAST_SERIES_COLOR,
  forecastProjectionRows,
  type ForecastProjectionRow,
} from '@/components/planning-scenarios/scenario-series'

interface ForecastProjectionChartProps {
  points: ForecastPoint[]
  currency: string
}

const BAND_FILL = FORECAST_SERIES_COLOR.projected
const PROJECTED_STROKE_WIDTH = 2
const OUTER_STROKE_WIDTH = 1.25

function seriesExtent(rows: ForecastProjectionRow[]): { min: number; max: number } {
  let min = rows[0].projected
  let max = rows[0].projected
  for (const row of rows) {
    for (const value of [row.projected, row.optimistic, row.pessimistic]) {
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  return { min, max }
}

export function ForecastProjectionChart({ points, currency }: ForecastProjectionChartProps) {
  const { t, i18n } = useTranslation('forecast')
  const locale = i18n?.resolvedLanguage ?? i18n?.language
  const rows = forecastProjectionRows(points)
  const geometry = forecastBandGeometry(rows)

  if (rows.length === 0 || geometry === null) return null

  const extent = seriesExtent(rows)
  const chartRows = rows.map((row) => ({
    ...row,
    band: forecastUncertaintyBand(row),
  }))
  const money = (amount: number) => formatMoney(amount, currency)
  const domainLabel = `${geometry.domain[0]},${geometry.domain[1]}`

  return (
    <div
      className="min-w-0"
      data-projected-stroke={FORECAST_SERIES_COLOR.projected}
      data-projected-width={PROJECTED_STROKE_WIDTH}
      data-band="between"
      data-band-fill={BAND_FILL}
      data-includes-zero={geometry.includesZero ? 'true' : 'false'}
      data-domain={domainLabel}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-xs font-semibold">{t('chart.title')}</h2>
        <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1" aria-label={t('chart.title')}>
          {(
            [
              ['projected', FORECAST_SERIES_COLOR.projected, false],
              ['optimistic', FORECAST_SERIES_COLOR.optimistic, true],
              ['pessimistic', FORECAST_SERIES_COLOR.pessimistic, true],
            ] as const
          ).map(([key, color, dashed]) => (
            <li key={key} className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span
                className="inline-block w-4"
                style={{
                  borderTopWidth: dashed ? OUTER_STROKE_WIDTH : PROJECTED_STROKE_WIDTH,
                  borderTopStyle: dashed ? 'dashed' : 'solid',
                  borderTopColor: color,
                }}
                aria-hidden="true"
              />
              {t(`chart.${key}`)}
            </li>
          ))}
        </ul>
      </div>
      <div
        className="mt-2 h-52 min-w-0 sm:h-72"
        role="img"
        aria-label={`${t('chart.title')}, ${money(extent.min)} – ${money(extent.max)}`}
      >
        <SafeChart>
          <ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={8}
              minTickGap={24}
              interval="preserveStartEnd"
              tickFormatter={(value) => dayjs(String(value)).format('MMM D')}
            />
            <YAxis
              type="number"
              domain={geometry.domain}
              allowDataOverflow
              tickCount={4}
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={4}
              width={60}
              tickFormatter={(value) => formatCompactChartMoney(Number(value), currency, locale)}
            />
            <Tooltip
              content={(tooltip) => {
                const point = tooltip.payload?.[0]?.payload as ForecastProjectionRow | undefined
                if (!tooltip.active || !point) return null
                return (
                  <div
                    style={{
                      ...CHART_TOOLTIP_STYLE,
                      maxWidth: 'min(280px, calc(100vw - 32px))',
                      overflowWrap: 'anywhere',
                      whiteSpace: 'normal',
                      padding: '8px 10px',
                    }}
                  >
                    <p style={{ ...CHART_LABEL_STYLE, margin: 0 }}>
                      {dayjs(point.date).format('MMM D, YYYY')}
                    </p>
                    {(['projected', 'optimistic', 'pessimistic'] as const).map((key) => (
                      <p key={key} style={{ ...CHART_ITEM_STYLE, margin: '2px 0 0' }}>
                        {t(`chart.${key}`)}: {money(point[key])}
                      </p>
                    ))}
                  </div>
                )
              }}
            />
            <Area
              type="linear"
              dataKey="band"
              stroke="none"
              strokeWidth={0}
              fill={BAND_FILL}
              fillOpacity={0.12}
              legendType="none"
              tooltipType="none"
              activeDot={false}
              isAnimationActive={false}
              dot={false}
            />
            <Line
              type="linear"
              dataKey="optimistic"
              name={t('chart.optimistic')}
              stroke={FORECAST_SERIES_COLOR.optimistic}
              strokeWidth={OUTER_STROKE_WIDTH}
              strokeDasharray="4 3"
              strokeLinecap="round"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="pessimistic"
              name={t('chart.pessimistic')}
              stroke={FORECAST_SERIES_COLOR.pessimistic}
              strokeWidth={OUTER_STROKE_WIDTH}
              strokeDasharray="4 3"
              strokeLinecap="round"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="projected"
              name={t('chart.projected')}
              stroke={FORECAST_SERIES_COLOR.projected}
              strokeWidth={PROJECTED_STROKE_WIDTH}
              strokeLinecap="round"
              dot={false}
              isAnimationActive={false}
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
