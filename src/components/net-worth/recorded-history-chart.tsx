import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FX_CURRENCIES } from '@shikin/finance-core/fx'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'
import {
  isSafeRecordedPoint,
  recordedBarPlotMinWidth,
  recordedSeriesVisual,
  type RecordedChartStyle,
  type RecordedNetWorthPoint,
  type RecordedSeriesKey,
  type RecordedSeriesVisual,
} from '@/components/net-worth/recorded-series'

const SERIES_KEYS = ['netWorth', 'assets', 'liabilities'] as const

function isSeriesKey(value: unknown): value is RecordedSeriesKey {
  return value === 'netWorth' || value === 'assets' || value === 'liabilities'
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function formatAxisDate(value: unknown, points: readonly RecordedNetWorthPoint[]): string {
  if (typeof value === 'number' && Number.isInteger(value) && isIsoDate(points[value]?.date)) {
    return dayjs(points[value].date).format('MMM D')
  }
  if (!isIsoDate(value)) return ''
  return dayjs(value).format('MMM D')
}

function formatExactDate(value: unknown): string {
  if (!isIsoDate(value)) return '—'
  return dayjs(value).format('MMM D, YYYY')
}

function formatExactMoney(value: unknown, currency: string): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return '—'
  if (!(FX_CURRENCIES as readonly string[]).includes(currency)) return '—'
  return formatMoney(value, currency)
}

function endpointDot(lastIndex: number, fill: string) {
  return function NetWorthEndpointDot(props: { cx?: number; cy?: number; index?: number }) {
    if (
      typeof props.cx !== 'number' ||
      typeof props.cy !== 'number' ||
      (props.index !== 0 && props.index !== lastIndex)
    ) {
      return <g />
    }
    return <circle cx={props.cx} cy={props.cy} r={2.5} fill={fill} />
  }
}

function strokeProps(visual: RecordedSeriesVisual) {
  return {
    stroke: visual.stroke,
    strokeWidth: visual.strokeWidth,
    strokeOpacity: visual.strokeOpacity,
    ...(visual.strokeDasharray ? { strokeDasharray: visual.strokeDasharray } : {}),
  }
}

function RecordedTooltip({
  active,
  label,
  payload,
  currency,
  labels,
}: {
  active?: boolean
  label?: unknown
  payload?: ReadonlyArray<{
    dataKey?: unknown
    name?: unknown
    value?: unknown
    payload?: Partial<RecordedNetWorthPoint>
  }>
  currency: string
  labels: Record<RecordedSeriesKey, string>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const date = isIsoDate(point?.date) ? point.date : isIsoDate(label) ? label : undefined
  const rows = payload.flatMap((item) => {
    const key = isSeriesKey(item.dataKey) ? item.dataKey : isSeriesKey(item.name) ? item.name : null
    if (!key) return []
    const field = point?.[key]
    return [
      {
        key,
        amount: formatExactMoney(typeof item.value === 'number' ? item.value : field, currency),
      },
    ]
  })
  const currencyLabel = (FX_CURRENCIES as readonly string[]).includes(currency)
    ? ` · ${currency}`
    : ''
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <p style={{ ...CHART_LABEL_STYLE, margin: 0 }}>
        {formatExactDate(date)}
        {currencyLabel}
      </p>
      {rows.map((row) => (
        <p key={row.key} style={{ ...CHART_ITEM_STYLE, margin: '2px 0 0' }}>
          {labels[row.key]}: {row.amount}
        </p>
      ))}
    </div>
  )
}

function RecordedAxes({
  points,
  currency,
  dense,
  tooltip,
}: {
  points: readonly RecordedNetWorthPoint[]
  currency: string
  dense: boolean
  tooltip: ReactNode
}) {
  return (
    <>
      <CartesianGrid vertical={false} strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
      <XAxis
        dataKey="date"
        allowDuplicatedCategory
        axisLine={false}
        tickLine={false}
        tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
        tickFormatter={(value) => formatAxisDate(value, points)}
        minTickGap={dense ? 0 : 16}
        {...(dense ? { interval: 0 as const } : {})}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        width={52}
        tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
        tickFormatter={(value) => {
          if (!(FX_CURRENCIES as readonly string[]).includes(currency)) return ''
          const amount = typeof value === 'number' ? value : Number(value)
          if (!Number.isFinite(amount)) return ''
          return formatCompactChartMoney(amount, currency)
        }}
      />
      {tooltip}
    </>
  )
}

function ComparisonLines({ compare }: { compare: boolean }) {
  return (
    <>
      {(['assets', 'liabilities'] as const).map((key) => {
        const visual = recordedSeriesVisual(key, compare)
        return (
          <Line
            key={key}
            type="linear"
            dataKey={key}
            name={key}
            {...strokeProps(visual)}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: visual.stroke }}
            isAnimationActive={false}
            connectNulls={false}
          />
        )
      })}
    </>
  )
}

