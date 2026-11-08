import {
  decodeInstrumentIdentityKey,
  instrumentIdentityKey,
  multiplyDecimalsToCentavos,
} from '@shikin/finance-core/valuation'

/** Must match the page's `fetchPriceHistory(..., 365)` read. The read omits row currency. */
export const QUOTE_HISTORY_FETCH_LIMIT = 365

export const ALLOCATION_TYPE_ORDER = [
  'stock',
  'etf',
  'crypto',
  'bond',
  'mutual_fund',
  'cetes',
  'other',
] as const

/** Chart tokens only. Extra types stay token-mixed so series are not one bone wash. */
export const ALLOCATION_COLORS: Record<string, string> = {
  stock: 'var(--color-chart-1)',
  etf: 'var(--color-chart-2)',
  crypto: 'var(--color-chart-3)',
  bond: 'var(--color-chart-4)',
  mutual_fund: 'var(--color-chart-5)',
  cetes: 'color-mix(in srgb, var(--color-chart-2) 58%, var(--color-chart-5))',
  other: 'color-mix(in srgb, var(--color-chart-4) 62%, var(--color-chart-1))',
}

export type AllocationSegment = {
  type: string
  amountCentavos: number
  widthPercent: string
  fraction: number
  color: string
}

export type CompleteAllocation = {
  currency: string
  totalCentavos: number
  segments: AllocationSegment[]
}

export type QuoteHistoryHolding = {
  id: string
  instrumentKey: string | null
  quantityDecimal: string | null | undefined
  assetType: string | null | undefined
  provider: string | null | undefined
  instrumentId: string | null | undefined
  exchange: string | null | undefined
  currentPriceCurrency: string | null | undefined
}

export type QuoteHistorySeriesPoint = {
  date: string
  unitPriceDecimal: string
}

export type QuotePlotWithholdReason =
  | 'totals-incomplete'
  | 'report-currency-missing'
  | 'ownership-unproven'
  | 'quote-currency-mismatch'
  | 'history-missing'
  | 'series-invalid'
  | 'series-truncated'
  | 'fewer-than-two-common-dates'

export type QuotePlotSelection =
  | {
      status: 'plot'
      currency: string
      points: Array<{ date: string; valueCentavos: number }>
    }
  | {
      status: 'withheld'
      reason: QuotePlotWithholdReason
      /** Shorter ranges can still be proven when identity is sound and only the window fails. */
      rangeSelectable: boolean
    }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function normalizeCurrency(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase()
  return normalized ? normalized : null
}

function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** Quote history omits row currency, so only a strictly decoded identity proves its currency. */
export function quoteCurrencyEncodedInInstrumentKey(instrumentKey: string): string | null {
  return decodeInstrumentIdentityKey(instrumentKey)?.quoteCurrency ?? null
}

function exactWidthPercent(amountCentavos: number, totalCentavos: number): string | null {
  if (!Number.isSafeInteger(amountCentavos) || !Number.isSafeInteger(totalCentavos)) return null
  if (amountCentavos <= 0 || totalCentavos <= 0 || amountCentavos > totalCentavos) return null
  const percent = (amountCentavos / totalCentavos) * 100
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null
  return `${percent}%`
}

export function allocationColor(type: string): string {
  return (
    ALLOCATION_COLORS[type] ?? `color-mix(in srgb, var(--color-chart-3) 50%, var(--color-chart-5))`
  )
}

/**
 * Already-converted complete allocation. Refuses a ring when the type parts
 * do not add back to the report total, or when any share would need a floor.
 */
