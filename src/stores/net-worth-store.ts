import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { readOwnershipValuation } from '@/lib/valuation-read'
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
  totalAssets: number | null
  totalLiabilities: number | null
  totalInvestments: number | null
  netWorth: number | null
  totalsComplete: boolean
  preferredCurrency: string
  missingCurrencies: string[]
  unresolvedAccountIds: string[]
  incompleteHoldingIds: string[]
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
let netWorthReadQueue: Promise<void> = Promise.resolve()

function enqueueRead(task: () => Promise<void>): Promise<void> {
  const pending = netWorthReadQueue.then(task)
  netWorthReadQueue = pending.catch(() => {})
  return pending
}

export const useNetWorthStore = create<NetWorthState>((set, get) => ({
  totalAssets: 0,
  totalLiabilities: 0,
  totalInvestments: 0,
  netWorth: 0,
  totalsComplete: true,
  preferredCurrency: 'USD',
  missingCurrencies: [],
  unresolvedAccountIds: [],
  incompleteHoldingIds: [],
  assetBreakdown: [],
  liabilityBreakdown: [],
  history: [],
  isLoading: false,

  calculateCurrent: () =>
    enqueueRead(async () => {
      await useCurrencyStore
        .getState()
        .loadRates()
        .catch(() => {})
      const currencyState = useCurrencyStore.getState()
      const valuation = await readOwnershipValuation({
        targetCurrency: currencyState.preferredCurrency,
        rates: currencyState.rates,
      })
      const assetBreakdown: AccountBreakdown[] = []
      const liabilityBreakdown: AccountBreakdown[] = []

      for (const account of valuation.accounts) {
        const convertedAsset = currencyState.convertToPreferred(
          account.assetCentavos,
          account.currency
        )
        const convertedLiability = currencyState.convertToPreferred(
          account.liabilityCentavos,
          account.currency
        )
        if (account.assetCentavos > 0 || account.type !== 'credit_card') {
          assetBreakdown.push({
            id: account.id,
            name: account.name,
            type: account.type,
            currency: account.currency,
            balance: account.rawBalanceCentavos,
            convertedBalance:
              account.included && convertedAsset.complete ? convertedAsset.amountCentavos : null,
          })
        }
        if (account.liabilityCentavos > 0) {
          liabilityBreakdown.push({
            id: account.id,
            name: account.name,
            type: account.type,
            currency: account.currency,
            balance: account.rawBalanceCentavos,
            convertedBalance:
              account.included && convertedLiability.complete
                ? convertedLiability.amountCentavos
                : null,
          })
        }
      }

      set({
        totalAssets: valuation.totalAssetsCentavos,
        totalLiabilities: valuation.totalLiabilitiesCentavos,
        totalInvestments: valuation.totalInvestmentsCentavos,
        netWorth: valuation.netWorthCentavos,
        totalsComplete: valuation.complete,
        preferredCurrency: valuation.targetCurrency,
        missingCurrencies: valuation.missingCurrencies,
        unresolvedAccountIds: valuation.unresolvedAccountIds,
        incompleteHoldingIds: valuation.incompleteHoldingIds,
        assetBreakdown,
        liabilityBreakdown,
      })
    }),

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
    if (
      !totalsComplete ||
      totalAssets === null ||
      totalLiabilities === null ||
      netWorth === null ||
      totalInvestments === null
    )
      return
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
