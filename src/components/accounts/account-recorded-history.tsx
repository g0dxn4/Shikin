import { useEffect, useId, useLayoutEffect, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import {
  buildRecordedBalanceModel,
  type RecordedBalanceDateTicks,
  type RecordedBalanceModel,
  type RecordedBalancePoint,
} from '@/components/charts/recorded-balance-model'
import {
  accountHistoryMaxDateTicks,
  type AccountHistoryPoint,
} from '@/components/accounts/account-history-batch'
import { CHART_TOOLTIP_STYLE } from '@/lib/constants'
import { cn } from '@/lib/utils'

const CHART_BOX_PX = 300
const AXIS_BAND_PX = 36
const PLOT_MARGIN_TOP = 16
const STROKE = 'var(--color-chart-1)'
const TICK_FILL = 'var(--color-foreground)'
const GRID = 'var(--color-chart-grid)'

type ChartStyle = 'line' | 'area'
type HistoryStatus = 'loading' | 'ready' | 'error'

type ChartRow = {
  date: string
  amountCentavos: number
  utcTimestamp: number
  sourceIndex: number
}

function formatUtcLong(isoDate: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(Date.UTC(year, month - 1, day))
  } catch {
    return isoDate
  }
}

function usePlotWidth(override: number | undefined) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [measured, setMeasured] = useState(0)

  useEffect(() => {
    if (override !== undefined || !node) return
    const measure = () => setMeasured(node.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, override])

  return { setNode, node, width: override ?? measured }
}

function domainIncludesZero(domain: readonly [number, number] | null): boolean {
  return domain !== null && domain[0] <= 0 && domain[1] >= 0
}

function readSourceIndex(
  state: { activeTooltipIndex?: unknown; activeIndex?: unknown },
  points: readonly RecordedBalancePoint[]
): number | null {
  const raw = state.activeTooltipIndex ?? state.activeIndex
  const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  if (!Number.isInteger(index) || index < 0 || index >= points.length) return null
  return points[index]?.sourceIndex ?? null
}

function DateAxisTick({
  x,
  y,
  index,
  visibleTicksCount,
  labels,
}: {
  x?: number | string
  y?: number | string
  index?: number
  visibleTicksCount?: number
  labels: readonly string[]
}) {
  if (typeof x !== 'number' || typeof y !== 'number') return <g />
  const tickIndex = index ?? 0
  const last = Math.max(0, (visibleTicksCount ?? labels.length) - 1)
  const anchor = tickIndex <= 0 ? 'start' : tickIndex >= last ? 'end' : 'middle'
  return (
    <text
      x={x}
      y={y}
      dy={14}
      textAnchor={anchor}
      fill={TICK_FILL}
      fontSize={12}
      data-history-x-tick=""
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {labels[tickIndex] ?? ''}
    </text>
  )
}

function MoneyAxisTick({
  x,
  y,
  payload,
  format,
}: {
  x?: number | string
  y?: number | string
  payload?: { value?: unknown }
  format: (centavos: number) => string
}) {
  if (typeof x !== 'number' || typeof y !== 'number') return <g />
  const value = typeof payload?.value === 'number' ? payload.value : Number(payload?.value)
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fill={TICK_FILL}
      fontSize={12}
      data-history-y-tick=""
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {Number.isFinite(value) ? format(value) : ''}
    </text>
  )
}

function HistoryTooltip({
  active,
  payload,
  currency,
  locale,
  formatExact,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: Partial<ChartRow> }>
  currency: string
  locale: string
  formatExact: (centavos: number) => string
}) {
  const point = payload?.[0]?.payload
  if (
    !active ||
    !point ||
    typeof point.date !== 'string' ||
    typeof point.amountCentavos !== 'number'
  ) {
    return null
  }
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <p className="m-0 text-xs">
        <time dateTime={point.date}>{formatUtcLong(point.date, locale)}</time>
        {' · '}
        {currency}
      </p>
      <p className="m-0 mt-1 text-xs font-medium tabular-nums">
        {formatExact(point.amountCentavos)} {currency}
      </p>
    </div>
  )
}

