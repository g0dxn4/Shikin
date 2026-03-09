import { query } from '@/lib/database'
import { fetchAllCurrentPrices, savePricesToDB } from '@/lib/price-service'
import { useInvestmentStore } from '@/stores/investment-store'
import type { Investment } from '@/types/database'

const STOCK_INTERVAL = 4 * 60 * 60 * 1000 // 4 hours
const CRYPTO_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours

let stockTimer: ReturnType<typeof setInterval> | null = null
let cryptoTimer: ReturnType<typeof setInterval> | null = null

function isMarketHours(): boolean {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const hour = et.getHours()
  const minute = et.getMinutes()
  const time = hour * 60 + minute

  // Weekdays only, 9:30 AM - 4:00 PM ET
  return day >= 1 && day <= 5 && time >= 570 && time <= 960
}

async function getInvestments(): Promise<Investment[]> {
  return query<Investment>('SELECT * FROM investments')
}

async function getLastPriceDate(symbol: string): Promise<string | null> {
  const rows = await query<{ date: string }>(
    'SELECT date FROM stock_prices WHERE symbol = ? ORDER BY date DESC LIMIT 1',
    [symbol]
  )
  return rows.length > 0 ? rows[0].date : null
}

function isStale(lastDate: string | null, type: 'stock' | 'crypto'): boolean {
  if (!lastDate) return true

  const last = new Date(lastDate)
  const now = new Date()
  const diffMs = now.getTime() - last.getTime()

  if (type === 'crypto') {
    return diffMs > CRYPTO_INTERVAL
  }

  // For stocks, check if it's been more than 1 business day
  const diffDays = diffMs / (24 * 60 * 60 * 1000)
  const lastDay = last.getDay()
  // If last price was Friday, stale after Monday (3 days)
  if (lastDay === 5) return diffDays > 3
  // If Saturday, stale after Monday (2 days)
  if (lastDay === 6) return diffDays > 2
  return diffDays > 1.5
}

async function fetchStalePrices(): Promise<void> {
  const investments = await getInvestments()
  if (investments.length === 0) return

  const staleInvestments: Investment[] = []

  for (const inv of investments) {
    const lastDate = await getLastPriceDate(inv.symbol)
    const isCrypto = inv.type === 'crypto'
    if (isStale(lastDate, isCrypto ? 'crypto' : 'stock')) {
      staleInvestments.push(inv)
    }
  }

  if (staleInvestments.length === 0) return

  console.warn(
    `[PriceScheduler] Fetching prices for ${staleInvestments.length} stale investment(s)`
  )

  const prices = await fetchAllCurrentPrices(staleInvestments)
  if (prices.size > 0) {
    await savePricesToDB(prices)
    const now = new Date().toISOString()
    useInvestmentStore.getState().setLastPriceFetch(now)
    await useInvestmentStore.getState().fetch()
  }
}

function startStockScheduler(): void {
  if (stockTimer) return
  stockTimer = setInterval(async () => {
    if (!isMarketHours()) return
    const investments = await getInvestments()
    const stocks = investments.filter((i) => i.type !== 'crypto')
    if (stocks.length === 0) return

    const prices = await fetchAllCurrentPrices(stocks)
    if (prices.size > 0) {
      await savePricesToDB(prices)
      useInvestmentStore.getState().setLastPriceFetch(new Date().toISOString())
      await useInvestmentStore.getState().fetch()
    }
  }, STOCK_INTERVAL)
}

function startCryptoScheduler(): void {
  if (cryptoTimer) return
  cryptoTimer = setInterval(async () => {
    const investments = await getInvestments()
    const crypto = investments.filter((i) => i.type === 'crypto')
    if (crypto.length === 0) return

    const prices = await fetchAllCurrentPrices(crypto)
    if (prices.size > 0) {
      await savePricesToDB(prices)
      useInvestmentStore.getState().setLastPriceFetch(new Date().toISOString())
      await useInvestmentStore.getState().fetch()
    }
  }, CRYPTO_INTERVAL)
}

export async function initPriceScheduler(): Promise<void> {
  try {
    await fetchStalePrices()
  } catch (err) {
    console.warn('[PriceScheduler] Initial fetch failed:', err)
  }

  startStockScheduler()
  startCryptoScheduler()
}

export function stopPriceScheduler(): void {
  if (stockTimer) {
    clearInterval(stockTimer)
    stockTimer = null
  }
  if (cryptoTimer) {
    clearInterval(cryptoTimer)
    cryptoTimer = null
  }
}
