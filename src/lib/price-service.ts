import { load } from '@/lib/storage'
import { execute, query } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Investment } from '@/types/database'
import type { InvestmentType } from '@/types/common'

const CRYPTO_ID_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  UNI: 'uniswap',
  DOGE: 'dogecoin',
  XRP: 'ripple',
  LTC: 'litecoin',
  ATOM: 'cosmos',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
}

async function getAlphaVantageKey(): Promise<string | null> {
  try {
    const store = await load('settings.json')
    return ((await store.get('alpha_vantage_key')) as string) || null
  } catch {
    return null
  }
}

async function getFinnhubKey(): Promise<string | null> {
  try {
    const store = await load('settings.json')
    return ((await store.get('finnhub_key')) as string) || null
  } catch {
    return null
  }
}

function getCryptoId(symbol: string): string {
  return CRYPTO_ID_MAP[symbol.toUpperCase()] || symbol.toLowerCase()
}

export interface PriceQuote {
  price: number
  quoteCurrency: string
}

async function fetchCurrentPrice(
  symbol: string,
  type: InvestmentType,
  preferredCurrency: string
): Promise<PriceQuote> {
  if (type === 'crypto') {
    return fetchCryptoPrice(symbol, preferredCurrency)
  }

  if (!canTryMarketDataProvider(type)) {
    throw new Error(`No live price provider configured for ${type} assets`)
  }

  const quoteCurrency = preferredCurrency.trim().toUpperCase() || 'USD'
  return { price: await fetchMarketPrice(symbol), quoteCurrency }
}

function canTryMarketDataProvider(type: InvestmentType): boolean {
  return ['stock', 'etf', 'mutual_fund', 'bond', 'cetes'].includes(type)
}

function parsePositivePrice(value: unknown): number | null {
  const price = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(price) && price > 0 ? price : null
}

async function fetchMarketPrice(symbol: string): Promise<number> {
  const errors: string[] = []
  const alphaVantageKey = await getAlphaVantageKey()
  if (alphaVantageKey) {
    try {
      return await fetchAlphaVantagePrice(symbol, alphaVantageKey)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  const finnhubKey = await getFinnhubKey()
  if (finnhubKey) {
    try {
      return await fetchFinnhubPrice(symbol, finnhubKey)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (!alphaVantageKey && !finnhubKey) {
    throw new Error('No market data API key configured')
  }

  throw new Error(
    `No valid market price for ${symbol}${errors.length ? `: ${errors.join('; ')}` : ''}`
  )
}

async function fetchAlphaVantagePrice(symbol: string, apiKey: string): Promise<number> {
  const params = new URLSearchParams({
    function: 'GLOBAL_QUOTE',
    symbol,
    apikey: apiKey,
  })
  const url = `https://www.alphavantage.co/query?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`)

  const data = await res.json()
  const quote = data['Global Quote']
  const price = parsePositivePrice(quote?.['05. price'])
  if (!price) {
    throw new Error(`No price data for ${symbol}`)
  }

  return toCentavos(price)
}

async function fetchFinnhubPrice(symbol: string, apiKey: string): Promise<number> {
  const params = new URLSearchParams({ symbol, token: apiKey })
  const url = `https://finnhub.io/api/v1/quote?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Finnhub error: ${res.status}`)

  const data = await res.json()
  const price = parsePositivePrice(data?.c)
  if (!price) {
    throw new Error(`No Finnhub quote for ${symbol}`)
  }

  return toCentavos(price)
}

async function fetchCryptoPrice(symbol: string, preferredCurrency: string): Promise<PriceQuote> {
  const id = getCryptoId(symbol)
  const quoteCurrency = preferredCurrency.trim().toUpperCase() || 'USD'
  const quoteKey = quoteCurrency.toLowerCase()
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${encodeURIComponent(quoteKey)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`)

  const data = await res.json()
  const price = parsePositivePrice(data[id]?.[quoteKey])
  if (!price) {
    throw new Error(`No ${quoteCurrency} price data for ${symbol} (${id})`)
  }

  return { price: toCentavos(price), quoteCurrency }
}

export async function fetchAllCurrentPrices(
  investments: Investment[]
): Promise<Map<string, PriceQuote>> {
  const prices = new Map<string, PriceQuote>()
  const seen = new Set<string>()

  for (const inv of investments) {
    if (seen.has(inv.symbol)) continue
    seen.add(inv.symbol)

    try {
      const quote = await fetchCurrentPrice(inv.symbol, inv.type, inv.currency)
      prices.set(inv.symbol, quote)
      // Rate limit: small delay between requests
      await new Promise((r) => setTimeout(r, inv.type === 'crypto' ? 200 : 1200))
    } catch (err) {
      console.warn(`[PriceService] Failed to fetch ${inv.symbol}:`, err)
    }
  }

  return prices
}

export async function savePricesToDB(prices: Map<string, PriceQuote>): Promise<void> {
  const today = new Date().toISOString().split('T')[0]

  for (const [symbol, quote] of prices) {
    const quoteCurrency = quote.quoteCurrency.trim().toUpperCase()
    const existing = await query<{ id: string }>(
      'SELECT id FROM stock_prices WHERE symbol = ? AND date = ?',
      [symbol, today]
    )

    if (existing.length > 0) {
      await execute(
        'UPDATE stock_prices SET price = ?, currency = ?, quote_currency = ? WHERE id = ?',
        [quote.price, quoteCurrency, quoteCurrency, existing[0].id]
      )
    } else {
      const id = generateId()
      await execute(
        'INSERT INTO stock_prices (id, symbol, price, currency, quote_currency, date) VALUES (?, ?, ?, ?, ?, ?)',
        [id, symbol, quote.price, quoteCurrency, quoteCurrency, today]
      )
    }
  }
}
