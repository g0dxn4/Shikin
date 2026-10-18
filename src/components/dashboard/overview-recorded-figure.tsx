import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  buildRecordedBalanceModel,
  formatRecordedAxisDate,
  type RecordedBalanceModel,
  type RecordedBalancePoint,
} from '@/components/charts/recorded-balance-model'
import { SafeChart } from '@/components/ui/safe-chart'
import {
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { NetWorthPeriod } from '@/components/dashboard/overview-net-worth'
import {
  stepSummarySelection,
  summaryDateTickBudget,
  summaryPointSelection,
  type SummaryComposition,
  type SummaryHistoryPoint,
  type SummaryPlainReason,
  type SummaryPointSelection,
  type SummaryVisual,
} from '@/components/dashboard/overview-summary-visual'

/** Chart box. Inner plot is box minus top margin and the date-axis band. */
const SUMMARY_CHART_BOX_PX = 292
const SUMMARY_CHART_MARGIN_TOP = 12
const SUMMARY_X_AXIS_HEIGHT = 36
const SUMMARY_PLOT_INNER_PX =
  SUMMARY_CHART_BOX_PX - SUMMARY_CHART_MARGIN_TOP - SUMMARY_X_AXIS_HEIGHT
const CHART_MARGIN = { top: SUMMARY_CHART_MARGIN_TOP, right: 4, bottom: 0, left: 0 } as const
const TICK_FILL = 'var(--color-foreground)'
const SERIES_STROKE = 'var(--color-chart-1)'

const RECORDED_TABLE_ID = 'overview-summary-recorded-snapshots'
const RECORDED_CAPTION_ID = 'overview-summary-recorded-caption'
const COMPOSITION_TABLE_ID = 'overview-summary-composition'
const COMPOSITION_CAPTION_ID = 'overview-summary-composition-caption'

const FOOTER_CONTROL =
  'focus-visible:ring-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface px-2 text-xs font-semibold text-foreground focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none sm:min-h-8 sm:min-w-8'
const DISCLOSURE =
  'text-accent focus-visible:ring-ring inline-flex min-h-11 cursor-pointer list-none items-center rounded-md px-1 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none sm:min-h-8 [&::-webkit-details-marker]:hidden'

const COMPOSITION_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

const PLAIN_MESSAGE = {
  'one-snapshot': 'overview.summaryOneSnapshot',
  'no-snapshots': 'overview.summaryNoSnapshots',
  'history-unavailable': 'overview.summaryHistoryUnavailable',
  'history-loading': 'overview.summaryHistoryLoading',
  'composition-unproven': 'overview.summaryCompositionUnproven',
  'current-only': 'overview.summaryCurrentOnly',
} as const satisfies Record<SummaryPlainReason, `overview.${string}`>

type ChartDisplay = 'line' | 'area'
type PlottedModel = Exclude<RecordedBalanceModel, { status: 'invalid' | 'empty' }>
type SeriesModel = PlottedModel & { status: 'series' }
type FlatModel = PlottedModel & { status: 'flat' }
type SingleModel = PlottedModel & { status: 'single' }

function isSeries(model: RecordedBalanceModel | null): model is SeriesModel {
  return model?.status === 'series'
}

function isFlat(model: RecordedBalanceModel | null): model is FlatModel {
  return model?.status === 'flat'
}

function isSingle(model: RecordedBalanceModel | null): model is SingleModel {
  return model?.status === 'single'
}

function isPlotted(model: RecordedBalanceModel | null): model is PlottedModel {
  return model !== null && model.status !== 'invalid' && model.status !== 'empty'
}

interface OverviewRecordedFigureProps {
  visual: SummaryVisual
  period: NetWorthPeriod
  periodLabel: string
  historyUnavailableMessage?: string
  onPeriodChange: (period: NetWorthPeriod) => void
}

function chartLocale(language: string | undefined): string {
  const value = language?.trim()
  return value && value.length > 0 ? value : 'en'
}

function fullDate(utcTimestamp: number, locale: string) {
  return formatRecordedAxisDate(utcTimestamp, locale, true)
}

export function OverviewRecordedFigure({
  visual,
  period,
  periodLabel,
  historyUnavailableMessage,
  onPeriodChange,
}: OverviewRecordedFigureProps) {
  const { i18n } = useTranslation('dashboard')
  const locale = chartLocale(i18n?.resolvedLanguage ?? i18n?.language)
  const [display, setDisplay] = useState<ChartDisplay>('line')
  const [selection, setSelection] = useState<{
    period: NetWorthPeriod
    point: SummaryPointSelection
  } | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotWidth, setPlotWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth
  )
  const rows =
    visual.kind === 'line' ? visual.points : visual.kind === 'point' ? [visual.point] : null
  const currency = visual.kind === 'line' || visual.kind === 'point' ? visual.currency : null
  const model =
    rows && currency
      ? buildRecordedBalanceModel(
          rows.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
          currency,
          {
            maxDateTicks: summaryDateTickBudget(plotWidth),
            includeZero: display === 'area' && visual.kind === 'line',
            locale,
          }
        )
      : null
  const showChart = isSeries(model)
  useLayoutEffect(() => {
    if (!showChart) return
    const element = plotRef.current
    const read = () => {
      const next = element?.clientWidth || window.innerWidth
      setPlotWidth((current) => (current === next ? current : next))
    }
    read()
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [showChart])
  const active =
    visual.kind === 'line' && selection?.period === period
      ? summaryPointSelection(visual.points, selection.point.index, selection.point.date)
      : null
  const points =
    visual.kind === 'line' ? visual.points : visual.kind === 'point' ? [visual.point] : []
  const canInspect = model !== null && model.status !== 'invalid' && model.status !== 'empty'

  return (
    <div className="min-w-0">
      {showChart ? (
        <RecordedSeriesChart
          model={model}
          locale={locale}
          periodLabel={periodLabel}
          display={display}
          active={active}
          plotRef={plotRef}
          tickBudget={summaryDateTickBudget(plotWidth)}
          onSelect={(point) => setSelection({ period, point })}
        />
      ) : null}

      <div className="px-4 pb-4 sm:px-6 sm:pb-6">
        {showChart ? <RecordedReadouts model={model} locale={locale} active={active} /> : null}

        {isFlat(model) && visual.kind === 'line' ? (
          <FlatRecordedFact model={model} locale={locale} periodLabel={periodLabel} />
        ) : null}

        {visual.kind === 'point' && isSingle(model) ? (
          <SingleRecordedFact model={model} locale={locale} periodLabel={periodLabel} />
        ) : null}

        {visual.kind === 'point' && model?.status !== 'single' ? (
          <PlainRecordedFact
            reason="one-snapshot"
            periodLabel={periodLabel}
            historyUnavailableMessage={historyUnavailableMessage}
          />
        ) : null}

        {visual.kind === 'line' && model && model.status !== 'series' && model.status !== 'flat' ? (
          <PlainRecordedFact
            reason="history-unavailable"
            periodLabel={periodLabel}
            historyUnavailableMessage={historyUnavailableMessage}
          />
        ) : null}

        {visual.kind === 'composition' ? (
          <CompositionFact composition={visual.composition} periodLabel={periodLabel} />
        ) : null}

        {visual.kind === 'plain' ? (
          <PlainRecordedFact
            reason={visual.reason}
            periodLabel={periodLabel}
            historyUnavailableMessage={historyUnavailableMessage}
          />
        ) : null}

        {isPlotted(model) ? (
          <RecordedMethodAndTable
            model={model}
            locale={locale}
            periodLabel={periodLabel}
            showMethod={model.status !== 'single'}
          />
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
          {showChart ? <ChartDisplayControl display={display} onChange={setDisplay} /> : null}
          <SummaryRangeControl period={period} onPeriodChange={onPeriodChange} />
          {canInspect && visual.kind === 'line' ? (
            <SummaryPointInspection
              points={points}
              active={active}
              readout={
                !showChart &&
                isPlotted(model) &&
                active &&
                model.points[active.index]?.date === active.date
                  ? {
                      date: active.date,
                      label: fullDate(model.points[active.index].utcTimestamp, locale),
                      amount: model.formatExact(model.points[active.index].amountCentavos),
                    }
                  : null
              }
              showReadout={!showChart}
              onSelect={(point) => setSelection({ period, point })}
              onClear={() => setSelection(null)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function RecordedSeriesChart({
  model,
  locale,
  periodLabel,
  display,
  active,
  plotRef,
  tickBudget,
  onSelect,
}: {
  model: SeriesModel
  locale: string
  periodLabel: string
  display: ChartDisplay
  active: SummaryPointSelection | null
  plotRef: RefObject<HTMLDivElement | null>
  tickBudget: 2 | 3 | 5
  onSelect: (selection: SummaryPointSelection) => void
}) {
  const { t } = useTranslation('dashboard')
  const start = model.points[0]
  const end = model.points[model.points.length - 1]
  const caption = t('overview.summaryCoverage', {
    currency: model.currency,
    start: fullDate(start.utcTimestamp, locale),
    end: fullDate(end.utcTimestamp, locale),
    count: model.points.length,
    period: periodLabel,
  })
  const chartData = model.points.map((point) => ({ ...point }))
  const selectPoint = (candidate: SummaryPointSelection) => {
    const valid = summaryPointSelection(
      model.points.map((point) => ({ date: point.date, netWorth: point.amountCentavos })),
      candidate.index,
      candidate.date
    )
    if (valid) onSelect(valid)
  }

  return (
    <figure className="min-w-0" aria-labelledby={RECORDED_CAPTION_ID}>
      <figcaption id={RECORDED_CAPTION_ID} className="px-4 pt-4 sm:px-6">
        <p className="text-foreground text-sm font-semibold">{t('overview.summaryChartTitle')}</p>
        <p className="text-muted-foreground mt-0.5 text-xs break-words">{caption}</p>
      </figcaption>
      <div
        ref={plotRef}
        className="mt-2 h-[292px] w-full min-w-0 px-0 sm:px-6"
        data-testid="overview-summary-plot-frame"
        data-chart-box={SUMMARY_CHART_BOX_PX}
        data-plot-inner={SUMMARY_PLOT_INNER_PX}
        data-max-date-ticks={model.dateTicks.length}
        data-tick-budget={tickBudget}
        data-include-zero={model.includeZero ? 'true' : 'false'}
        data-display={display}
        data-point-count={model.points.length}
      >
        <div className="h-full min-h-0" data-testid="overview-summary-recorded-line">
          <SafeChart>
            {display === 'area' ? (
              <AreaChart data={chartData} margin={CHART_MARGIN} accessibilityLayer={false}>
                <RecordedAxes model={model} locale={locale} />
                <RecordedTooltipBinding
                  model={model}
                  locale={locale}
                  name={t('overview.netWorth')}
                />
                <Area
                  type="linear"
                  dataKey="amountCentavos"
                  stroke={SERIES_STROKE}
                  strokeWidth={2}
                  fill={SERIES_STROKE}
                  fillOpacity={0.12}
                  baseValue={0}
                  connectNulls={false}
                  isAnimationActive={false}
                  activeDot={false}
                  dot={(dotProps) => (
                    <RecordedPointMark
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      payload={dotProps.payload}
                      selected={isSelected(active, dotProps.payload)}
                      onSelect={selectPoint}
                    />
                  )}
                />
              </AreaChart>
            ) : (
              <LineChart data={chartData} margin={CHART_MARGIN} accessibilityLayer={false}>
                <RecordedAxes model={model} locale={locale} />
                <RecordedTooltipBinding
                  model={model}
                  locale={locale}
                  name={t('overview.netWorth')}
                />
                <Line
                  type="linear"
                  dataKey="amountCentavos"
                  stroke={SERIES_STROKE}
                  strokeWidth={2}
                  fill="none"
                  connectNulls={false}
                  isAnimationActive={false}
                  activeDot={false}
                  dot={(dotProps) => (
                    <RecordedPointMark
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      payload={dotProps.payload}
                      selected={isSelected(active, dotProps.payload)}
                      onSelect={selectPoint}
                    />
                  )}
                />
              </LineChart>
            )}
          </SafeChart>
        </div>
      </div>
    </figure>
  )
}

function RecordedAxes({ model, locale }: { model: SeriesModel; locale: string }) {
  return (
    <>
      <CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} />
      <XAxis
        dataKey="utcTimestamp"
        type="number"
        scale="utc"
        domain={[model.xDomain[0], model.xDomain[1]]}
        ticks={[...model.dateTicks]}
        interval={0}
        minTickGap={0}
        height={SUMMARY_X_AXIS_HEIGHT}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-chart-axis)' }}
        padding={{ left: 0, right: 0 }}
        allowDataOverflow
        tick={(props) => (
          <RecordedDateTick
            x={props.x}
            y={props.y}
            index={props.index}
            visibleTicksCount={props.visibleTicksCount}
            value={Number(props.payload?.value)}
            locale={locale}
            formatDate={model.formatDate}
          />
        )}
      />
      <YAxis
        type="number"
        domain={[model.yDomain[0], model.yDomain[1]]}
        ticks={[...model.yTicks]}
        width={model.suggestedYWidth}
        interval={0}
        tickLine={false}
        axisLine={false}
        allowDataOverflow
        tick={(props) => (
          <RecordedMoneyTick
            x={props.x}
            y={props.y}
            value={Number(props.payload?.value)}
            formatAxis={model.formatAxis}
            formatExact={model.formatExact}
          />
        )}
      />
    </>
  )
}

function RecordedDateTick({
  x,
  y,
  index,
  visibleTicksCount,
  value,
  locale,
  formatDate,
}: {
  x?: number | string
  y?: number | string
  index?: number
  visibleTicksCount?: number
  value: number
  locale: string
  formatDate: (utcTimestamp: number) => string
}) {
  if (!Number.isFinite(value)) return <g />
  const last = (visibleTicksCount ?? 1) - 1
  const anchor = index === 0 ? 'start' : index === last ? 'end' : 'middle'
  const full = fullDate(value, locale)
  return (
    <text
      x={x}
      y={y}
      dy={14}
      textAnchor={anchor}
      data-anchor={anchor}
      fill={TICK_FILL}
      fontSize={12}
      data-full={full}
    >
      <title>{full}</title>
      {formatDate(value)}
    </text>
  )
}

function RecordedMoneyTick({
  x,
  y,
  value,
  formatAxis,
  formatExact,
}: {
  x?: number | string
  y?: number | string
  value: number
  formatAxis: (centavos: number) => string
  formatExact: (centavos: number) => string
}) {
  if (!Number.isFinite(value)) return <g />
  const full = formatExact(value)
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={TICK_FILL} fontSize={12} data-full={full}>
      <title>{full}</title>
      {formatAxis(value)}
    </text>
  )
}

function RecordedTooltipBinding({
  model,
  locale,
  name,
}: {
  model: SeriesModel
  locale: string
  name: string
}) {
  return (
    <Tooltip
      isAnimationActive={false}
      cursor={{ stroke: 'var(--color-border)' }}
      content={(props) => (
        <RecordedTooltip
          active={props.active}
          payload={props.payload}
          formatExact={model.formatExact}
          locale={locale}
          name={name}
        />
      )}
    />
  )
}

function RecordedTooltip({
  active,
  payload,
  formatExact,
  locale,
  name,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: RecordedBalancePoint }>
  formatExact: (centavos: number) => string
  locale: string
  name: string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point || !Number.isFinite(point.utcTimestamp)) return null
  if (!Number.isSafeInteger(point.amountCentavos)) return null
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <p className="recharts-tooltip-label" style={{ ...CHART_LABEL_STYLE, margin: 0 }}>
        {fullDate(point.utcTimestamp, locale)}
      </p>
      <p style={{ ...CHART_ITEM_STYLE, margin: '2px 0 0' }}>
        <span className="recharts-tooltip-item-name">{name}</span>
        <span className="recharts-tooltip-item-value">{formatExact(point.amountCentavos)}</span>
      </p>
    </div>
  )
}

function isSelected(active: SummaryPointSelection | null, payload: unknown) {
  if (!active || !payload || typeof payload !== 'object') return false
  const point = payload as Partial<RecordedBalancePoint>
  return point.sourceIndex === active.index && point.date === active.date
}

function RecordedPointMark({
  cx,
  cy,
  payload,
  selected,
  onSelect,
}: {
  cx?: number
  cy?: number
  payload?: RecordedBalancePoint
  selected: boolean
  onSelect: (selection: SummaryPointSelection) => void
}) {
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return <g />
  }
  if (!payload || typeof payload.sourceIndex !== 'number' || typeof payload.date !== 'string') {
    return <g />
  }
  return (
    <circle
      className="recharts-line-dot"
      cx={cx}
      cy={cy}
      r={selected ? 4.5 : 3}
      fill={SERIES_STROKE}
      stroke={selected ? 'var(--color-surface)' : 'none'}
      strokeWidth={selected ? 2 : 0}
      data-testid="overview-summary-chart-point"
      data-date={payload.date}
      data-index={String(payload.sourceIndex)}
      data-utc={String(payload.utcTimestamp)}
      data-selected={selected ? 'true' : 'false'}
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect({ index: payload.sourceIndex, date: payload.date })
      }}
    />
  )
}

