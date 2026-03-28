import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'

const FRANKFURTER_BASE = 'https://api.frankfurter.app'

export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'MXN',
  'CAD',
  'JPY',
  'BRL',
  'COP',
  'ARS',
] as const

// Currencies actually supported by frankfurter.app (ECB data)
// COP, ARS, CLP, PEN are not available — skip them silently
const FRANKFURTER_SUPPORTED = new Set([
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
])

export type CommonCurrency = (typeof COMMON_CURRENCIES)[number]

interface FrankfurterResponse {
  base: string
  date: string
  rates: Record<string, number>
}

interface ExchangeRateRow {
  from_currency: string
  to_currency: string
  rate: number
  date: string
}

/**
 * Fetch latest exchange rates from frankfurter.app for a base currency.
 */
export async function fetchRates(baseCurrency: string): Promise<Record<string, number>> {
  const url = `${FRANKFURTER_BASE}/latest?from=${baseCurrency}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch rates: ${response.status} ${response.statusText}`)
  }
  const data: FrankfurterResponse = await response.json()
  return data.rates
}

/**
 * Get exchange rate from DB cache, falling back to a live fetch.
 */
export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1

  // Try cache first (today's rate)
  const today = new Date().toISOString().split('T')[0]
  const cached = await query<ExchangeRateRow>(
    `SELECT rate FROM exchange_rates
     WHERE from_currency = ? AND to_currency = ? AND date = ?
     LIMIT 1`,
    [from, to, today]
  )

  if (cached.length > 0) {
    return cached[0].rate
  }

  // Try most recent cached rate (any date)
  const recent = await query<ExchangeRateRow>(
    `SELECT rate FROM exchange_rates
     WHERE from_currency = ? AND to_currency = ?
     ORDER BY date DESC LIMIT 1`,
    [from, to]
  )

  // Also try to fetch fresh rates
  try {
    const rates = await fetchRates(from)
    if (rates[to] !== undefined) {
      await storeRate(from, to, rates[to], today)
      return rates[to]
    }
  } catch {
    // Network error — use cached if available
  }

  if (recent.length > 0) {
    return recent[0].rate
  }

  throw new Error(`No exchange rate available for ${from} -> ${to}`)
}

/**
 * Convert an amount in centavos from one currency to another.
 * Returns the converted amount in centavos.
 */
export async function convertAmount(
  amountCentavos: number,
  from: string,
  to: string
): Promise<number> {
  if (from === to) return amountCentavos
  const rate = await getRate(from, to)
  return Math.round(amountCentavos * rate)
}

/**
 * Store a single exchange rate in the DB.
 */
async function storeRate(from: string, to: string, rate: number, date: string): Promise<void> {
  const id = generateId()
  await execute(
    `INSERT OR REPLACE INTO exchange_rates (id, from_currency, to_currency, rate, date)
     VALUES (?, ?, ?, ?, ?)`,
    [id, from, to, rate, date]
  )
}

/**
 * Refresh rates for all common currencies from frankfurter.app.
 * Fetches USD-based rates and derives cross rates.
 */
export async function refreshRates(): Promise<Record<string, Record<string, number>>> {
  const allRates: Record<string, Record<string, number>> = {}
  const today = new Date().toISOString().split('T')[0]

  // Fetch rates from each common currency supported by frankfurter.app
  // Unsupported currencies (COP, ARS, etc.) are silently skipped
  const fetchable = COMMON_CURRENCIES.filter((c) => FRANKFURTER_SUPPORTED.has(c))

  for (const base of fetchable) {
    try {
      const rates = await fetchRates(base)
      allRates[base] = rates

      // Store each rate pair
      for (const [target, rate] of Object.entries(rates)) {
        if (COMMON_CURRENCIES.includes(target as CommonCurrency)) {
          await storeRate(base, target, rate, today)
        }
      }
    } catch {
      // Network error or API issue — skip silently
    }
  }

  return allRates
}

/**
 * Get all cached rates from the database for today (or most recent).
 */
export async function getCachedRates(): Promise<ExchangeRateRow[]> {
  const today = new Date().toISOString().split('T')[0]

  // Try today's rates first
  let rates = await query<ExchangeRateRow>(
    `SELECT from_currency, to_currency, rate, date
     FROM exchange_rates WHERE date = ?
     ORDER BY from_currency, to_currency`,
    [today]
  )

  // Fall back to most recent rates
  if (rates.length === 0) {
    rates = await query<ExchangeRateRow>(
      `SELECT from_currency, to_currency, rate, date
       FROM exchange_rates
       WHERE date = (SELECT MAX(date) FROM exchange_rates)
       ORDER BY from_currency, to_currency`
    )
  }

  return rates
}

/**
 * Get the last time rates were fetched.
 */
export async function getLastFetchDate(): Promise<string | null> {
  const result = await query<{ max_date: string | null }>(
    'SELECT MAX(date) as max_date FROM exchange_rates'
  )
  return result[0]?.max_date ?? null
}
