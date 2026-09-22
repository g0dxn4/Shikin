import {
  canonicalDecimal,
  decimalFromCentavos,
  multiplyDecimalsToCentavos,
  type ValuationRate,
} from './valuation.js'

/** Manual authority only. Provider cache, inverse pairs and implicit clocks are excluded. */
export const FX_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'MXN',
  'BRL',
  'ARS',
  'COP',
  'CLP',
  'PEN',
  'CAD',
  'AUD',
] as const
export interface DatedExchangeRate {
  id: string
  fromCurrency: string
  toCurrency: string
  rateDecimal: string
  effectiveFrom: string
  supersedesRateId: string | null
  createdAt: string
  sourceNote: string | null
}
export function assertFxCurrency(currency: string): void {
  if (!(FX_CURRENCIES as readonly string[]).includes(currency))
    throw new TypeError(`Unsupported currency: ${currency}`)
}
export function assertFxDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('Expected calendar date YYYY-MM-DD')
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!)
    throw new TypeError(`Invalid calendar date: ${date}`)
}
export function validateRateDecimal(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new TypeError('Rate must be a positive plain decimal')
  const normalized = canonicalDecimal(value) // bounded 80 digits / 40 fractional digits
  if (normalized === '0') throw new RangeError('Rate must be positive')
  return normalized
}
function safe(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new RangeError('Centavos exceed safe integer range')
  return result
}
function cents(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError('Centavos must be a safe integer')
  return BigInt(value)
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
function validateHistory(rates: readonly DatedExchangeRate[]): Set<string> {
  const byId = new Map<string, DatedExchangeRate>()
  const roots = new Set<string>()
  const superseded = new Set<string>()
  for (const row of rates) {
    if (!row.id || byId.has(row.id)) throw new Error('Duplicate or empty rate ID')
    assertFxCurrency(row.fromCurrency)
    assertFxCurrency(row.toCurrency)
    if (row.fromCurrency === row.toCurrency) throw new Error('Same currency needs no manual rate')
    assertFxDate(row.effectiveFrom)
    validateRateDecimal(row.rateDecimal)
    byId.set(row.id, row)
    if (row.supersedesRateId === null) {
      const key = `${row.fromCurrency}/${row.toCurrency}/${row.effectiveFrom}`
      if (roots.has(key)) throw new Error('Duplicate rate root pair/date')
      roots.add(key)
    } else {
      if (superseded.has(row.supersedesRateId)) throw new Error('Rate correction fork')
      superseded.add(row.supersedesRateId)
    }
  }
  for (const row of rates) {
    const visited = new Set<string>([row.id])
    let current = row
    while (current.supersedesRateId !== null) {
      const parent = byId.get(current.supersedesRateId)
      if (!parent || visited.has(parent.id)) throw new Error('Broken or cyclic correction chain')
      if (
        parent.fromCurrency !== row.fromCurrency ||
        parent.toCurrency !== row.toCurrency ||
        parent.effectiveFrom !== row.effectiveFrom
      )
        throw new Error('Correction must retain pair and effective date')
      visited.add(parent.id)
      current = parent
    }
  }
  return superseded
}
/** Null means no direct dated row (also null for same-currency, whose conversion is 1:1). */
export function selectEffectiveRate(
  rates: readonly DatedExchangeRate[],
  from: string,
  to: string,
  asOfDate: string
): DatedExchangeRate | null {
  assertFxCurrency(from)
  assertFxCurrency(to)
  assertFxDate(asOfDate)
  const superseded = validateHistory(rates)
  return (
    rates
      .filter(
        (r) =>
          r.fromCurrency === from &&
          r.toCurrency === to &&
          r.effectiveFrom <= asOfDate &&
          !superseded.has(r.id)
      )
      .sort((a, b) => compare(b.effectiveFrom, a.effectiveFrom) || compare(a.id, b.id))[0] ?? null
  )
}
export interface FxProvenance {
  fromCurrency: string
  toCurrency: string
  asOfDate: string
  rateId: string | null
  effectiveFrom: string | null
  rateDecimal: string | null
  direction: string
}
export type DatedConversion = FxProvenance &
  (
    | { complete: true; amountCentavos: number; missingReason: null }
    | { complete: false; amountCentavos: null; missingReason: 'missing_direct_rate' }
  )
export function convertCentavosAsOf(input: {
  amountCentavos: number
  fromCurrency: string
  toCurrency: string
  asOfDate: string
  rates: readonly DatedExchangeRate[]
}): DatedConversion {
  cents(input.amountCentavos)
  const row = selectEffectiveRate(input.rates, input.fromCurrency, input.toCurrency, input.asOfDate)
  const rateDecimal = input.fromCurrency === input.toCurrency ? '1' : (row?.rateDecimal ?? null)
  const provenance: FxProvenance = {
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    asOfDate: input.asOfDate,
    rateId: row?.id ?? null,
    effectiveFrom: row?.effectiveFrom ?? null,
    rateDecimal,
    direction: `${input.fromCurrency}->${input.toCurrency}`,
  }
  return rateDecimal === null
    ? { ...provenance, complete: false, amountCentavos: null, missingReason: 'missing_direct_rate' }
    : {
        ...provenance,
        complete: true,
        amountCentavos: multiplyDecimalsToCentavos([
          decimalFromCentavos(input.amountCentavos),
          rateDecimal,
        ]),
        missingReason: null,
      }
}
export interface DatedAmount {
  id: string
  amountCentavos: number
  currency: string
  date: string
}
export function convertDatedAmounts(
  rows: readonly DatedAmount[],
  toCurrency: string,
  rates: readonly DatedExchangeRate[]
) {
  assertFxCurrency(toCurrency)
  const native = new Map<string, bigint>()
  const ids = new Set<string>()
  let known = 0n
  const converted = rows.map((row) => {
    if (!row.id || ids.has(row.id)) throw new Error('Duplicate or empty amount ID')
    ids.add(row.id)
    const result = convertCentavosAsOf({
      amountCentavos: row.amountCentavos,
      fromCurrency: row.currency,
      toCurrency,
      asOfDate: row.date,
      rates,
    })
    native.set(row.currency, (native.get(row.currency) ?? 0n) + cents(row.amountCentavos))
    if (result.complete) known += cents(result.amountCentavos)
    return { id: row.id, ...result }
  })
  const unresolvedIds = converted
    .filter((row) => !row.complete)
    .map((row) => row.id)
    .sort(compare)
  const knownTotalCentavos = safe(known)
  return {
    complete: unresolvedIds.length === 0,
    toCurrency,
    totalCentavos: unresolvedIds.length ? null : knownTotalCentavos,
    knownTotalCentavos,
    nativeTotals: [...native]
      .sort(([a], [b]) => compare(a, b))
      .map(([currency, amount]) => ({ currency, amountCentavos: safe(amount) })),
    unresolvedIds,
    converted,
  }
}
/** Positive native allocation weights must sum exactly to the absolute original parent. */
export function apportionConvertedAmount(
  parentConvertedCentavos: number,
  allocations: readonly { id: string; amountCentavos: number }[],
  originalParentCentavos: number
): { id: string; amountCentavos: number }[] {
  const parent = cents(parentConvertedCentavos)
  const original = cents(originalParentCentavos)
  if ((original < 0n && parent > 0n) || (original > 0n && parent < 0n))
    throw new Error('Parent signs must agree')
  const total = original < 0n ? -original : original
  const absolute = parent < 0n ? -parent : parent
  const ids = new Set<string>()
  let sum = 0n
  const parts = allocations.map((row) => {
    const weight = cents(row.amountCentavos)
    if (!row.id || ids.has(row.id) || weight <= 0n)
      throw new Error('Allocations require unique IDs and positive weights')
    ids.add(row.id)
    sum += weight
    return {
      id: row.id,
      quotient: total ? (absolute * weight) / total : 0n,
      remainder: total ? (absolute * weight) % total : 0n,
    }
  })
  if (sum !== total || (total === 0n && absolute !== 0n))
    throw new Error('Allocation sum must equal original parent total')
  let remaining = absolute - parts.reduce((s, row) => s + row.quotient, 0n)
  for (const row of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? compare(a.id, b.id) : a.remainder > b.remainder ? -1 : 1
  )) {
    if (remaining-- > 0n) row.quotient++
  }
  return parts.map((row) => ({
    id: row.id,
    amountCentavos: safe(parent < 0n ? -row.quotient : row.quotient),
  }))
}
export function selectValuationRatesAsOf(
  rates: readonly DatedExchangeRate[],
  toCurrency: string,
  asOfDate: string
): ValuationRate[] {
  assertFxDate(asOfDate)
  assertFxCurrency(toCurrency)
  validateHistory(rates)
  return FX_CURRENCIES.filter((from) => from !== toCurrency).flatMap((from) => {
    const row = selectEffectiveRate(rates, from, toCurrency, asOfDate)
    return row ? [{ fromCurrency: from, toCurrency, rateDecimal: row.rateDecimal }] : []
  })
}
export interface SetExchangeRateInput {
  fromCurrency: string
  toCurrency: string
  rateDecimal: string
  effectiveFrom: string
  replacesRateId?: string | null
  sourceNote?: string | null
  auditNote?: string | null
  acknowledgeHistoricalChange?: boolean
  today: string
}
/** Shared sync/async mutation policy; called again inside the write transaction. */
export function planExchangeRate(
  rates: readonly DatedExchangeRate[],
  input: SetExchangeRateInput,
  identity: { id: string; createdAt: string }
): { rate: DatedExchangeRate; previous: DatedExchangeRate | null; historicalChange: boolean } {
  assertFxDate(input.today)
  if (
    input.replacesRateId !== undefined &&
    input.replacesRateId !== null &&
    !input.replacesRateId.trim()
  ) {
    throw new Error('Correction requires a non-empty predecessor ID')
  }
  const superseded = validateHistory(rates)
  const previous = input.replacesRateId
    ? (rates.find((row) => row.id === input.replacesRateId) ?? null)
    : null
  if (input.replacesRateId && (!previous || superseded.has(previous.id)))
    throw new Error('Stale correction: replace the current leaf rate ID')
  if (
    previous &&
    (previous.fromCurrency !== input.fromCurrency ||
      previous.toCurrency !== input.toCurrency ||
      previous.effectiveFrom !== input.effectiveFrom)
  )
    throw new Error('Correction must retain pair and effective date')
  const historicalChange = input.effectiveFrom < input.today
  if (
    (previous || historicalChange) &&
    (!input.auditNote?.trim() ||
      input.auditNote.trim().length > 1000 ||
      input.acknowledgeHistoricalChange !== true)
  )
    throw new Error(
      'Correction/backdating requires audit note and historical-change acknowledgement'
    )
  if ((input.auditNote?.length ?? 0) > 1000 || (input.sourceNote?.length ?? 0) > 1000)
    throw new Error('FX notes must not exceed 1000 characters')
  const rate: DatedExchangeRate = {
    ...identity,
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    rateDecimal: validateRateDecimal(input.rateDecimal),
    effectiveFrom: input.effectiveFrom,
    supersedesRateId: previous?.id ?? null,
    sourceNote: input.sourceNote?.trim() || null,
  }
  validateHistory([...rates, rate])
  return { rate, previous, historicalChange }
}

export const FX_RATE_SELECT = `SELECT id, from_currency AS fromCurrency, to_currency AS toCurrency, rate_decimal AS rateDecimal, effective_from AS effectiveFrom, supersedes_rate_id AS supersedesRateId, created_at AS createdAt, source_note AS sourceNote FROM manual_exchange_rates ORDER BY effective_from, created_at, id`
export const FX_RATE_INSERT = `INSERT INTO manual_exchange_rates (id, from_currency, to_currency, rate_decimal, effective_from, supersedes_rate_id, created_at, source_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
export function exchangeRateBindings(rate: DatedExchangeRate): (string | null)[] {
  return [
    rate.id,
    rate.fromCurrency,
    rate.toCurrency,
    rate.rateDecimal,
    rate.effectiveFrom,
    rate.supersedesRateId,
    rate.createdAt,
    rate.sourceNote,
  ]
}