function RecordedDot({
  cx,
  cy,
  payload,
  selectedIndex,
  onSelect,
}: {
  cx?: number
  cy?: number
  payload?: { sourceIndex?: number }
  selectedIndex: number | null
  onSelect: (sourceIndex: number) => void
}) {
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    typeof payload?.sourceIndex !== 'number'
  ) {
    return <g />
  }
  const selected = payload.sourceIndex === selectedIndex
  return (
    <circle
      cx={cx}
      cy={cy}
      r={selected ? 4.5 : 3}
      fill={STROKE}
      stroke="var(--color-surface)"
      strokeWidth={selected ? 2 : 1}
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(payload.sourceIndex!)
      }}
    />
  )
}

export function AccountRecordedHistory({
  accountName,
  points,
  currency,
  windowStart,
  status,
  locale,
  showExact,
  plotWidth,
}: {
  accountName: string
  points: readonly AccountHistoryPoint[]
  currency: string
  windowStart: string | null
  status: HistoryStatus
  locale: string
  showExact: boolean
  plotWidth?: number
}) {
  const { t } = useTranslation('accounts')
  const titleId = useId()
  const captionId = useId()
  const { setNode, node, width } = usePlotWidth(plotWidth)
  const [style, setStyle] = useState<ChartStyle>('line')
  const pointsKey = points.map((point) => `${point.date}:${point.balance}`).join('|')
  const datasetKey = `${pointsKey}|${currency}|${windowStart ?? ''}`
  const [dataset, setDataset] = useState({
    key: datasetKey,
    tickCap: null as RecordedBalanceDateTicks | null,
    inspected: null as number | null,
  })
  if (dataset.key !== datasetKey) {
    setDataset({ key: datasetKey, tickCap: null, inspected: null })
  }
  const tickCap = dataset.key === datasetKey ? dataset.tickCap : null
  const inspected = dataset.key === datasetKey ? dataset.inspected : null
  const setInspected = (index: number) => {
    setDataset((current) =>
      current.key === datasetKey ? { ...current, inspected: index } : current
    )
  }

  const measuredTicks = accountHistoryMaxDateTicks(width)
  const maxDateTicks = tickCap ?? measuredTicks
  const canRead = status !== 'error' && windowStart !== null
  const model: RecordedBalanceModel | null = canRead
    ? buildRecordedBalanceModel(
        points.map((point) => ({ date: point.date, amountCentavos: point.balance })),
        currency,
        {
          maxDateTicks,
          includeZero: style === 'area',
          locale,
        }
      )
    : null

  useLayoutEffect(() => {
    if (!node || maxDateTicks <= 2) return
    const boxes = [...node.querySelectorAll('[data-history-x-tick]')]
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0)
    const overlap = boxes.some((box, index) => index > 0 && box.left < boxes[index - 1].right - 0.5)
    if (!overlap) return
    const next = maxDateTicks === 5 ? 3 : 2
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setDataset((current) =>
        current.key === datasetKey && current.tickCap !== next
          ? { ...current, tickCap: next }
          : current
      )
    })
    return () => {
      cancelled = true
    }
  }, [datasetKey, maxDateTicks, node, style, width])

  const plotted = model && model.status !== 'invalid' && model.status !== 'empty' ? model : null
  const showChart = plotted?.status === 'series'
  const zeroInDomain = domainIncludesZero(plotted?.yDomain ?? null)
  const chartRows: ChartRow[] = plotted
    ? plotted.points.map((point) => ({
        date: point.date,
        amountCentavos: point.amountCentavos,
        utcTimestamp: point.utcTimestamp,
        sourceIndex: point.sourceIndex,
      }))
    : []
  const latest = plotted?.points[plotted.points.length - 1] ?? null
  const selected =
    inspected === null
      ? null
      : (plotted?.points.find((point) => point.sourceIndex === inspected) ?? null)
  const cursor = selected ?? latest
  const cursorPos =
    cursor === null
      ? -1
      : (plotted?.points.findIndex((point) => point.sourceIndex === cursor.sourceIndex) ?? -1)
  const canStep = (plotted?.points.length ?? 0) > 1
  const canPrev = canStep && cursorPos > 0
  const canNext =
    canStep && selected !== null && cursorPos >= 0 && cursorPos < (plotted?.points.length ?? 0) - 1

  const step = (direction: -1 | 1) => {
    if (!plotted || plotted.points.length < 2) return
    const origin = cursorPos >= 0 ? cursorPos : plotted.points.length - 1
    const next = plotted.points[origin + direction]
    if (!next) return
    setInspected(next.sourceIndex)
  }

  const onInspectKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    step(event.key === 'ArrowLeft' ? -1 : 1)
  }

  const yWidth = plotted ? plotted.suggestedYWidth + 8 : 64
  const controlClass = 'h-11 min-h-11 min-w-11 px-3 text-xs md:h-8 md:min-h-8 md:min-w-8 md:px-2.5'

  let fact: string | null = null
  if (status === 'error') {
    fact = t('history.slotUnavailable')
  } else if (model?.status === 'invalid') {
    fact = t('history.invalid')
  } else if (status === 'loading' && !canRead) {
    fact = t('history.loading')
  } else if (model?.status === 'empty') {
    fact = t('history.slotEmpty')
  } else if (model?.status === 'single' && latest) {
    fact = t('history.single', {
      date: latest.date,
      amount: model.formatExact(latest.amountCentavos),
      currency: model.currency,
    })
  } else if (model?.status === 'flat' && latest && plotted) {
    fact = t('history.flat', {
      amount: model.formatExact(latest.amountCentavos),
      currency: model.currency,
      start: plotted.points[0]?.date,
      end: latest.date,
      count: plotted.points.length,
    })
  }

  const axes = plotted ? (
    <>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis
        dataKey="utcTimestamp"
        type="number"
        scale="utc"
        domain={[plotted.xDomain[0], plotted.xDomain[1]]}
        ticks={[...plotted.dateTicks]}
        interval={0}
        minTickGap={0}
        allowDataOverflow
        padding={{ left: 0, right: 0 }}
        height={AXIS_BAND_PX}
        axisLine={{ stroke: 'var(--color-border)' }}
        tickLine={false}
        tick={(props) => (
          <DateAxisTick
            x={props.x}
            y={props.y}
            index={props.index}
            visibleTicksCount={props.visibleTicksCount}
            labels={plotted.dateTickLabels}
          />
        )}
      />
      <YAxis
        dataKey="amountCentavos"
        type="number"
        domain={[plotted.yDomain[0], plotted.yDomain[1]]}
        ticks={[...plotted.yTicks]}
        width={yWidth}
        allowDataOverflow
        axisLine={{ stroke: 'var(--color-border)' }}
        tickLine={false}
        tick={(props) => (
          <MoneyAxisTick
            x={props.x}
            y={props.y}
            payload={props.payload}
            format={plotted.formatAxis}
          />
        )}
      />
      <Tooltip
        content={(props) => (
          <HistoryTooltip
            active={props.active}
            payload={props.payload}
            currency={plotted.currency}
            locale={locale}
            formatExact={plotted.formatExact}
          />
        )}
        isAnimationActive={false}
      />
      {zeroInDomain ? (
        <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1} ifOverflow="discard" />
      ) : null}
    </>
  ) : null

  const seriesProps = {
    data: chartRows,
    margin: { top: PLOT_MARGIN_TOP, right: 4, bottom: 0, left: 4 },
    accessibilityLayer: false as const,
    onClick: (state: { activeTooltipIndex?: unknown; activeIndex?: unknown }) => {
      if (!plotted) return
      const sourceIndex = readSourceIndex(state, plotted.points)
      if (sourceIndex !== null) setInspected(sourceIndex)
    },
  }

  return (
    <div
      className="mt-4 min-w-0"
      data-account-history=""
      data-history-status={status}
      data-window-start={windowStart ?? ''}
      data-currency={currency}
      data-model-status={model?.status ?? 'gated'}
      data-point-count={plotted?.points.length ?? 0}
      data-balances={plotted ? plotted.points.map((point) => point.amountCentavos).join(',') : ''}
      data-source-indexes={
        plotted ? plotted.points.map((point) => point.sourceIndex).join(',') : ''
      }
      data-chart-style={showChart ? style : ''}
      data-include-zero={plotted?.includeZero ? 'true' : 'false'}
      data-max-date-ticks={maxDateTicks}
      data-plot-width={width}
      data-x-scale={showChart ? 'utc' : ''}
      data-x-key={showChart ? 'utcTimestamp' : ''}
      data-x-domain={plotted ? plotted.xDomain.join(',') : ''}
      data-date-ticks={plotted ? plotted.dateTicks.join(',') : ''}
      data-y-domain={plotted ? plotted.yDomain.join(',') : ''}
      data-y-ticks={plotted ? plotted.yTicks.join(',') : ''}
      data-y-labels={plotted ? plotted.yTickLabels.join('|') : ''}
      data-y-width={plotted ? yWidth : ''}
      data-zero-in-domain={zeroInDomain ? 'true' : 'false'}
      data-selected-index={selected?.sourceIndex ?? ''}
    >
      <figure className="min-w-0" aria-labelledby={titleId}>
        <figcaption id={titleId} className="text-foreground text-sm font-medium">
          {t('history.title')}
        </figcaption>
        {windowStart && canRead ? (
          <p id={captionId} className="text-muted-foreground mt-1 text-xs" data-history-caption="">
            {t('history.coverageLead', { currency })}{' '}
            <time dateTime={windowStart}>{windowStart}</time>
            {plotted ? (
              <>
                {' · '}
                <span data-history-count="">{plotted.points.length}</span>
                {' · '}
                <time dateTime={plotted.points[0]?.date} data-history-start="">
                  {plotted.points[0]?.date}
                </time>
                {' – '}
                <time dateTime={latest?.date} data-history-end="">
                  {latest?.date}
                </time>
              </>
            ) : null}
          </p>
        ) : null}
        {fact ? <p className="text-muted-foreground mt-2 text-sm">{fact}</p> : null}
        {showChart && plotted ? (
          <div
            ref={setNode}
            className="-mx-4 mt-3 h-[300px] min-w-0 sm:-mx-5"
            data-account-history-plot=""
            data-chart-box={CHART_BOX_PX}
            role="img"
            aria-label={`${t('history.title')} ${accountName}`}
            aria-describedby={windowStart ? captionId : undefined}
          >
            <span className="sr-only">
              {plotted.points
                .map(
                  (point) =>
                    `${point.date}: ${plotted.formatExact(point.amountCentavos)} ${plotted.currency}`
                )
                .join('; ')}
            </span>
            <SafeChart>
              {style === 'area' ? (
                <AreaChart {...seriesProps}>
                  {axes}
                  <Area
                    type="linear"
                    dataKey="amountCentavos"
                    stroke={STROKE}
                    strokeWidth={2}
                    fill={STROKE}
                    fillOpacity={0.14}
                    baseValue={0}
                    dot={(props) => (
                      <RecordedDot
                        cx={props.cx}
                        cy={props.cy}
                        payload={props.payload}
                        selectedIndex={inspected}
                        onSelect={setInspected}
                      />
                    )}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </AreaChart>
              ) : (
                <LineChart {...seriesProps}>
                  {axes}
                  <Line
                    type="linear"
                    dataKey="amountCentavos"
                    stroke={STROKE}
                    strokeWidth={2}
                    dot={(props) => (
                      <RecordedDot
                        cx={props.cx}
                        cy={props.cy}
                        payload={props.payload}
                        selectedIndex={inspected}
                        onSelect={setInspected}
                      />
                    )}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </LineChart>
              )}
            </SafeChart>
          </div>
        ) : null}
        {latest && plotted && model && model.status !== 'invalid' ? (
          <dl className="mt-2 grid gap-1 text-xs">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <dt className="text-muted-foreground">{t('history.latest')}</dt>
              <dd className="min-w-0 text-right tabular-nums" data-history-latest="">
                <time dateTime={latest.date}>{formatUtcLong(latest.date, locale)}</time>
                {' · '}
                {model.formatExact(latest.amountCentavos)} {model.currency}
              </dd>
            </div>
            {selected ? (
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">{t('history.selected')}</dt>
                <dd
                  className="min-w-0 text-right tabular-nums"
                  data-history-selected=""
                  data-source-index={selected.sourceIndex}
                  aria-live="polite"
                >
                  <time dateTime={selected.date}>{formatUtcLong(selected.date, locale)}</time>
                  {' · '}
                  {model.formatExact(selected.amountCentavos)} {model.currency}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {canStep ? (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
            {showChart ? (
              <div role="group" aria-label={t('history.display')} className="flex w-fit gap-1">
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={style === 'line'}
                  className={cn(controlClass, style === 'line' && 'border-foreground')}
                  onClick={() => setStyle('line')}
                >
                  {t('history.line')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={style === 'area'}
                  className={cn(controlClass, style === 'area' && 'border-foreground')}
                  onClick={() => setStyle('area')}
                >
                  {t('history.area')}
                </Button>
              </div>
            ) : null}
            <div
              role="group"
              aria-label={t('history.inspection')}
              className="flex w-fit gap-1"
              onKeyDown={onInspectKey}
            >
              <Button
                type="button"
                variant="outline"
                className={controlClass}
                aria-label={t('history.previous', { name: accountName })}
                disabled={!canPrev}
                onClick={() => step(-1)}
              >
                {t('history.prev')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={controlClass}
                aria-label={t('history.next', { name: accountName })}
                disabled={!canNext}
                onClick={() => step(1)}
              >
                {t('history.nextLabel')}
              </Button>
            </div>
          </div>
        ) : null}
      </figure>
      {showExact ? (
        <div className="border-border mt-3 min-w-0 border-t pt-3">
          {status === 'loading' && !plotted ? (
            <p className="text-muted-foreground text-xs">{t('history.loading')}</p>
          ) : status === 'error' ? (
            <p className="text-muted-foreground text-xs">{t('history.slotUnavailable')}</p>
          ) : model?.status === 'invalid' ? (
            <p className="text-muted-foreground text-xs">{t('history.invalid')}</p>
          ) : plotted ? (
            <>
              <p className="text-muted-foreground text-xs">{t('history.method')}</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-0 text-left text-xs">
                  <caption className="sr-only">
                    {t('history.exactCaption', { currency: plotted.currency })}
                  </caption>
                  <thead>
                    <tr className="text-muted-foreground border-border border-b">
                      <th scope="col" className="py-1 pr-3 font-medium">
                        {t('history.date')}
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        {t('history.amount')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {plotted.points.map((point) => (
                      <tr
                        key={point.sourceIndex}
                        data-source-index={point.sourceIndex}
                        data-selected={point.sourceIndex === inspected ? 'true' : 'false'}
                        className={point.sourceIndex === inspected ? 'bg-muted/60' : undefined}
                      >
                        <td className="py-1 pr-3">
                          <time dateTime={point.date}>{point.date}</time>
                        </td>
                        <td className="py-1 text-right whitespace-nowrap tabular-nums">
                          {plotted.formatExact(point.amountCentavos)} {plotted.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">{t('history.none')}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
