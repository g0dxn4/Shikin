/**
 * Axis geometry for recorded balances. View math only.
 *
 * Rows stay integer centavos in input order. Padded Y bounds and date ticks are
 * axis positions, not financial records, and are not appended to `points`.
 * There is no current-point fill, month fill, FX, delta, or profit.
 * Pass an uppercase ISO currency. Unsupported codes are invalid, never USD.
 *
 * @example
 * const model = buildRecordedBalanceModel(rows, 'USD', {
 *   maxDateTicks: 2, // 2 at 320px, 3 at 375px, 5 on desktop
 *   includeZero: false,
 *   locale: 'es',
 * })
 * if (model.status === 'series') {
 *   model.xDomain // observed UTC extent, not a 1970 query bound
 *   model.dateTicks // ends anchored; not extra rows
 *   model.yDomain // integer centavos
 *   model.formatAxis(model.yTicks[0])
 * }
 */

/** Line pad on each side of the recorded span. Product choice, not a new balance. */
export const RECORDED_BALANCE_LINE_PAD_RATIO = 0.08
/** Minimum line pad relative to the largest absolute recorded centavo value. */
export const RECORDED_BALANCE_MAGNITUDE_FLOOR_RATIO = 0.005
/** Include 0 on a line when the nearer extreme is within this fraction of the span. */
export const RECORDED_BALANCE_NEAR_ZERO_SPAN_RATIO = 0.25
/** Lower bound for the Y band so a sign or currency glyph is not clipped. */
export const RECORDED_BALANCE_MIN_Y_WIDTH = 64

const DAY_MS = 86_400_000
const CENTAVOS_PER_UNIT = 100
const COMPACT_MIN_CENTAVOS = 100_000
const UNIX_EPOCH_DAYS = 719468

export type RecordedBalanceDateTicks = 2 | 3 | 5

export type RecordedBalanceInvalidReason =
  | 'currency'
  | 'locale'
  | 'options'
  | 'input'
  | 'date'
  | 'amount'
  | 'order'

export interface RecordedBalanceInput {
  readonly date: string
  readonly amountCentavos: number
}

export interface RecordedBalanceModelOptions {
  /** Disjoint choice. Ends stay anchored. Defaults to 3. */
  readonly maxDateTicks?: RecordedBalanceDateTicks
  /** Area/bar magnitude. Includes 0 and a negative minimum. */
  readonly includeZero?: boolean
  /** BCP 47 locale for tick text. `en` and `es` are safe. Defaults to `en`. */
  readonly locale?: string
}

export interface RecordedBalancePoint {
  readonly date: string
  readonly amountCentavos: number
  /** UTC midnight epoch milliseconds. Not a Date object. */
  readonly utcTimestamp: number
  /** Input index. Selection stays on this index; next/prev belongs to the caller. */
  readonly sourceIndex: number
}

export interface RecordedBalanceInvalid {
  readonly status: 'invalid'
  readonly reason: RecordedBalanceInvalidReason
  readonly currency: string
  readonly sourceIndex: number | null
}

interface RecordedBalanceFormatters {
  readonly currency: string
  readonly locale: string
  readonly includeZero: boolean
  readonly suggestedYWidth: number
  /** Tick precision chosen from the labels actually drawn. Explicit currency. */
  readonly formatAxis: (centavos: number) => string
  /** Full minor units. Explicit currency, never a USD default. */
  readonly formatExact: (centavos: number) => string
  /** UTC month/day label. Same year visibility as `dateTickLabels`. */
  readonly formatDate: (utcTimestamp: number) => string
}

export interface RecordedBalanceEmpty extends RecordedBalanceFormatters {
  readonly status: 'empty'
  readonly points: readonly RecordedBalancePoint[]
  readonly xDomain: null
  readonly dateTicks: readonly number[]
  readonly dateTickLabels: readonly string[]
  readonly yDomain: null
  readonly yTicks: readonly number[]
  readonly yTickLabels: readonly string[]
}

export interface RecordedBalancePlotted extends RecordedBalanceFormatters {
  readonly status: 'single' | 'flat' | 'series'
  readonly points: readonly RecordedBalancePoint[]
  /** Observed record extent. Not a SQL lower bound and not extra rows. */
  readonly xDomain: readonly [number, number]
  /** Calendar axis positions. Endpoints are the observed extent. Not rows. */
  readonly dateTicks: readonly number[]
  readonly dateTickLabels: readonly string[]
  /** Integer centavo axis bounds. Not financial records. */
  readonly yDomain: readonly [number, number]
  readonly yTicks: readonly number[]
  readonly yTickLabels: readonly string[]
}

export type RecordedBalanceModel =
  | RecordedBalanceInvalid
  | RecordedBalanceEmpty
  | RecordedBalancePlotted