export function buildCompleteAllocation({
  byType,
  currency,
  totalsComplete,
  totalMarketValue,
}: {
  byType: Record<string, { marketValue: number }>
  currency: string | null | undefined
  totalsComplete: boolean
  totalMarketValue: number | null | undefined
}): CompleteAllocation | null {
  const reportCurrency = normalizeCurrency(currency)
  if (
    !totalsComplete ||
    !reportCurrency ||
    totalMarketValue === null ||
    totalMarketValue === undefined
  )
    return null
  if (!Number.isSafeInteger(totalMarketValue) || totalMarketValue <= 0) return null
  const totalCentavos = totalMarketValue

  const entries = Object.entries(byType).filter(([, data]) => data.marketValue !== 0)
  if (entries.length === 0) return null
  if (entries.some(([, data]) => !Number.isSafeInteger(data.marketValue) || data.marketValue < 0)) {
    return null
  }

  const ordered = [...entries].sort(([left], [right]) => {
    const leftIndex = ALLOCATION_TYPE_ORDER.indexOf(left as (typeof ALLOCATION_TYPE_ORDER)[number])
    const rightIndex = ALLOCATION_TYPE_ORDER.indexOf(
      right as (typeof ALLOCATION_TYPE_ORDER)[number]
    )
    const leftRank = leftIndex === -1 ? ALLOCATION_TYPE_ORDER.length : leftIndex
    const rightRank = rightIndex === -1 ? ALLOCATION_TYPE_ORDER.length : rightIndex
    return leftRank - rightRank || left.localeCompare(right)
  })

  let sum = 0
  const segments: AllocationSegment[] = []
  for (const [type, data] of ordered) {
    const widthPercent = exactWidthPercent(data.marketValue, totalCentavos)
    if (!widthPercent) return null
    sum += data.marketValue
    if (!Number.isSafeInteger(sum)) return null
    segments.push({
      type,
      amountCentavos: data.marketValue,
      widthPercent,
      fraction: data.marketValue / totalCentavos,
      color: allocationColor(type),
    })
  }
  if (sum !== totalCentavos) return null
  return { currency: reportCurrency, totalCentavos, segments }
}

type ProvenHolding = {
  id: string
  key: string
  quantityDecimal: string
}

function proveHolding(
  holding: QuoteHistoryHolding,
  reportCurrency: string
): { ok: true; holding: ProvenHolding } | { ok: false; reason: QuotePlotWithholdReason } {
  const identity = holding.instrumentKey ? decodeInstrumentIdentityKey(holding.instrumentKey) : null
  if (identity && identity.quoteCurrency !== reportCurrency) {
    return { ok: false, reason: 'quote-currency-mismatch' }
  }
  if (
    !identity ||
    !holding.instrumentKey ||
    !holding.assetType ||
    !holding.provider ||
    !holding.instrumentId ||
    !holding.currentPriceCurrency ||
    !holding.quantityDecimal?.trim() ||
    holding.assetType !== identity.assetType ||
    holding.provider !== identity.provider
  ) {
    return { ok: false, reason: 'ownership-unproven' }
  }
  let rebuilt: string
  try {
    rebuilt = instrumentIdentityKey({
      assetType: identity.assetType,
      provider: identity.provider,
      instrumentId: holding.instrumentId,
      exchange: holding.exchange ?? '',
      quoteCurrency: holding.currentPriceCurrency,
    })
  } catch {
    return { ok: false, reason: 'ownership-unproven' }
  }
  if (rebuilt !== holding.instrumentKey) return { ok: false, reason: 'ownership-unproven' }
  const quote = identity.quoteCurrency
  const liveQuote = normalizeCurrency(holding.currentPriceCurrency)
  if (!quote || !liveQuote || quote !== liveQuote || quote !== reportCurrency) {
    return {
      ok: false,
      reason: quote && quote !== reportCurrency ? 'quote-currency-mismatch' : 'ownership-unproven',
    }
  }
  return {
    ok: true,
    holding: {
      id: holding.id,
      key: holding.instrumentKey,
      quantityDecimal: holding.quantityDecimal.trim(),
    },
  }
}

function nonNegativePrice(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('-')) return false
  return /^(\d+)(?:\.(\d+))?$/.test(trimmed)
}

