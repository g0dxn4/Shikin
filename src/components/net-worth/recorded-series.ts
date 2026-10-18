export const RECORDED_CHART_STYLES = ['line', 'area', 'bars'] as const

export type RecordedChartStyle = (typeof RECORDED_CHART_STYLES)[number]

export type RecordedSeriesKey = 'netWorth' | 'assets' | 'liabilities'

export interface RecordedNetWorthPoint {
  date: string
  netWorth: number
  assets: number
  liabilities: number
}

export interface RecordedSeriesVisual {
  stroke: string
  fill: string
  strokeWidth: number
  strokeOpacity: number
  strokeDasharray?: string
  /** Neutral solid wash for the net-worth area only. Not a gradient. */
  areaFillOpacity: number
  barFillOpacity: number
}

/** Minimum horizontal slot so grouped bars stay readable. Dates are not aggregated. */
export const RECORDED_BAR_SLOT_PX = 64

export const RECORDED_AREA_FILL_OPACITY = 0.16

export function isSafeRecordedPoint(point: RecordedNetWorthPoint): boolean {
  return (
    Number.isSafeInteger(point.netWorth) &&
    Number.isSafeInteger(point.assets) &&
    Number.isSafeInteger(point.liabilities)
  )
}

export function recordedBarPlotMinWidth(pointCount: number): number {
  if (!Number.isInteger(pointCount) || pointCount < 1) return 0
  return pointCount * RECORDED_BAR_SLOT_PX
}

/**
 * Visual treatment only. Chart values stay the recorded centavo fields.
 * Default keeps the faint same-family comparison; compare uses chart-2 / chart-5.
 */
export function recordedSeriesVisual(
  key: RecordedSeriesKey,
  compare: boolean
): RecordedSeriesVisual {
  if (key === 'netWorth') {
    return {
      stroke: 'var(--color-chart-1)',
      fill: 'var(--color-chart-1)',
      strokeWidth: 2,
      strokeOpacity: 1,
      areaFillOpacity: RECORDED_AREA_FILL_OPACITY,
      barFillOpacity: 1,
    }
  }
  if (key === 'assets') {
    return compare
      ? {
          stroke: 'var(--color-chart-2)',
          fill: 'var(--color-chart-2)',
          strokeWidth: 1.75,
          strokeOpacity: 1,
          areaFillOpacity: 0,
          barFillOpacity: 1,
        }
      : {
          stroke: 'var(--color-chart-3)',
          fill: 'var(--color-chart-3)',
          strokeWidth: 1,
          strokeOpacity: 0.45,
          areaFillOpacity: 0,
          barFillOpacity: 0.45,
        }
  }
  return compare
    ? {
        stroke: 'var(--color-chart-5)',
        fill: 'var(--color-chart-5)',
        strokeWidth: 1.75,
        strokeOpacity: 1,
        strokeDasharray: '3 3',
        areaFillOpacity: 0,
        barFillOpacity: 1,
      }
    : {
        stroke: 'var(--color-chart-3)',
        fill: 'var(--color-chart-3)',
        strokeWidth: 1,
        strokeOpacity: 0.28,
        strokeDasharray: '3 3',
        areaFillOpacity: 0,
        barFillOpacity: 0.28,
      }
}