const NICE_MAJOR_STEPS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1_000,
  2_000, 2_500, 5_000, 10_000, 20_000, 25_000, 50_000, 100_000, 200_000, 250_000, 500_000,
  1_000_000, 2_000_000, 5_000_000,
]

function invalid(
  reason: RecordedBalanceInvalidReason,
  currency: string,
  sourceIndex: number | null = null
): RecordedBalanceInvalid {
  return { status: 'invalid', reason, currency, sourceIndex }
}

function truncDiv(value: number, divisor: number): number {
  return value < 0 ? Math.ceil(value / divisor) : Math.floor(value / divisor)
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/** Days since 1970-01-01. Avoids Date.UTC, which maps years 0–99 to 1900–1999. */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year
  const era = truncDiv(shiftedYear >= 0 ? shiftedYear : shiftedYear - 399, 400)
  const yearOfEra = shiftedYear - era * 400
  const monthAdj = month > 2 ? month - 3 : month + 9
  const dayOfYear = Math.floor((153 * monthAdj + 2) / 5) + day - 1
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - UNIX_EPOCH_DAYS
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + UNIX_EPOCH_DAYS
  const era = truncDiv(z >= 0 ? z : z - 146096, 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365
  )
  let year = yearOfEra + era * 400
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1
  const month = monthPart + (monthPart < 10 ? 3 : -9)
  if (month <= 2) year += 1
  return { year, month, day }
}

function parseUtcDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  const days = daysFromCivil(year, month, day)
  const timestamp = days * DAY_MS
  if (!Number.isSafeInteger(timestamp)) return null
  const back = civilFromDays(days)
  if (back.year !== year || back.month !== month || back.day !== day) return null
  return timestamp
}

export function formatRecordedAxisDate(
  utcTimestamp: number,
  locale = 'en',
  withYear = false
): string {
  if (!Number.isFinite(utcTimestamp)) return ''
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(utcTimestamp)
  } catch {
    return ''
  }
}

/** Fraction of the observed extent. Null when the extent has no duration and the instant is outside it. */
export function recordedElapsedFraction(
  utcTimestamp: number,
  xDomain: readonly [number, number]
): number | null {
  if (!Number.isFinite(utcTimestamp)) return null
  const [start, end] = xDomain
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  if (end === start) return utcTimestamp === start ? 0 : null
  return (utcTimestamp - start) / (end - start)
}

function acceptedLocale(locale: string): boolean {
  try {
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(0)
    new Intl.NumberFormat(locale).format(0)
    return true
  } catch {
    return false
  }
}

function acceptedCurrency(currency: string, locale: string): boolean {
  if (!/^[A-Z]{3}$/.test(currency)) return false
  try {
    const format = new Intl.NumberFormat(locale, { style: 'currency', currency })
    format.format(0)
    format.format(-1)
    return true
  } catch {
    return false
  }
}

function readOptions(
  options: RecordedBalanceModelOptions | undefined
):
  | { maxDateTicks: RecordedBalanceDateTicks; includeZero: boolean; locale: string }
  | RecordedBalanceInvalidReason {
  if (options !== undefined && (options === null || typeof options !== 'object')) return 'options'
  const opts = options ?? {}
  const maxDateTicks = opts.maxDateTicks ?? 3
  if (maxDateTicks !== 2 && maxDateTicks !== 3 && maxDateTicks !== 5) return 'options'
  if (opts.includeZero !== undefined && typeof opts.includeZero !== 'boolean') return 'options'
  const locale = opts.locale ?? 'en'
  if (typeof locale !== 'string' || locale.length === 0 || !acceptedLocale(locale)) return 'locale'
  return { maxDateTicks, includeZero: opts.includeZero === true, locale }
}

function lineDomain(min: number, max: number): readonly [number, number] {
  const span = max - min
  const maxAbs = Math.max(Math.abs(min), Math.abs(max))
  const pad = Math.max(
    Math.round(span * RECORDED_BALANCE_LINE_PAD_RATIO),
    Math.round(maxAbs * RECORDED_BALANCE_MAGNITUDE_FLOOR_RATIO)
  )
  let low = min - pad
  let high = max + pad
  const crosses = min <= 0 && max >= 0
  const distance = min > 0 ? min : max < 0 ? -max : 0
  const near = distance / RECORDED_BALANCE_NEAR_ZERO_SPAN_RATIO <= span
  if (!crosses) {
    if (min > 0 && (near || low < 0)) low = 0
    if (max < 0 && (near || high > 0)) high = 0
  }
  return [low, high]
}