function RecordedReadouts({
  model,
  locale,
  active,
}: {
  model: SeriesModel
  locale: string
  active: SummaryPointSelection | null
}) {
  const { t } = useTranslation('dashboard')
  const latest = model.points[model.points.length - 1]
  const selected = active ? model.points[active.index] : undefined
  const selectedMatches = selected?.date === active?.date
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2" data-testid="overview-summary-readouts">
      <div className="min-w-0" data-testid="overview-summary-latest">
        <span className="text-muted-foreground block text-xs">{t('overview.summaryLatest')}</span>
        <time dateTime={latest.date} className="text-foreground text-xs tabular-nums">
          {fullDate(latest.utcTimestamp, locale)}
        </time>
        <span className="text-foreground mt-0.5 block text-sm font-medium break-all tabular-nums">
          {model.formatExact(latest.amountCentavos)}
        </span>
      </div>
      <div className="min-w-0" data-testid="overview-summary-selected-readout">
        <span className="text-muted-foreground block text-xs">{t('overview.summarySelected')}</span>
        <div
          data-testid="overview-summary-inspection"
          aria-live="polite"
          aria-atomic="true"
          className="text-foreground min-w-0 text-xs leading-snug break-words"
        >
          {selectedMatches && selected && active ? (
            <>
              <time dateTime={selected.date} className="tabular-nums">
                {fullDate(selected.utcTimestamp, locale)}
              </time>
              <span className="mt-0.5 block text-sm font-medium break-all tabular-nums">
                {model.formatExact(selected.amountCentavos)}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FlatRecordedFact({
  model,
  locale,
  periodLabel,
}: {
  model: FlatModel
  locale: string
  periodLabel: string
}) {
  const { t } = useTranslation('dashboard')
  const start = model.points[0]
  const end = model.points[model.points.length - 1]
  return (
    <div className="pt-4" data-testid="overview-summary-flat">
      <p className="text-foreground text-sm font-semibold">{t('overview.summaryChartTitle')}</p>
      <p className="text-foreground mt-1 text-xs leading-snug break-words">
        <time dateTime={start.date} className="tabular-nums">
          {fullDate(start.utcTimestamp, locale)}
        </time>
        {start.date === end.date ? null : (
          <>
            <span aria-hidden="true"> – </span>
            <time dateTime={end.date} className="tabular-nums">
              {fullDate(end.utcTimestamp, locale)}
            </time>
          </>
        )}
        <span className="mt-0.5 block font-medium break-all tabular-nums">
          {model.formatExact(start.amountCentavos)}
        </span>
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-snug break-words">
        {t('overview.summaryUnchanged')}
      </p>
      <p className="text-muted-foreground mt-1 text-xs break-words">
        {t('overview.summaryCoverage', {
          currency: model.currency,
          start: fullDate(start.utcTimestamp, locale),
          end: fullDate(end.utcTimestamp, locale),
          count: model.points.length,
          period: periodLabel,
        })}
      </p>
    </div>
  )
}

function SingleRecordedFact({
  model,
  locale,
  periodLabel,
}: {
  model: SingleModel
  locale: string
  periodLabel: string
}) {
  const { t } = useTranslation('dashboard')
  const point = model.points[0]
  return (
    <div className="pt-4" data-testid="overview-summary-recorded-point">
      <p className="text-foreground text-sm font-semibold">{t('overview.summaryChartTitle')}</p>
      <p className="text-foreground mt-1 text-xs leading-snug break-words">
        <span
          data-testid="overview-summary-single-dot"
          className="me-1 inline-block size-2 rounded-full align-middle"
          style={{ backgroundColor: SERIES_STROKE }}
          aria-hidden="true"
        />
        <time dateTime={point.date} className="tabular-nums">
          {fullDate(point.utcTimestamp, locale)}
        </time>
        <span className="mt-0.5 block font-medium break-all tabular-nums">
          {model.formatExact(point.amountCentavos)}
        </span>
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-snug break-words">
        {t('overview.summaryOneSnapshot')}
      </p>
      <p className="text-muted-foreground mt-1 text-xs break-words">
        {t('overview.summaryCoverage', {
          currency: model.currency,
          start: fullDate(point.utcTimestamp, locale),
          end: fullDate(point.utcTimestamp, locale),
          count: 1,
          period: periodLabel,
        })}
      </p>
    </div>
  )
}

function PlainRecordedFact({
  reason,
  periodLabel,
  historyUnavailableMessage,
}: {
  reason: SummaryPlainReason
  periodLabel: string
  historyUnavailableMessage?: string
}) {
  const { t } = useTranslation('dashboard')
  const message =
    reason === 'history-loading'
      ? t('overview.summaryHistoryLoading', { range: periodLabel })
      : t(PLAIN_MESSAGE[reason])
  return (
    <div className="pt-4">
      <p
        data-testid="overview-summary-plain"
        data-reason={reason}
        role="status"
        aria-busy={reason === 'history-loading' ? true : undefined}
        className="text-muted-foreground max-w-prose text-xs leading-snug break-words"
      >
        {message}
        {reason === 'history-unavailable' && historyUnavailableMessage
          ? ` · ${historyUnavailableMessage}`
          : ''}
      </p>
      {reason === 'history-loading' ? null : (
        <p
          data-testid="overview-summary-range-context"
          className="text-muted-foreground mt-1 text-xs leading-snug break-words"
        >
          {periodLabel}
        </p>
      )}
    </div>
  )
}

function CompositionFact({
  composition,
  periodLabel,
}: {
  composition: SummaryComposition
  periodLabel: string
}) {
  const { t } = useTranslation('dashboard')
  const caption = t('overview.summaryComposition', { currency: composition.currency })
  const liabilityLine =
    composition.liabilities > 0
      ? t('overview.summaryLiabilities', {
          amount: formatMoney(composition.liabilities, composition.currency),
        })
      : null
  return (
    <div className="pt-4">
      <div
        data-testid="overview-summary-composition"
        role="img"
        aria-labelledby={COMPOSITION_CAPTION_ID}
        aria-describedby={COMPOSITION_TABLE_ID}
      >
        {composition.segments.length > 0 ? (
          <div className="flex h-2 w-full min-w-0 overflow-hidden rounded-full" aria-hidden="true">
            {composition.segments.map((segment, index) => (
              <span
                key={segment.id}
                data-testid="composition-segment"
                data-segment={segment.id}
                data-kind={segment.kind}
                title={`${segment.kind === 'holdings' ? t('overview.summaryHoldings') : segment.name} ${formatMoney(segment.amount, composition.currency)}`}
                className="h-full"
                style={{
                  flexGrow: segment.amount,
                  flexBasis: 0,
                  backgroundColor: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
                }}
              />
            ))}
          </div>
        ) : liabilityLine ? (
          <p className="text-muted-foreground text-xs leading-snug break-words tabular-nums">
            {liabilityLine}
          </p>
        ) : null}
      </div>
      <p
        data-testid="overview-summary-range-context"
        className="text-muted-foreground mt-2 text-xs leading-snug break-words"
      >
        {t('overview.summaryRangeEmpty', { range: periodLabel })}
      </p>
      <p
        id={COMPOSITION_CAPTION_ID}
        className="text-muted-foreground mt-1 text-xs leading-snug break-words"
      >
        {caption}
      </p>
      {composition.segments.length > 0 && liabilityLine ? (
        <p className="text-muted-foreground mt-1 text-xs leading-snug break-words tabular-nums">
          {liabilityLine}
        </p>
      ) : null}
      <div className="sr-only">
        <table id={COMPOSITION_TABLE_ID}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('overview.summarySegment')}</th>
              <th scope="col">{t('overview.summaryAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {composition.segments.map((segment) => (
              <tr key={segment.id}>
                <th scope="row">
                  {segment.kind === 'holdings' ? t('overview.summaryHoldings') : segment.name}
                </th>
                <td>{formatMoney(segment.amount, composition.currency)}</td>
              </tr>
            ))}
            {composition.totalAssets > 0 ? (
              <tr>
                <th scope="row">{t('overview.summaryAssets')}</th>
                <td>{formatMoney(composition.totalAssets, composition.currency)}</td>
              </tr>
            ) : null}
            {composition.liabilities > 0 ? (
              <tr>
                <th scope="row">{t('overview.summaryLiabilitiesLabel')}</th>
                <td>{formatMoney(composition.liabilities, composition.currency)}</td>
              </tr>
            ) : null}
            <tr>
              <th scope="row">{t('overview.netWorth')}</th>
              <td>{formatMoney(composition.netWorth, composition.currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RecordedMethodAndTable({
  model,
  locale,
  periodLabel,
  showMethod,
}: {
  model: PlottedModel
  locale: string
  periodLabel: string
  showMethod: boolean
}) {
  const { t } = useTranslation('dashboard')
  const start = model.points[0]
  const end = model.points[model.points.length - 1]
  const caption = t('overview.summaryCoverage', {
    currency: model.currency,
    start: fullDate(start.utcTimestamp, locale),
    end: fullDate(end.utcTimestamp, locale),
    count: model.points.length,
    period: periodLabel,
  })
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {showMethod ? (
        <details>
          <summary className={DISCLOSURE}>{t('overview.summaryMethodLabel')}</summary>
          <p className="text-muted-foreground mt-1 max-w-prose text-xs leading-snug">
            {t('overview.summaryMethod')}
          </p>
        </details>
      ) : null}
      <details>
        <summary className={DISCLOSURE}>{t('overview.viewChartData')}</summary>
        <div className="max-w-full overflow-x-auto">
          <table id={RECORDED_TABLE_ID} className="mt-2 text-xs">
            <caption className="text-muted-foreground py-1 text-left">{caption}</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-6 text-left font-medium">
                  {t('overview.summaryDate')}
                </th>
                <th scope="col" className="text-left font-medium">
                  {t('overview.netWorth')}
                </th>
              </tr>
            </thead>
            <tbody>
              {model.points.map((point) => (
                <tr key={`${point.date}-${point.sourceIndex}`}>
                  <th scope="row" className="py-0.5 pr-6 text-left font-normal">
                    <time dateTime={point.date}>{fullDate(point.utcTimestamp, locale)}</time>
                  </th>
                  <td className="tabular-nums">{model.formatExact(point.amountCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function ChartDisplayControl({
  display,
  onChange,
}: {
  display: ChartDisplay
  onChange: (display: ChartDisplay) => void
}) {
  const { t } = useTranslation('dashboard')
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" data-testid="overview-summary-display">
      <button
        type="button"
        className={FOOTER_CONTROL}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t('overview.summaryDisplay.label')}
        onClick={() => setOpen((current) => !current)}
      >
        {t(`overview.summaryDisplay.${display}`)}
      </button>
      {open ? (
        <div className="border-border bg-surface absolute end-0 bottom-full z-10 mb-1 min-w-24 rounded-md border p-1">
          {(['line', 'area'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={display === item}
              className={cn(FOOTER_CONTROL, 'w-full border-0')}
              onClick={() => {
                onChange(item)
                setOpen(false)
              }}
            >
              {t(`overview.summaryDisplay.${item}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const SUMMARY_RANGES = [
  'month',
  '3m',
  '6m',
  '1y',
  'all',
] as const satisfies readonly NetWorthPeriod[]

function SummaryRangeControl({
  period,
  onPeriodChange,
}: {
  period: NetWorthPeriod
  onPeriodChange: (period: NetWorthPeriod) => void
}) {
  const { t } = useTranslation('dashboard')
  return (
    <div
      className="flex max-w-full flex-wrap items-center justify-end gap-1 motion-reduce:transition-none"
      role="group"
      aria-label={t('overview.summaryRange.label')}
      data-testid="overview-summary-range"
    >
      {SUMMARY_RANGES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={period === item}
          aria-label={t(`overview.summaryRange.names.${item}`)}
          onClick={() => onPeriodChange(item)}
          className={cn(
            FOOTER_CONTROL,
            period === item
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span aria-hidden="true">{t(`overview.summaryRange.labels.${item}`)}</span>
        </button>
      ))}
      {(SUMMARY_RANGES as readonly string[]).includes(period) ? null : (
        <span className="text-muted-foreground px-2 text-xs">{t(`overview.period.${period}`)}</span>
      )}
    </div>
  )
}

function SummaryPointInspection({
  points,
  active,
  readout,
  showReadout,
  onSelect,
  onClear,
}: {
  points: readonly SummaryHistoryPoint[]
  active: SummaryPointSelection | null
  readout: { date: string; label: string; amount: string } | null
  showReadout: boolean
  onSelect: (selection: SummaryPointSelection) => void
  onClear: () => void
}) {
  const { t } = useTranslation('dashboard')
  const activePoint = active ? points[active.index] : undefined
  const atStart = active?.index === 0
  const atEnd = active !== null && active.index === points.length - 1
  const move = (direction: -1 | 1) => {
    const next = stepSummarySelection(points, active, direction)
    if (next && (next.index !== active?.index || next.date !== active?.date)) onSelect(next)
  }
  return (
    <div
      className="flex max-w-full flex-wrap items-center justify-end gap-1 motion-reduce:transition-none"
      role="group"
      aria-label={t('overview.summaryInspect.label')}
      data-testid="overview-summary-inspect"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onClear()
        }
      }}
    >
      <button
        type="button"
        className={cn(
          FOOTER_CONTROL,
          'text-muted-foreground hover:text-foreground',
          atStart && 'opacity-50'
        )}
        aria-label={t('overview.summaryInspect.previous')}
        aria-disabled={atStart || undefined}
        onClick={() => {
          if (!atStart) move(-1)
        }}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={cn(
          FOOTER_CONTROL,
          'text-muted-foreground hover:text-foreground',
          atEnd && 'opacity-50'
        )}
        aria-label={t('overview.summaryInspect.next')}
        aria-disabled={atEnd || undefined}
        onClick={() => {
          if (!atEnd) move(1)
        }}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
      {active && activePoint ? (
        <button
          type="button"
          className={cn(FOOTER_CONTROL, 'text-muted-foreground hover:text-foreground')}
          aria-label={t('overview.summaryInspect.clear')}
          onClick={onClear}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {showReadout ? (
        <p
          data-testid="overview-summary-inspection"
          aria-live="polite"
          aria-atomic="true"
          className="text-foreground min-w-0 text-xs leading-snug break-words"
        >
          {readout ? (
            <>
              <time dateTime={readout.date} className="tabular-nums">
                {readout.label}
              </time>
              <span className="mt-0.5 block font-medium break-all tabular-nums">
                {readout.amount}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
