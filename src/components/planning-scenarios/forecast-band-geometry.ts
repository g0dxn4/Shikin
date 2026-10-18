/**
 * View-only scale for the forecast plot.
 * Does not append points, change forecastProjectionRows, or alter service values.
 * Amounts stay in centavos; padding is a display domain, not a balance.
 */

export interface ForecastBandPoint {
  projected: number
  optimistic: number
  pessimistic: number
}

export interface ForecastBandGeometry {
  /** Padded [min, max] that contains every plotted value. */
  domain: [number, number]
  /** True when any series value is zero or negative, so the axis must show 0. */
  includesZero: boolean
  /** True when projected, optimistic, and pessimistic are all the same number. */
  flat: boolean
}

/** Movement smaller than this fraction of the series magnitude must not fill the plot. */
const RELATIVE_SPAN_FLOOR = 0.015
/** Breathing room so a real slope is not pinned to the frame. */
const EDGE_PADDING = 0.12
/** Display-only half-span, in centavos, when every value is exactly zero. */
const ZERO_SERIES_HALF_SPAN = 100

function extent(values: readonly number[]): { min: number; max: number } {
  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

/** Inclusive interval between the two outer series. Does not reorder stored fields. */
export function forecastUncertaintyBand(point: ForecastBandPoint): [number, number] {
  return [
    Math.min(point.pessimistic, point.optimistic),
    Math.max(point.pessimistic, point.optimistic),
  ]
}

/**
 * Padded Y domain from the existing projected / optimistic / pessimistic values.
 * Includes 0 when any value is non-positive. A flat line stays centered, and a
 * one-centavo wiggle on a large balance cannot become a full-height slope.
 */
export function forecastBandGeometry(
  points: readonly ForecastBandPoint[]
): ForecastBandGeometry | null {
  if (points.length === 0) return null

  const values: number[] = []
  for (const point of points) {
    values.push(point.projected, point.optimistic, point.pessimistic)
  }
  if (values.some((value) => !Number.isFinite(value))) return null

  const data = extent(values)
  const includesZero = values.some((value) => value <= 0)
  const flat = values.every((value) => value === values[0])

  let low = data.min
  let high = data.max
  if (includesZero) {
    low = Math.min(low, 0)
    high = Math.max(high, 0)
  }

  const magnitude = Math.max(Math.abs(low), Math.abs(high), Math.abs((low + high) / 2))
  const floorSpan = magnitude === 0 ? ZERO_SERIES_HALF_SPAN * 2 : magnitude * RELATIVE_SPAN_FLOOR
  const effectiveSpan = Math.max(high - low, floorSpan)
  const mid = (low + high) / 2
  const pad = effectiveSpan * EDGE_PADDING

  let domainMin = mid - effectiveSpan / 2 - pad
  let domainMax = mid + effectiveSpan / 2 + pad

  // Padding must not invent a zero baseline for an all-positive series.
  if (!includesZero && domainMin <= 0) {
    const headroom = Math.max(data.min * EDGE_PADDING, 1)
    domainMin = data.min - headroom
    if (domainMin <= 0) domainMin = data.min / 2
  }

  domainMin = Math.min(domainMin, data.min)
  domainMax = Math.max(domainMax, data.max)

  if (includesZero) {
    domainMin = Math.min(domainMin, 0)
    domainMax = Math.max(domainMax, 0)
  }

  if (!(domainMax > domainMin)) {
    domainMin -= ZERO_SERIES_HALF_SPAN
    domainMax += ZERO_SERIES_HALF_SPAN
  }

  return {
    domain: [domainMin, domainMax],
    includesZero,
    flat,
  }
}
