import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import type { Account, Investment } from '@/types/database'
import { useCurrencyStore } from './currency-store'
import dayjs from 'dayjs'

// ── Types ────────��─────────────────────────────────────────────────────────

interface AccountBreakdown {
  id: string
  name: string
  type: string
  currency: string
  balance: number // centavos
  convertedBalance: number | null
}

interface NetWorthSnapshot {
  id: string
  date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
  total_investments: number
  breakdown_json: string
  currency: string | null
  created_at: string
}

interface NetWorthChartPoint {
  date: string
  netWorth: number // centavos
  assets: number
  liabilities: number
}

interface NetWorthState {
  // Current calculated values (centavos)
  totalAssets: number
  totalLiabilities: number
  totalInvestments: number
  netWorth: number
  totalsComplete: boolean
  preferredCurrency: string
  missingCurrencies: string[]
  assetBreakdown: AccountBreakdown[]
  liabilityBreakdown: AccountBreakdown[]

  // Historical data
  history: NetWorthChartPoint[]

  isLoading: boolean

  /** Calculate current net worth from accounts + investments */
  calculateCurrent: () => Promise<void>

  /** Take a snapshot for today (upserts — one per day) */
  takeSnapshot: () => Promise<void>

  /** Load historical snapshots for charting */
  loadHistory: (period: string) => Promise<void>

  /** Combined: calculate, snapshot, load history */
  refresh: (period?: string) => Promise<void>
}

// ── Store ───────────────────────────────���──────────────────────────────���───

let netWorthRequestId = 0

