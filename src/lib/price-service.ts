import { load } from '@tauri-apps/plugin-store'
import { execute, query } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Investment } from '@/types/database'

export interface PriceResult {
  symbol: string
  price: number // centavos
  currency: string
}

export interface PricePoint {
  date: string
  price: number // centavos
}

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

export async function fetchCurrentPrice(
  symbol: string,
  type: 'stock' | 'crypto'
): Promise<number> {
  if (type === 'crypto') {
    return fetchCryptoPrice(symbol)
  }
  return fetchStockPrice(symbol)
}

async function fetchStockPrice(symbol: string): Promise<number> {
  const apiKey = await getAlphaVantageKey()
  if (!apiKey) throw new Error('Alpha Vantage API key not configured')

  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`)

  const data = await res.json()
  const quote = data['Global Quote']
  if (!quote || !quote['05. price']) {
    throw new Error(`No price data for ${symbol}`)
  }

  return toCentavos(parseFloat(quote['05. price']))
}

async function fetchCryptoPrice(symbol: string): Promise<number> {
  const id = getCryptoId(symbol)
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`)

  const data = await res.json()
  if (!data[id]?.usd) {
    throw new Error(`No price data for ${symbol} (${id})`)
  }

  return toCentavos(data[id].usd)
}

export async function fetchHistoricalPrices(
  symbol: string,
  type: 'stock' | 'crypto',
  days: number = 90
): Promise<PricePoint[]> {
  if (type === 'crypto') {
    return fetchCryptoHistory(symbol, days)
  }
  return fetchStockHistory(symbol)
}

async function fetchStockHistory(symbol: string): Promise<PricePoint[]> {
  const apiKey = await getAlphaVantageKey()
  if (!apiKey) throw new Error('Alpha Vantage API key not configured')

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`)

  const data = await res.json()
  const timeSeries = data['Time Series (Daily)']
  if (!timeSeries) {
    throw new Error(`No historical data for ${symbol}`)
  }

  return Object.entries(timeSeries)
    .map(([date, values]) => ({
      date,
      price: toCentavos(parseFloat((values as Record<string, string>)['4. close'])),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

async function fetchCryptoHistory(symbol: string, days: number): Promise<PricePoint[]> {
  const id = getCryptoId(symbol)
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`)

  const data = await res.json()
  if (!data.prices) {
    throw new Error(`No historical data for ${symbol}`)
  }

  return (data.prices as [number, number][]).map(([timestamp, price]) => ({
    date: new Date(timestamp).toISOString().split('T')[0],
    price: toCentavos(price),
  }))
}

export async function fetchAllCurrentPrices(
  investments: Investment[]
): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  const seen = new Set<string>()

  for (const inv of investments) {
    if (seen.has(inv.symbol)) continue
    seen.add(inv.symbol)

    const isCrypto = inv.type === 'crypto'
    try {
      const price = await fetchCurrentPrice(inv.symbol, isCrypto ? 'crypto' : 'stock')
      prices.set(inv.symbol, price)
      // Rate limit: small delay between requests
      await new Promise((r) => setTimeout(r, isCrypto ? 200 : 1200))
    } catch (err) {
      console.warn(`[PriceService] Failed to fetch ${inv.symbol}:`, err)
    }
  }

  return prices
}

export async function savePricesToDB(prices: Map<string, number>, currency = 'USD'): Promise<void> {
  const today = new Date().toISOString().split('T')[0]

  for (const [symbol, price] of prices) {
    const existing = await query<{ id: string }>(
      'SELECT id FROM stock_prices WHERE symbol = ? AND date = ?',
      [symbol, today]
    )

    if (existing.length > 0) {
      await execute('UPDATE stock_prices SET price = ? WHERE id = ?', [price, existing[0].id])
    } else {
      const id = generateId()
      await execute(
        'INSERT INTO stock_prices (id, symbol, price, currency, date) VALUES (?, ?, ?, ?, ?)',
        [id, symbol, price, currency, today]
      )
    }
  }
}

export { getAlphaVantageKey, getFinnhubKey }