function magnitudeDomain(min: number, max: number): readonly [number, number] {
  if (min === max) return min >= 0 ? [0, min] : [min, 0]
  const pad = Math.max(0, Math.round((max - min) * RECORDED_BALANCE_LINE_PAD_RATIO))
  const low = Math.min(min, 0) - (min < 0 ? pad : 0)
  const high = Math.max(max, 0) + (max > 0 ? pad : 0)
  return [Math.min(low, 0), Math.max(high, 0)]
}

function firstMultipleAtOrAbove(value: number, step: number): number {
  const remainder = ((value % step) + step) % step
  return remainder === 0 ? value : value + (step - remainder)
}

function ticksInRange(low: number, high: number, step: number): number[] {
  const ticks: number[] = []
  for (
    let tick = firstMultipleAtOrAbove(low, step);
    tick <= high && ticks.length < 8;
    tick += step
  ) {
    ticks.push(tick)
  }
  return ticks
}

function chooseYTicks(low: number, high: number): number[] {
  if (low === high) return [low]
  const span = high - low
  let best: number[] = []
  let bestScore = Number.POSITIVE_INFINITY
  for (const major of NICE_MAJOR_STEPS) {
    const step = Math.max(1, Math.round(major * CENTAVOS_PER_UNIT))
    if (step > span) continue
    const ticks = ticksInRange(low, high, step)
    if (ticks.length < 2 || ticks.length > 6) continue
    const preference =
      ticks.length === 4
        ? 0
        : ticks.length === 3
          ? 1
          : ticks.length === 5
            ? 2
            : ticks.length === 2
              ? 3
              : 4
    const score = preference * 1_000 - Math.log10(step)
    if (score < bestScore) {
      best = ticks
      bestScore = score
    }
  }
  if (best.length >= 2) return best
  return high - low <= 6 ? ticksInRange(low, high, 1) : [low, high]
}

function chooseDateTicks(start: number, end: number, maxTicks: RecordedBalanceDateTicks): number[] {
  if (start === end) return [start]
  const spanDays = Math.round((end - start) / DAY_MS)
  for (let count = maxTicks; count >= 2; count -= 1) {
    const ticks: number[] = []
    for (let index = 0; index < count; index += 1) {
      ticks.push(start + Math.round((spanDays * index) / (count - 1)) * DAY_MS)
    }
    const unique = [...new Set(ticks)]
    if (unique[0] === start && unique[unique.length - 1] === end && unique.length >= 2)
      return unique
  }
  return [start, end]
}

function labelDateTicks(
  ticks: readonly number[],
  locale: string
): { ticks: number[]; labels: string[]; withYear: boolean } {
  const withYear =
    new Set(ticks.map((tick) => formatRecordedAxisDate(tick, locale))).size !== ticks.length
  let chosen = [...ticks]
  let labels = chosen.map((tick) => formatRecordedAxisDate(tick, locale, withYear))
  while (new Set(labels).size !== labels.length && chosen.length > 2) {
    chosen = chosen.filter((_, index) => index !== Math.floor(chosen.length / 2))
    labels = chosen.map((tick) => formatRecordedAxisDate(tick, locale, withYear))
  }
  return { ticks: chosen, labels, withYear }
}

function keepsSign(format: Intl.NumberFormat, tick: number): boolean {
  if (tick >= 0) return true
  return format.formatToParts(tick / CENTAVOS_PER_UNIT).some((part) => {
    return (
      part.type === 'minusSign' ||
      part.value.includes('-') ||
      part.value.includes('−') ||
      part.value.includes('(')
    )
  })
}

function axisFormatter(
  ticks: readonly number[],
  currency: string,
  locale: string
): (centavos: number) => string {
  if (ticks.length <= 1) {
    const exact = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    })
    return (centavos: number) =>
      Number.isSafeInteger(centavos) ? exact.format(centavos / CENTAVOS_PER_UNIT) : ''
  }
  const compactAllowed =
    ticks.length >= 2 &&
    ticks.every((tick) => Math.abs(tick) >= COMPACT_MIN_CENTAVOS && tick % CENTAVOS_PER_UNIT === 0)
  const candidates: Intl.NumberFormatOptions[] = []
  if (compactAllowed) {
    // One compact precision. If those labels collide, fall through to full dollars.
    candidates.push({ notation: 'compact', maximumFractionDigits: 0, minimumFractionDigits: 0 })
  }
  for (const digits of [0, 1, 2] as const) {
    candidates.push({
      notation: 'standard',
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    })
  }
  for (const candidate of candidates) {
    const digits = candidate.maximumFractionDigits ?? 0
    if (candidate.notation !== 'compact') {
      const unit = 10 ** (2 - digits)
      if (ticks.some((tick) => tick % unit !== 0)) continue
    }
    const format = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      ...candidate,
    })
    const labels = ticks.map((tick) => format.format(tick / CENTAVOS_PER_UNIT))
    if (new Set(labels).size !== labels.length) continue
    if (ticks.some((tick) => !keepsSign(format, tick))) continue
    return (centavos: number) =>
      Number.isSafeInteger(centavos) ? format.format(centavos / CENTAVOS_PER_UNIT) : ''
  }
  const exact = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
  return (centavos: number) =>
    Number.isSafeInteger(centavos) ? exact.format(centavos / CENTAVOS_PER_UNIT) : ''
}