export function RecordedNetWorthChart({
  points,
  currency,
  chartStyle,
  compare,
  title,
  describedBy,
}: {
  points: readonly RecordedNetWorthPoint[]
  currency: string
  chartStyle: RecordedChartStyle
  compare: boolean
  title: string
  describedBy: string
}) {
  const { t } = useTranslation('analytics')
  if (points.length < 2 || points.some((point) => !isSafeRecordedPoint(point))) return null

  const labels: Record<RecordedSeriesKey, string> = {
    netWorth: t('netWorth.recordedNetWorth'),
    assets: t('netWorth.recordedAssets'),
    liabilities: t('netWorth.recordedLiabilities'),
  }
  const tooltip = (
    <Tooltip
      content={(props) => (
        <RecordedTooltip
          active={props.active}
          label={props.label}
          payload={props.payload}
          currency={currency}
          labels={labels}
        />
      )}
      contentStyle={CHART_TOOLTIP_STYLE}
      itemStyle={CHART_ITEM_STYLE}
      labelStyle={CHART_LABEL_STYLE}
      isAnimationActive={false}
    />
  )
  const netWorth = recordedSeriesVisual('netWorth', compare)
  const chartData = points as RecordedNetWorthPoint[]

  let plot: ReactNode
  if (chartStyle === 'bars') {
    plot = (
      <div
        data-testid="net-worth-bar-scroll"
        className="focus-visible:ring-ring h-64 w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain focus-visible:ring-2 focus-visible:outline-none sm:h-72"
        tabIndex={0}
        role="img"
        aria-label={title}
        aria-describedby={describedBy}
      >
        {/* Each recorded date keeps a slot. Scroll locally instead of dropping or zero-filling dates. */}
        <div
          data-testid="net-worth-bar-canvas"
          className="h-full"
          style={{ width: '100%', minWidth: recordedBarPlotMinWidth(points.length) }}
        >
          <SafeChart>
            <BarChart
              data={chartData}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
              barGap={3}
              barCategoryGap={10}
              accessibilityLayer={false}
            >
              <RecordedAxes points={points} currency={currency} dense tooltip={tooltip} />
              {SERIES_KEYS.map((key) => {
                const visual = recordedSeriesVisual(key, compare)
                return (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={key}
                    fill={visual.fill}
                    fillOpacity={visual.barFillOpacity}
                    maxBarSize={14}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                )
              })}
            </BarChart>
          </SafeChart>
        </div>
      </div>
    )
  } else if (chartStyle === 'area') {
    plot = (
      <div
        className="h-64 min-w-0 sm:h-72"
        role="img"
        aria-label={title}
        aria-describedby={describedBy}
      >
        <SafeChart>
          <AreaChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
            <RecordedAxes points={points} currency={currency} dense={false} tooltip={tooltip} />
            <Area
              type="linear"
              dataKey="netWorth"
              name="netWorth"
              stroke={netWorth.stroke}
              strokeWidth={netWorth.strokeWidth}
              fill={netWorth.fill}
              fillOpacity={netWorth.areaFillOpacity}
              dot={endpointDot(points.length - 1, netWorth.stroke)}
              activeDot={{ r: 3, strokeWidth: 0, fill: netWorth.stroke }}
              isAnimationActive={false}
              connectNulls={false}
            />
            <ComparisonLines compare={compare} />
          </AreaChart>
        </SafeChart>
      </div>
    )
  } else {
    plot = (
      <div
        className="h-64 min-w-0 sm:h-72"
        role="img"
        aria-label={title}
        aria-describedby={describedBy}
      >
        <SafeChart>
          <LineChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
            <RecordedAxes points={points} currency={currency} dense={false} tooltip={tooltip} />
            <ComparisonLines compare={compare} />
            <Line
              type="linear"
              dataKey="netWorth"
              name="netWorth"
              stroke={netWorth.stroke}
              strokeWidth={netWorth.strokeWidth}
              dot={endpointDot(points.length - 1, netWorth.stroke)}
              activeDot={{ r: 3, strokeWidth: 0, fill: netWorth.stroke }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </SafeChart>
      </div>
    )
  }

  return (
    <div
      className="w-full max-w-full min-w-0"
      data-testid="net-worth-recorded-plot"
      data-chart-style={chartStyle}
      data-currency={currency}
      data-points={points.length}
      data-compare={compare ? 'true' : 'false'}
    >
      {plot}
    </div>
  )
}

export function RecordedSeriesLegend({
  chartStyle,
  compare,
}: {
  chartStyle: RecordedChartStyle
  compare: boolean
}) {
  const { t } = useTranslation('analytics')
  const labels: Record<RecordedSeriesKey, string> = {
    netWorth: t('netWorth.recordedNetWorth'),
    assets: t('netWorth.recordedAssets'),
    liabilities: t('netWorth.recordedLiabilities'),
  }
  return (
    <ul
      className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]"
      aria-label={t('netWorth.recordedSeries')}
    >
      {SERIES_KEYS.map((key) => {
        const visual = recordedSeriesVisual(key, compare)
        return (
          <li key={key} className="flex items-center gap-1.5">
            {chartStyle === 'bars' ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: visual.fill, opacity: visual.barFillOpacity }}
              />
            ) : visual.strokeDasharray ? (
              <span
                aria-hidden="true"
                className="h-px w-4 border-t border-dashed"
                style={{ borderColor: visual.stroke, opacity: visual.strokeOpacity }}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn('w-4', key === 'netWorth' ? 'h-0.5' : 'h-px')}
                style={{ backgroundColor: visual.stroke, opacity: visual.strokeOpacity }}
              />
            )}
            {labels[key]}
          </li>
        )
      })}
    </ul>
  )
}
