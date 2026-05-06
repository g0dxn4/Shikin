import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import type { Account, Investment } from '@/types/database'
import dayjs from 'dayjs'

// ── Types ────────��─────────────────────────────────────────────────────────

interface AccountBreakdown {
  id: string
  name: string
  type: string
  currency: string
  balance: number // centavos
}

interface NetWorthSnapshot {
  id: string
  date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
  total_investments: number
  breakdown_json: string
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
  assetBreakdown: [],
  liabilityBreakdown: [],
  history: [],
  isLoading: false,

  calculateCurrent: async () => {
    const accounts = await query<Account>(
      'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY type, name'
    )

    const investments = await query<Investment & { latest_price: number | null }>(
      `SELECT i.*,
              (SELECT sp.price FROM stock_prices sp WHERE sp.symbol = i.symbol ORDER BY sp.date DESC LIMIT 1) as latest_price
       FROM investments i
       ORDER BY i.name`
    )

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
      }

      if (acc.type === 'credit_card') {
        totalLiabilities += Math.abs(acc.balance)
        liabilityBreakdown.push(item)
      } else {
        totalAssets += acc.balance
        assetBreakdown.push(item)
      }
    }

    for (const inv of investments) {
      const currentPrice = inv.latest_price ?? inv.avg_cost_basis
      const value = Math.round(inv.shares * currentPrice)
      totalInvestments += value
    }

    totalAssets += totalInvestments

    set({
      totalAssets,
      totalLiabilities,
      totalInvestments,
      netWorth: totalAssets - totalLiabilities,
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
    } = get()
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
         SET total_assets = ?, total_liabilities = ?, net_worth = ?, total_investments = ?, breakdown_json = ?
         WHERE date = ?`,
        [totalAssets, totalLiabilities, netWorth, totalInvestments, breakdown, today]
      )
    } else {
      await execute(
        `INSERT INTO net_worth_snapshots (id, date, total_assets, total_liabilities, net_worth, total_investments, breakdown_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [generateId(), today, totalAssets, totalLiabilities, netWorth, totalInvestments, breakdown]
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
      'SELECT * FROM net_worth_snapshots WHERE date >= ? ORDER BY date ASC',
      [startDate]
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
