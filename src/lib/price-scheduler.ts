import { query } from '@/lib/database'
import {
  fetchAllCurrentPrices,
  savePricesToDB,
  type PriceIdentitySelection,
} from '@/lib/price-service'
import { useInvestmentStore } from '@/stores/investment-store'
import type { Investment } from '@/types/database'

const STOCK_INTERVAL = 4 * 60 * 60 * 1000
const CRYPTO_INTERVAL = 6 * 60 * 60 * 1000

let stockTimer: ReturnType<typeof setInterval> | null = null
let cryptoTimer: ReturnType<typeof setInterval> | null = null

type ScheduledInvestment = Investment & {
  price_provider: PriceIdentitySelection['provider'] | null
  price_instrument_id: string | null
  price_exchange: string | null
  price_quote_currency: string | null
  quote_date: string | null
}

function isMarketHours(): boolean {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const time = et.getHours() * 60 + et.getMinutes()
  return day >= 1 && day <= 5 && time >= 570 && time <= 960
}

async function getInvestments(): Promise<ScheduledInvestment[]> {
  return query<ScheduledInvestment>(
    `SELECT i.*,
            ip.provider AS price_provider,
            ip.instrument_id AS price_instrument_id,
            ip.exchange AS price_exchange,
            ip.quote_currency AS price_quote_currency,
            ip.quote_date
     FROM investments i
     LEFT JOIN instrument_prices ip ON ip.id = (
       SELECT candidate.id FROM instrument_prices candidate
       WHERE candidate.instrument_key = i.instrument_key
       ORDER BY candidate.quote_date DESC, candidate.created_at DESC, candidate.id DESC
       LIMIT 1
     )`
  )
}

export function isInvestmentPriceStale(lastDate: string | null, type: 'stock' | 'crypto'): boolean {
  if (!lastDate) return true
  const last = new Date(lastDate)
  const now = new Date()
  const diffMs = now.getTime() - last.getTime()
  if (type === 'crypto') return diffMs > CRYPTO_INTERVAL
  const diffDays = diffMs / (24 * 60 * 60 * 1000)
  const lastDay = last.getDay()
  if (lastDay === 5) return diffDays > 3
  if (lastDay === 6) return diffDays > 2
  return diffDays > 1.5
}

function selectionsFor(investments: ScheduledInvestment[]) {
  const selections = new Map<string, PriceIdentitySelection>()
  for (const investment of investments) {
    if (
      investment.price_provider &&
      investment.price_provider !== 'manual' &&
      investment.price_instrument_id &&
      investment.price_quote_currency
    ) {
      selections.set(investment.id, {
        provider: investment.price_provider,
        instrumentId: investment.price_instrument_id,
        exchange: investment.price_exchange ?? '',
        quoteCurrency: investment.price_quote_currency,
      })
    }
  }
  return selections
}

async function refresh(investments: ScheduledInvestment[]) {
  const result = await fetchAllCurrentPrices(investments, selectionsFor(investments))
  useInvestmentStore
    .getState()
    .setRefreshFailures(
      Object.fromEntries(result.failures.map((failure) => [failure.investmentId, failure.reason]))
    )
  if (result.quotes.size === 0) return
  await savePricesToDB(result.quotes)
  useInvestmentStore.getState().setLastPriceFetch(new Date().toISOString())
  await useInvestmentStore.getState().fetch()
}

async function fetchStalePrices(): Promise<void> {
  const investments = await getInvestments()
  const stale = investments.filter((investment) =>
    isInvestmentPriceStale(investment.quote_date, investment.type === 'crypto' ? 'crypto' : 'stock')
  )
  if (stale.length > 0) await refresh(stale)
}

function startStockScheduler(): void {
  if (stockTimer) return
  stockTimer = setInterval(async () => {
    if (!isMarketHours()) return
    const investments = (await getInvestments()).filter(
      (investment) => investment.type !== 'crypto'
    )
    if (investments.length > 0) await refresh(investments)
  }, STOCK_INTERVAL)
}

function startCryptoScheduler(): void {
  if (cryptoTimer) return
  cryptoTimer = setInterval(async () => {
    const investments = (await getInvestments()).filter(
      (investment) => investment.type === 'crypto'
    )
    if (investments.length > 0) await refresh(investments)
  }, CRYPTO_INTERVAL)
}

export async function initPriceScheduler(): Promise<void> {
  try {
    await fetchStalePrices()
  } catch (error) {
    console.warn('[PriceScheduler] Initial fetch failed:', error)
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
