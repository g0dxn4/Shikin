import { load } from '@/lib/storage'
import { execute, query } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Investment } from '@/types/database'

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

function getCryptoId(symbol: string): string {
  return CRYPTO_ID_MAP[symbol.toUpperCase()] || symbol.toLowerCase()
}

async function fetchCurrentPrice(symbol: string, type: 'stock' | 'crypto'): Promise<number> {
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
