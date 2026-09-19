import { load } from '@/lib/storage'
import { execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import {
  canonicalDecimal,
  decimalFromNumber,
  instrumentIdentityKey,
  isVerifiedInstrumentPrice,
  type InstrumentIdentity,
  type PriceProvider,
  type VerifiedInstrumentPrice,
} from '@shikin/finance-core/valuation'
import type { Investment } from '@/types/database'

async function getApiKey(key: 'alpha_vantage_key' | 'finnhub_key'): Promise<string | null> {
  try {
    const store = await load('settings.json')
    return ((await store.get(key)) as string) || null
  } catch {
    return null
  }
}

export interface PriceIdentitySelection {
  provider: PriceProvider
  instrumentId: string
  exchange: string
  quoteCurrency: string
}

export type PriceQuote = VerifiedInstrumentPrice

export interface PriceRefreshFailure {
  investmentId: string
  symbol: string
  reason: string
}

export interface PriceRefreshResult {
  quotes: Map<string, PriceQuote>
  failures: PriceRefreshFailure[]
}

function plainDecimal(value: unknown): string | null {
  if (typeof value === 'string') {
    try {
      return canonicalDecimal(value)
    } catch {
      return null
    }
  }
  if (typeof value !== 'number') return null
  try {
    return decimalFromNumber(value)
  } catch {
    return null
  }
}

function positiveProviderPrice(value: unknown): string | null {
  const decimal = plainDecimal(value)
  return decimal !== null && Number(decimal) > 0 ? decimal : null
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase()
}

function normalizedType(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, '')
}

function providerTypeMatches(assetType: Investment['type'], providerType: unknown): boolean {
  const type = normalizedType(providerType)
  if (assetType === 'stock') return ['equity', 'commonstock', 'stock'].includes(type)
  if (assetType === 'etf') return type.includes('etf') || type.includes('exchangetradedfund')
  if (assetType === 'mutual_fund') return type.includes('mutualfund')
  if (assetType === 'bond') return type.includes('bond') || type.includes('fixedincome')
  return false
}

async function getJson(url: string, provider: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new Error(`${provider} network request failed`)
  }
  if (!response.ok) throw new Error(`${provider} request failed (${response.status})`)
  try {
    return await response.json()
  } catch {
    throw new Error(`${provider} returned invalid data`)
  }
}

async function fetchAlphaVantage(
  investment: Investment,
  selection: PriceIdentitySelection
): Promise<PriceQuote> {
  const key = await getApiKey('alpha_vantage_key')
  if (!key) throw new Error('Alpha Vantage API key is not configured')
  if (!providerTypeMatches(investment.type, investment.type)) {
    throw new Error(`Alpha Vantage does not support ${investment.type} through GLOBAL_QUOTE`)
  }
  const instrumentId = selection.instrumentId.trim().toUpperCase()
  const exchange = selection.exchange.trim()
  if (!instrumentId || !exchange) throw new Error('Exact symbol and region/exchange are required')

  const searchParams = new URLSearchParams({
    function: 'SYMBOL_SEARCH',
    keywords: instrumentId,
    apikey: key,
  })
  const search = (await getJson(
    `https://www.alphavantage.co/query?${searchParams.toString()}`,
    'Alpha Vantage'
  )) as { bestMatches?: Array<Record<string, unknown>>; Note?: unknown; Information?: unknown }
  if (search.Note || search.Information)
    throw new Error('Alpha Vantage metadata is unavailable or rate limited')
  const matches = (search.bestMatches ?? []).filter(
    (candidate) =>
      String(candidate['1. symbol'] ?? '')
        .trim()
        .toUpperCase() === instrumentId &&
      String(candidate['4. region'] ?? '')
        .trim()
        .toLowerCase() === exchange.toLowerCase() &&
      providerTypeMatches(investment.type, candidate['3. type'])
  )
  if (matches.length !== 1) throw new Error('Alpha Vantage identity is ambiguous or unmatched')
  const quoteCurrency = normalizeCurrency(String(matches[0]['8. currency'] ?? ''))
  if (!quoteCurrency) throw new Error('Alpha Vantage metadata did not provide listing currency')
  if (selection.quoteCurrency && normalizeCurrency(selection.quoteCurrency) !== quoteCurrency) {
    throw new Error('Alpha Vantage listing currency does not match the requested identity')
  }

  const quoteParams = new URLSearchParams({
    function: 'GLOBAL_QUOTE',
    symbol: instrumentId,
    apikey: key,
  })
  const body = (await getJson(
    `https://www.alphavantage.co/query?${quoteParams.toString()}`,
    'Alpha Vantage'
  )) as { 'Global Quote'?: Record<string, unknown>; Note?: unknown; Information?: unknown }
  if (body.Note || body.Information)
    throw new Error('Alpha Vantage quote is unavailable or rate limited')
  const returnedSymbol = String(body['Global Quote']?.['01. symbol'] ?? '')
    .trim()
    .toUpperCase()
  const unitPriceDecimal = positiveProviderPrice(body['Global Quote']?.['05. price'])
  if (returnedSymbol !== instrumentId || !unitPriceDecimal) {
    throw new Error('Alpha Vantage returned an invalid or mismatched quote')
  }
  const identity: InstrumentIdentity = {
    assetType: investment.type,
    provider: 'alpha_vantage',
    instrumentId,
    exchange,
    quoteCurrency,
  }
  return {
    ...identity,
    instrumentKey: instrumentIdentityKey(identity),
    unitPriceDecimal,
    quoteDate: new Date().toISOString().split('T')[0],
  }
}

