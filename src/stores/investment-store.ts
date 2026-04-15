import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Investment, StockPrice } from '@/types/database'
import type { InvestmentType, CurrencyCode } from '@/types/common'

export interface InvestmentFormData {
  symbol: string
  name: string
  type: InvestmentType
  shares: number
  avgCost: number
  currency: CurrencyCode
  accountId?: string
  notes?: string
}

export interface InvestmentWithPrice extends Investment {
  currentPrice: number | null
  marketValue: number | null
  gainLoss: number | null
  gainLossPercent: number | null
  lastPriceDate: string | null
}

export interface PortfolioSummary {
  totalMarketValue: number
  totalCostBasis: number
  totalGainLoss: number
  totalGainLossPercent: number
  byType: Record<string, { marketValue: number; gainLoss: number; count: number }>
}

export interface PricePoint {
  date: string
  price: number
}

interface InvestmentState {
  investments: InvestmentWithPrice[]
  portfolioSummary: PortfolioSummary
  priceHistory: Map<string, PricePoint[]>
  isLoading: boolean
  fetchError: string | null
  error: string | null
  lastPriceFetch: string | null

  fetch: () => Promise<void>
  add: (data: InvestmentFormData) => Promise<void>
  update: (id: string, data: InvestmentFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => InvestmentWithPrice | undefined
  fetchPriceHistory: (symbol: string, days?: number) => Promise<PricePoint[]>
  calculatePortfolioSummary: () => void
  setLastPriceFetch: (date: string) => void
}

const EMPTY_SUMMARY: PortfolioSummary = {
  totalMarketValue: 0,
  totalCostBasis: 0,
  totalGainLoss: 0,
  totalGainLossPercent: 0,
  byType: {},
}

export const useInvestmentStore = create<InvestmentState>((set, get) => ({
  investments: [],
  portfolioSummary: EMPTY_SUMMARY,
  priceHistory: new Map(),
  isLoading: false,
  fetchError: null,
  error: null,
  lastPriceFetch: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const rows = await query<
        Investment & { latest_price: number | null; latest_price_date: string | null }
      >(
        `SELECT i.*,
                sp.price as latest_price,
                sp.date as latest_price_date
         FROM investments i
         LEFT JOIN (
           SELECT symbol, price, date,
                  ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) as rn
           FROM stock_prices
         ) sp ON sp.symbol = i.symbol AND sp.rn = 1
         ORDER BY i.created_at DESC`
      )

      const investments: InvestmentWithPrice[] = rows.map((row) => {
        const currentPrice = row.latest_price
        const avgCostBasis = row.avg_cost_basis
        const marketValue = currentPrice !== null ? Math.round(row.shares * currentPrice) : null
        const costBasis = Math.round(row.shares * avgCostBasis)
        const gainLoss = marketValue !== null ? marketValue - costBasis : null
        const gainLossPercent =
          gainLoss !== null && costBasis > 0
            ? Math.round((gainLoss / costBasis) * 10000) / 100
            : null

        return {
          id: row.id,
          account_id: row.account_id,
          symbol: row.symbol,
          name: row.name,
          type: row.type,
          shares: row.shares,
          avg_cost_basis: row.avg_cost_basis,
          currency: row.currency,
          notes: row.notes,
          created_at: row.created_at,
          updated_at: row.updated_at,
          currentPrice,
          marketValue,
          gainLoss,
          gainLossPercent,
          lastPriceDate: row.latest_price_date,
        }
      })

      set({ investments, fetchError: null, error: null })
      get().calculatePortfolioSummary()
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data) => {
    set({ error: null })
    try {
      const id = generateId()
      const now = new Date().toISOString()
      await execute(
        `INSERT INTO investments (id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.accountId ?? null,
          data.symbol.toUpperCase(),
          data.name,
          data.type,
          data.shares,
          toCentavos(data.avgCost),
          data.currency,
          data.notes ?? null,
          now,
          now,
        ]
      )
      // Refresh optimistically; don't fail the mutation if refresh fails
      try {
        await get().fetch()
      } catch {
        // Silent refresh failure - data was written successfully
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      const now = new Date().toISOString()
      await execute(
        `UPDATE investments SET account_id = ?, symbol = ?, name = ?, type = ?, shares = ?, avg_cost_basis = ?, currency = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
          data.accountId ?? null,
          data.symbol.toUpperCase(),
          data.name,
          data.type,
          data.shares,
          toCentavos(data.avgCost),
          data.currency,
          data.notes ?? null,
          now,
          id,
        ]
      )
      // Refresh optimistically; don't fail the mutation if refresh fails
      try {
        await get().fetch()
      } catch {
        // Silent refresh failure - data was written successfully
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      await execute('DELETE FROM investments WHERE id = ?', [id])
      // Refresh optimistically; don't fail the mutation if refresh fails
      try {
        await get().fetch()
      } catch {
        // Silent refresh failure - data was deleted successfully
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  getById: (id) => {
    return get().investments.find((i) => i.id === id)
  },

  fetchPriceHistory: async (symbol, days = 90) => {
    set({ error: null })
    try {
      const rows = await query<StockPrice>(
        `SELECT * FROM stock_prices WHERE symbol = ? ORDER BY date DESC LIMIT ?`,
        [symbol.toUpperCase(), days]
      )
      const points: PricePoint[] = rows.map((r) => ({ date: r.date, price: r.price })).reverse()

      set((s) => {
        const newMap = new Map(s.priceHistory)
        newMap.set(symbol.toUpperCase(), points)
        return { priceHistory: newMap }
      })
      return points
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  calculatePortfolioSummary: () => {
    const { investments } = get()
    let totalMarketValue = 0
    let totalCostBasis = 0
    const byType: PortfolioSummary['byType'] = {}

    for (const inv of investments) {
      const costBasis = Math.round(inv.shares * inv.avg_cost_basis)
      const marketValue = inv.marketValue ?? costBasis
      const gainLoss = marketValue - costBasis

      totalMarketValue += marketValue
      totalCostBasis += costBasis

      if (!byType[inv.type]) {
        byType[inv.type] = { marketValue: 0, gainLoss: 0, count: 0 }
      }
      byType[inv.type].marketValue += marketValue
      byType[inv.type].gainLoss += gainLoss
      byType[inv.type].count += 1
    }

    const totalGainLoss = totalMarketValue - totalCostBasis
    const totalGainLossPercent =
      totalCostBasis > 0 ? Math.round((totalGainLoss / totalCostBasis) * 10000) / 100 : 0

    set({
      portfolioSummary: {
        totalMarketValue,
        totalCostBasis,
        totalGainLoss,
        totalGainLossPercent,
        byType,
      },
    })
  },

  setLastPriceFetch: (date) => {
    set({ lastPriceFetch: date })
  },
}))