function seriesByDate(
  points: readonly QuoteHistorySeriesPoint[] | undefined,
  historyLimit: number,
  rangeStart: string | null
):
  | { ok: true; dates: Map<string, string> }
  | { ok: false; reason: 'history-missing' | 'series-invalid' | 'series-truncated' } {
  if (!points) return { ok: false, reason: 'history-missing' }
  const seen = new Set<string>()
  let oldest: string | null = null
  for (const point of points) {
    if (
      !isIsoDate(point.date) ||
      !nonNegativePrice(point.unitPriceDecimal) ||
      seen.has(point.date)
    ) {
      return { ok: false, reason: 'series-invalid' }
    }
    seen.add(point.date)
    if (oldest === null || point.date < oldest) oldest = point.date
  }
  const truncated = points.length >= historyLimit
  if (truncated && (rangeStart === null || oldest === null || oldest > rangeStart)) {
    return { ok: false, reason: 'series-truncated' }
  }
  const dates = new Map<string, string>()
  for (const point of points) {
    if (rangeStart !== null && point.date < rangeStart) continue
    dates.set(point.date, point.unitPriceDecimal.trim())
  }
  return { ok: true, dates }
}

const REASON_RANK: Record<QuotePlotWithholdReason, number> = {
  'quote-currency-mismatch': 0,
  'ownership-unproven': 1,
  'history-missing': 2,
  'series-invalid': 3,
  'series-truncated': 4,
  'fewer-than-two-common-dates': 5,
  'totals-incomplete': 6,
  'report-currency-missing': 7,
}

function withheld(reason: QuotePlotWithholdReason, rangeSelectable = false): QuotePlotSelection {
  return { status: 'withheld', reason, rangeSelectable }
}

/**
 * Optional plot of current quantities at recorded quotes.
 * Not portfolio performance. No forward-fill, no FX, no partial holdings, no synthetic dates.
 */
export function selectCurrentQuantityQuotePlot({
  holdings,
  historyByKey,
  reportCurrency,
  totalsComplete,
  rangeStart,
  historyLimit = QUOTE_HISTORY_FETCH_LIMIT,
}: {
  holdings: readonly QuoteHistoryHolding[]
  historyByKey: ReadonlyMap<string, readonly QuoteHistorySeriesPoint[]>
  reportCurrency: string | null | undefined
  totalsComplete: boolean
  rangeStart: string | null
  historyLimit?: number
}): QuotePlotSelection {
  if (!totalsComplete) return withheld('totals-incomplete')
  const currency = normalizeCurrency(reportCurrency)
  if (!currency) return withheld('report-currency-missing')
  if (rangeStart !== null && !isIsoDate(rangeStart)) return withheld('series-invalid')
  if (holdings.length === 0) return withheld('fewer-than-two-common-dates')

  const proven: ProvenHolding[] = []
  const failures: QuotePlotWithholdReason[] = []
  for (const holding of holdings) {
    const result = proveHolding(holding, currency)
    if (!result.ok) failures.push(result.reason)
    else proven.push(result.holding)
  }
  if (failures.length > 0) {
    failures.sort((left, right) => REASON_RANK[left] - REASON_RANK[right])
    return withheld(failures[0]!)
  }

  const series: Array<Map<string, string>> = []
  for (const holding of proven) {
    const parsed = seriesByDate(historyByKey.get(holding.key), historyLimit, rangeStart)
    if (!parsed.ok) {
      return withheld(parsed.reason, parsed.reason === 'series-truncated')
    }
    series.push(parsed.dates)
  }

  const [first, ...rest] = series
  if (!first) return withheld('fewer-than-two-common-dates', true)
  const common = [...first.keys()].filter((date) => rest.every((dates) => dates.has(date))).sort()
  if (common.length < 2) return withheld('fewer-than-two-common-dates', true)

  try {
    const points = common.map((date) => {
      let total = 0
      proven.forEach((holding, index) => {
        const price = series[index]?.get(date)
        if (!price) throw new Error('missing common quote')
        const next = total + multiplyDecimalsToCentavos([holding.quantityDecimal, price])
        if (!Number.isSafeInteger(next)) throw new RangeError('quote plot sum')
        total = next
      })
      return { date, valueCentavos: total }
    })
    return { status: 'plot', currency, points }
  } catch {
    return withheld('series-invalid')
  }
}