function exactFormatter(currency: string, locale: string): (centavos: number) => string {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency })
  return (centavos: number) =>
    Number.isSafeInteger(centavos) ? format.format(centavos / CENTAVOS_PER_UNIT) : ''
}

function suggestedYWidth(labels: readonly string[]): number {
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0)
  if (longest === 0) return RECORDED_BALANCE_MIN_Y_WIDTH
  return Math.max(RECORDED_BALANCE_MIN_Y_WIDTH, Math.ceil(longest * 7.2 + 16))
}

function yDomainFor(
  status: RecordedBalancePlotted['status'],
  points: readonly RecordedBalancePoint[],
  includeZero: boolean
): readonly [number, number] {
  let min = points[0].amountCentavos
  let max = min
  for (const point of points) {
    if (point.amountCentavos < min) min = point.amountCentavos
    if (point.amountCentavos > max) max = point.amountCentavos
  }
  if (includeZero) return magnitudeDomain(min, max)
  if (status !== 'series') return [min, max]
  return lineDomain(min, max)
}

export function buildRecordedBalanceModel(
  points: readonly RecordedBalanceInput[],
  currency: string,
  options?: RecordedBalanceModelOptions
): RecordedBalanceModel {
  const currencyText = typeof currency === 'string' ? currency : ''
  const parsedOptions = readOptions(options)
  if (typeof parsedOptions === 'string') return invalid(parsedOptions, currencyText)
  if (!acceptedCurrency(currencyText, parsedOptions.locale))
    return invalid('currency', currencyText)
  if (!Array.isArray(points)) return invalid('input', currencyText)

  const parsed: RecordedBalancePoint[] = []
  let previousTimestamp: number | null = null
  for (let index = 0; index < points.length; index += 1) {
    const row = points[index]
    if (!row || typeof row !== 'object') return invalid('date', currencyText, index)
    const utcTimestamp = parseUtcDate(row.date)
    if (utcTimestamp === null) return invalid('date', currencyText, index)
    if (typeof row.amountCentavos !== 'number' || !Number.isSafeInteger(row.amountCentavos)) {
      return invalid('amount', currencyText, index)
    }
    if (previousTimestamp !== null && utcTimestamp < previousTimestamp) {
      return invalid('order', currencyText, index)
    }
    previousTimestamp = utcTimestamp
    parsed.push({
      date: row.date,
      amountCentavos: row.amountCentavos,
      utcTimestamp,
      sourceIndex: index,
    })
  }

  const { locale, includeZero, maxDateTicks } = parsedOptions
  const formatExact = exactFormatter(currencyText, locale)
  if (parsed.length === 0) {
    return {
      status: 'empty',
      currency: currencyText,
      locale,
      includeZero,
      points: parsed,
      xDomain: null,
      dateTicks: [],
      dateTickLabels: [],
      yDomain: null,
      yTicks: [],
      yTickLabels: [],
      suggestedYWidth: RECORDED_BALANCE_MIN_Y_WIDTH,
      formatAxis: formatExact,
      formatExact,
      formatDate: (utcTimestamp: number) => formatRecordedAxisDate(utcTimestamp, locale),
    }
  }

  const status: RecordedBalancePlotted['status'] =
    parsed.length === 1
      ? 'single'
      : parsed.every((point) => point.amountCentavos === parsed[0].amountCentavos)
        ? 'flat'
        : 'series'
  const xDomain: readonly [number, number] = [
    parsed[0].utcTimestamp,
    parsed[parsed.length - 1].utcTimestamp,
  ]
  const dated = labelDateTicks(chooseDateTicks(xDomain[0], xDomain[1], maxDateTicks), locale)
  const yDomain = yDomainFor(status, parsed, includeZero)
  const yTicks = chooseYTicks(yDomain[0], yDomain[1])
  const formatAxis = axisFormatter(yTicks, currencyText, locale)
  const yTickLabels = yTicks.map((tick) => formatAxis(tick))
  return {
    status,
    currency: currencyText,
    locale,
    includeZero,
    points: parsed,
    xDomain,
    dateTicks: dated.ticks,
    dateTickLabels: dated.labels,
    yDomain,
    yTicks,
    yTickLabels,
    suggestedYWidth: suggestedYWidth(yTickLabels),
    formatAxis,
    formatExact,
    formatDate: (utcTimestamp: number) =>
      formatRecordedAxisDate(utcTimestamp, locale, dated.withYear),
  }
}
