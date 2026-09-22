import { convertDatedAmounts, FX_CURRENCIES } from '@shikin/finance-core/fx'
import dayjs from 'dayjs'
import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { readOwnershipValuation } from '@/lib/valuation-read'
import { useCurrencyStore } from './currency-store'
import {
  captureCurrencyAuthority,
  convertWithCurrencyAuthority,
  currencyAuthorityKey,
  valuationRatesWithCurrencyAuthority,
} from './currency-authority'

interface AccountBreakdown {
  id: string
  name: string
  type: string
  currency: string
  balance: number
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

export interface NetWorthChartPoint {
  date: string
  netWorth: number
  assets: number
  liabilities: number
}

interface NetWorthState {
  totalAssets: number | null
  totalLiabilities: number | null
  totalInvestments: number | null
  netWorth: number | null
  totalsComplete: boolean
  preferredCurrency: string | null
  missingCurrencies: string[]
  unresolvedAccountIds: string[]
  incompleteHoldingIds: string[]
  assetBreakdown: AccountBreakdown[]
  liabilityBreakdown: AccountBreakdown[]
  history: NetWorthChartPoint[]
  historyComplete: boolean
  historyMissingCurrencies: string[]
  historyNativeSnapshots: Array<{
    id: string
    date: string
    currency: string
    amountCentavos: number
  }>
  isLoading: boolean
  calculateCurrent: () => Promise<void>
  takeSnapshot: () => Promise<void>
  loadHistory: (period: string) => Promise<void>
  refresh: (period?: string) => Promise<void>
}

let netWorthRequestId = 0
let netWorthReadQueue: Promise<void> = Promise.resolve()
let netWorthStoreHasRefreshed = false
let latestHistoryPeriod = '1y'

function enqueueRead(task: () => Promise<void>): Promise<void> {
  const pending = netWorthReadQueue.then(task)
  netWorthReadQueue = pending.catch(() => {})
  return pending
}

function snapshotNativeEvidence(rows: readonly NetWorthSnapshot[]) {
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    currency: row.currency?.trim().toUpperCase() || 'UNKNOWN',
    amountCentavos: row.net_worth,
  }))
}