async function fetchFinnhub(
  investment: Investment,
  selection: PriceIdentitySelection
): Promise<PriceQuote> {
  const key = await getApiKey('finnhub_key')
  if (!key) throw new Error('Finnhub API key is not configured')
  if (!['stock', 'etf', 'mutual_fund', 'bond'].includes(investment.type)) {
    throw new Error(`Finnhub stock quotes do not support ${investment.type}`)
  }
  const instrumentId = selection.instrumentId.trim().toUpperCase()
  const exchange = selection.exchange.trim()
  if (!instrumentId || !exchange) throw new Error('Exact Finnhub symbol and exchange are required')

  const metadataParams = new URLSearchParams({ exchange, token: key })
  const symbols = (await getJson(
    `https://finnhub.io/api/v1/stock/symbol?${metadataParams.toString()}`,
    'Finnhub'
  )) as Array<Record<string, unknown>>
  const matches = (Array.isArray(symbols) ? symbols : []).filter(
    (candidate) =>
      String(candidate.symbol ?? '')
        .trim()
        .toUpperCase() === instrumentId && providerTypeMatches(investment.type, candidate.type)
  )
  if (matches.length !== 1) throw new Error('Finnhub identity is ambiguous or unmatched')
  const quoteCurrency = normalizeCurrency(String(matches[0].currency ?? ''))
  if (!quoteCurrency) throw new Error('Finnhub symbol metadata did not provide price currency')
  if (selection.quoteCurrency && normalizeCurrency(selection.quoteCurrency) !== quoteCurrency) {
    throw new Error('Finnhub price currency does not match the requested identity')
  }

  const quoteParams = new URLSearchParams({ symbol: instrumentId, token: key })
  const quote = (await getJson(
    `https://finnhub.io/api/v1/quote?${quoteParams.toString()}`,
    'Finnhub'
  )) as Record<string, unknown>
  const unitPriceDecimal = positiveProviderPrice(quote.c)
  if (!unitPriceDecimal) throw new Error('Finnhub returned an invalid or zero quote')
  const identity: InstrumentIdentity = {
    assetType: investment.type,
    provider: 'finnhub',
    instrumentId,
    exchange,
    quoteCurrency,
  }
  return {
    ...identity,
    instrumentKey: instrumentIdentityKey(identity),
    unitPriceDecimal,
    quoteDate: new Date().toISOString().split('T')[0],
  }
}