export const useNetWorthStore = create<NetWorthState>((set, get) => ({
  totalAssets: 0,
  totalLiabilities: 0,
  totalInvestments: 0,
  netWorth: 0,
  totalsComplete: true,
  preferredCurrency: 'USD',
  missingCurrencies: [],
  assetBreakdown: [],
  liabilityBreakdown: [],
  history: [],
  isLoading: false,

  calculateCurrent: async () => {
    const accounts = await query<Account>(
      'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY type, name'
    )

    const investments = await query<
      Investment & { latest_price: number | null; latest_price_currency: string | null }
    >(
      `SELECT i.*,
              (SELECT sp.price FROM stock_prices sp WHERE sp.symbol = i.symbol ORDER BY sp.date DESC LIMIT 1) as latest_price,
              (SELECT sp.quote_currency FROM stock_prices sp WHERE sp.symbol = i.symbol ORDER BY sp.date DESC LIMIT 1) as latest_price_currency
       FROM investments i
       ORDER BY i.name`
    )

    await useCurrencyStore
      .getState()
      .loadRates()
      .catch(() => {})
    const currencyState = useCurrencyStore.getState()
    const missingCurrencies = new Set<string>()
    const convert = (amountCentavos: number, currency: string): number | null => {
      const result = currencyState.convertToPreferred(amountCentavos, currency)
      if (result.complete) return result.amountCentavos
      for (const missing of result.missingCurrencies) missingCurrencies.add(missing)
      if (result.reason === 'invalid_currency_data') missingCurrencies.add(currency || 'unknown')
      return null
    }

    let totalAssets = 0
    let totalLiabilities = 0
    let totalInvestments = 0
    const assetBreakdown: AccountBreakdown[] = []
    const liabilityBreakdown: AccountBreakdown[] = []

    for (const acc of accounts) {
      const item: AccountBreakdown = {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        balance: acc.balance,
        convertedBalance: null,
      }

      const convertedBalance = convert(Math.abs(acc.balance), acc.currency)
      item.convertedBalance = convertedBalance
      if (acc.type === 'credit_card') {
        if (convertedBalance !== null) totalLiabilities += convertedBalance
        liabilityBreakdown.push(item)
      } else {
        if (convertedBalance !== null) {
          totalAssets += acc.balance < 0 ? -convertedBalance : convertedBalance
        }
        assetBreakdown.push(item)
      }
    }

    for (const inv of investments) {
      const currentPrice = inv.latest_price ?? inv.avg_cost_basis
      const priceCurrency = inv.latest_price_currency ?? inv.currency
      const value = Math.round(inv.shares * currentPrice)
      const convertedValue = convert(value, priceCurrency)
      if (convertedValue !== null) totalInvestments += convertedValue
    }

    const totalsComplete = missingCurrencies.size === 0
    totalAssets += totalInvestments

    set({
      totalAssets: totalsComplete ? totalAssets : 0,
      totalLiabilities: totalsComplete ? totalLiabilities : 0,
      totalInvestments: totalsComplete ? totalInvestments : 0,
      netWorth: totalsComplete ? totalAssets - totalLiabilities : 0,
      totalsComplete,
      preferredCurrency: currencyState.preferredCurrency,
      missingCurrencies: [...missingCurrencies].sort(),
      assetBreakdown,
      liabilityBreakdown,
    })
  },

  takeSnapshot: async () => {
    const {
      totalAssets,
      totalLiabilities,
      netWorth,
      totalInvestments,
      assetBreakdown,
      liabilityBreakdown,
      totalsComplete,
      preferredCurrency,
    } = get()
    if (!totalsComplete) return
    const today = dayjs().format('YYYY-MM-DD')

    const breakdown = JSON.stringify({
      assets: assetBreakdown.map((a) => ({ name: a.name, type: a.type, balance: a.balance })),
      liabilities: liabilityBreakdown.map((l) => ({
        name: l.name,
        type: l.type,
        balance: l.balance,
      })),
    })

    // Upsert: replace if a snapshot for today already exists
    const existing = await query<{ id: string }>(
      'SELECT id FROM net_worth_snapshots WHERE date = ?',
      [today]
    )

    if (existing.length > 0) {
      await execute(
        `UPDATE net_worth_snapshots
         SET total_assets = ?, total_liabilities = ?, net_worth = ?, total_investments = ?, breakdown_json = ?, currency = ?
         WHERE date = ?`,
        [
          totalAssets,
          totalLiabilities,
          netWorth,
          totalInvestments,
          breakdown,
          preferredCurrency,
          today,
        ]
      )
    } else {
      await execute(
        `INSERT INTO net_worth_snapshots (id, date, total_assets, total_liabilities, net_worth, total_investments, breakdown_json, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId(),
          today,
          totalAssets,
          totalLiabilities,
          netWorth,
          totalInvestments,
          breakdown,
          preferredCurrency,
        ]
      )
    }
  },

  loadHistory: async (period: string) => {
    const now = dayjs()
    let startDate: string

    switch (period) {
      case '3m':
        startDate = now.subtract(3, 'month').format('YYYY-MM-DD')
        break
      case '6m':
        startDate = now.subtract(6, 'month').format('YYYY-MM-DD')
        break
      case '1y':
        startDate = now.subtract(1, 'year').format('YYYY-MM-DD')
        break
      case 'all':
      default:
        startDate = '1970-01-01'
        break
    }

    const rows = await query<NetWorthSnapshot>(
      'SELECT * FROM net_worth_snapshots WHERE date >= ? AND currency = ? ORDER BY date ASC',
      [startDate, get().preferredCurrency]
    )

    const history: NetWorthChartPoint[] = rows.map((r) => ({
      date: r.date,
      netWorth: r.net_worth,
      assets: r.total_assets,
      liabilities: r.total_liabilities,
    }))

    set({ history })
  },

  refresh: async (period = '1y') => {
    const requestId = ++netWorthRequestId
    set({ isLoading: true })
    try {
      await get().calculateCurrent()
      await get().takeSnapshot()
      await get().loadHistory(period)
    } finally {
      if (requestId === netWorthRequestId) {
        set({ isLoading: false })
      }
    }
  },
}))