export const useNetWorthStore = create<NetWorthState>((set, get) => ({
  totalAssets: null,
  totalLiabilities: null,
  totalInvestments: null,
  netWorth: null,
  totalsComplete: false,
  preferredCurrency: null,
  missingCurrencies: [],
  unresolvedAccountIds: [],
  incompleteHoldingIds: [],
  assetBreakdown: [],
  liabilityBreakdown: [],
  history: [],
  historyComplete: false,
  historyMissingCurrencies: [],
  historyNativeSnapshots: [],
  isLoading: false,

  calculateCurrent: () =>
    enqueueRead(async () => {
      await useCurrencyStore
        .getState()
        .loadRates()
        .catch(() => {})
      const currencyState = useCurrencyStore.getState()
      const authority = captureCurrencyAuthority(currencyState, dayjs().format('YYYY-MM-DD'))
      const valuation = await readOwnershipValuation({
        targetCurrency: authority.mainCurrency,
        rates: valuationRatesWithCurrencyAuthority(authority),
      })
      const assetBreakdown: AccountBreakdown[] = []
      const liabilityBreakdown: AccountBreakdown[] = []

      for (const account of valuation.accounts) {
        const convertedAsset = convertWithCurrencyAuthority(
          authority,
          account.assetCentavos,
          account.currency
        )
        const convertedLiability = convertWithCurrencyAuthority(
          authority,
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
      !preferredCurrency ||
      totalAssets === null ||
      totalLiabilities === null ||
      netWorth === null ||
      totalInvestments === null
    )
      return
    const today = dayjs().format('YYYY-MM-DD')
    const breakdown = JSON.stringify({
      assets: assetBreakdown.map((account) => ({
        name: account.name,
        type: account.type,
        balance: account.balance,
        currency: account.currency,
      })),
      liabilities: liabilityBreakdown.map((account) => ({
        name: account.name,
        type: account.type,
        balance: account.balance,
        currency: account.currency,
      })),
    })

    const existing = await query<{ id: string; currency: string | null }>(
      'SELECT id, currency FROM net_worth_snapshots WHERE date = ?',
      [today]
    )
    if (existing.length > 0) {
      // A main-currency switch never relabels or overwrites today's existing evidence.
      if (existing[0].currency?.trim().toUpperCase() !== preferredCurrency) return
      await execute(
        `UPDATE net_worth_snapshots
         SET total_assets = ?, total_liabilities = ?, net_worth = ?, total_investments = ?, breakdown_json = ?
         WHERE date = ? AND currency = ?`,
        [
          totalAssets,
          totalLiabilities,
          netWorth,
          totalInvestments,
          breakdown,
          today,
          preferredCurrency,
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

  loadHistory: async (period) => {
    latestHistoryPeriod = period
    const now = dayjs()
    const startDate =
      period === '3m'
        ? now.subtract(3, 'month').format('YYYY-MM-DD')
        : period === '6m'
          ? now.subtract(6, 'month').format('YYYY-MM-DD')
          : period === '1y'
            ? now.subtract(1, 'year').format('YYYY-MM-DD')
            : '1970-01-01'
    const rows = await query<NetWorthSnapshot>(
      'SELECT * FROM net_worth_snapshots WHERE date >= ? ORDER BY date ASC, id ASC',
      [startDate]
    )
    const nativeSnapshots = snapshotNativeEvidence(rows)
    const currencyState = useCurrencyStore.getState()
    if (!currencyState.mainCurrency) {
      set({
        history: [],
        historyComplete: false,
        historyMissingCurrencies: [],
        historyNativeSnapshots: nativeSnapshots,
      })
      return
    }
    const invalidRows = rows.filter(
      (row) =>
        !row.currency ||
        !(FX_CURRENCIES as readonly string[]).includes(row.currency.trim().toUpperCase())
    )
    if (invalidRows.length > 0) {
      set({
        history: [],
        historyComplete: false,
        historyMissingCurrencies: ['UNKNOWN'],
        historyNativeSnapshots: nativeSnapshots,
      })
      return
    }

    const datedRows = rows.flatMap((row) => [
      {
        id: `${row.id}:net`,
        amountCentavos: row.net_worth,
        currency: row.currency!.trim().toUpperCase(),
        date: row.date,
      },
      {
        id: `${row.id}:assets`,
        amountCentavos: row.total_assets,
        currency: row.currency!.trim().toUpperCase(),
        date: row.date,
      },
      {
        id: `${row.id}:liabilities`,
        amountCentavos: row.total_liabilities,
        currency: row.currency!.trim().toUpperCase(),
        date: row.date,
      },
    ])
    const converted = convertDatedAmounts(
      datedRows,
      currencyState.mainCurrency,
      currencyState.manualRates
    )
    const byId = new Map(converted.converted.map((row) => [row.id, row]))
    if (!converted.complete) {
      const missing = new Set(
        converted.converted.filter((row) => !row.complete).map((row) => row.fromCurrency)
      )
      set({
        history: [],
        historyComplete: false,
        historyMissingCurrencies: [...missing].sort(),
        historyNativeSnapshots: nativeSnapshots,
      })
      return
    }
    set({
      history: rows.map((row) => ({
        date: row.date,
        netWorth: byId.get(`${row.id}:net`)!.amountCentavos!,
        assets: byId.get(`${row.id}:assets`)!.amountCentavos!,
        liabilities: byId.get(`${row.id}:liabilities`)!.amountCentavos!,
      })),
      historyComplete: true,
      historyMissingCurrencies: [],
      historyNativeSnapshots: nativeSnapshots,
    })
  },

  refresh: async (period = '1y') => {
    const requestId = ++netWorthRequestId
    netWorthStoreHasRefreshed = true
    latestHistoryPeriod = period
    set({ isLoading: true })
    try {
      await get().calculateCurrent()
      if (requestId !== netWorthRequestId) return
      await get().takeSnapshot()
      if (requestId !== netWorthRequestId) return
      await get().loadHistory(period)
    } finally {
      if (requestId === netWorthRequestId) set({ isLoading: false })
    }
  },
}))

let netWorthAuthorityKey = currencyAuthorityKey(useCurrencyStore.getState())
useCurrencyStore.subscribe((state) => {
  const key = currencyAuthorityKey(state)
  if (key === netWorthAuthorityKey) return
  netWorthAuthorityKey = key
  if (!netWorthStoreHasRefreshed) return
  const requestId = ++netWorthRequestId
  void useNetWorthStore
    .getState()
    .calculateCurrent()
    .then(() => {
      if (requestId === netWorthRequestId) {
        return useNetWorthStore.getState().loadHistory(latestHistoryPeriod)
      }
    })
    .catch(() => {})
})