async function fetchCoinGecko(
  investment: Investment,
  selection: PriceIdentitySelection
): Promise<PriceQuote> {
  if (investment.type !== 'crypto') throw new Error('CoinGecko is only valid for crypto holdings')
  const instrumentId = selection.instrumentId.trim().toLowerCase()
  const quoteCurrency = normalizeCurrency(selection.quoteCurrency)
  if (!instrumentId || !quoteCurrency || quoteCurrency === 'CRYPTO') {
    throw new Error('CoinGecko requires an exact coin ID and supported quote currency')
  }
  const supported = (await getJson(
    'https://api.coingecko.com/api/v3/simple/supported_vs_currencies',
    'CoinGecko'
  )) as unknown[]
  if (!Array.isArray(supported) || !supported.includes(quoteCurrency.toLowerCase())) {
    throw new Error(`CoinGecko does not support quote currency ${quoteCurrency}`)
  }
  const coins = (await getJson(
    'https://api.coingecko.com/api/v3/coins/list',
    'CoinGecko'
  )) as Array<{
    id?: unknown
  }>
  if (!Array.isArray(coins) || coins.filter((coin) => coin.id === instrumentId).length !== 1) {
    throw new Error('CoinGecko coin ID is unmatched')
  }
  const params = new URLSearchParams({
    ids: instrumentId,
    vs_currencies: quoteCurrency.toLowerCase(),
    precision: 'full',
    include_last_updated_at: 'true',
  })
  const result = (await getJson(
    `https://api.coingecko.com/api/v3/simple/price?${params.toString()}`,
    'CoinGecko'
  )) as Record<string, Record<string, unknown>>
  const unitPriceDecimal = positiveProviderPrice(
    result[instrumentId]?.[quoteCurrency.toLowerCase()]
  )
  if (!unitPriceDecimal) throw new Error('CoinGecko returned an invalid or zero quote')
  const identity: InstrumentIdentity = {
    assetType: 'crypto',
    provider: 'coingecko',
    instrumentId,
    exchange: selection.exchange.trim(),
    quoteCurrency,
  }
  return {
    ...identity,
    instrumentKey: instrumentIdentityKey(identity),
    unitPriceDecimal,
    quoteDate: new Date().toISOString().split('T')[0],
  }
}

export async function fetchVerifiedPrice(
  investment: Investment,
  selection: PriceIdentitySelection
): Promise<PriceQuote> {
  if (selection.provider === 'manual') throw new Error('Manual prices are entered explicitly')
  if (investment.type === 'cetes' || investment.type === 'other') {
    throw new Error(
      `No verified live provider is supported for ${investment.type}; use a manual price`
    )
  }
  if (selection.provider === 'alpha_vantage') return fetchAlphaVantage(investment, selection)
  if (selection.provider === 'finnhub') return fetchFinnhub(investment, selection)
  if (selection.provider === 'coingecko') return fetchCoinGecko(investment, selection)
  throw new Error('Unsupported price provider')
}

export function fetchAllCurrentPrices(investments: Investment[]): Promise<Map<string, PriceQuote>>
export function fetchAllCurrentPrices(
  investments: Investment[],
  selections: ReadonlyMap<string, PriceIdentitySelection>
): Promise<PriceRefreshResult>
export async function fetchAllCurrentPrices(
  investments: Investment[],
  selections?: ReadonlyMap<string, PriceIdentitySelection>
): Promise<PriceRefreshResult | Map<string, PriceQuote>> {
  const quotes = new Map<string, PriceQuote>()
  const failures: PriceRefreshFailure[] = []
  for (const investment of investments) {
    const selection = selections?.get(investment.id)
    if (!selection || selection.provider === 'manual') {
      failures.push({
        investmentId: investment.id,
        symbol: investment.symbol,
        reason:
          'No validated provider identity is selected; prior verified/manual price was preserved.',
      })
      continue
    }
    try {
      quotes.set(investment.id, await fetchVerifiedPrice(investment, selection))
    } catch (error) {
      failures.push({
        investmentId: investment.id,
        symbol: investment.symbol,
        reason: error instanceof Error ? error.message : 'Price refresh failed',
      })
    }
  }
  return selections ? { quotes, failures } : quotes
}

type LegacyPriceQuote = { price: number; quoteCurrency: string }

export async function savePricesToDB(
  prices: Map<string, PriceQuote | LegacyPriceQuote>
): Promise<void> {
  for (const [investmentId, candidate] of prices) {
    if (!('instrumentKey' in candidate)) continue
    const quote = candidate
    if (!isVerifiedInstrumentPrice(quote)) continue
    await execute(
      `INSERT INTO instrument_prices
       (id, instrument_key, asset_type, provider, instrument_id, exchange, quote_currency, unit_price_decimal, quote_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instrument_key, quote_date) DO UPDATE SET
         unit_price_decimal = excluded.unit_price_decimal,
         created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      [
        generateId(),
        quote.instrumentKey,
        quote.assetType,
        quote.provider,
        quote.instrumentId,
        quote.exchange,
        quote.quoteCurrency,
        quote.unitPriceDecimal,
        quote.quoteDate,
      ]
    )
    await execute('UPDATE investments SET instrument_key = ?, updated_at = ? WHERE id = ?', [
      quote.instrumentKey,
      new Date().toISOString(),
      investmentId,
    ])
  }
}
