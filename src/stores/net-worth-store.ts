import { convertDatedAmounts, FX_CURRENCIES } from '@shikin/finance-core/fx'
import dayjs from 'dayjs'
import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
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
  historyAuthorityKey: string | null
  historyCurrency: string | null
  historyRequestedPeriod: string | null
  historyRequestGeneration: number
  historyLoading: boolean
  historyError: string | null
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
let historyRequestGeneration = 0
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
  historyAuthorityKey: null,
  historyCurrency: null,
  historyRequestedPeriod: null,
  historyRequestGeneration: 0,
  historyLoading: false,
  historyError: null,
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
    const authority = captureCurrencyAuthority(
      useCurrencyStore.getState(),
      dayjs().format('YYYY-MM-DD')
    )
    const requestGeneration = ++historyRequestGeneration
    latestHistoryPeriod = period
    set({
      history: [],
      historyComplete: false,
      historyAuthorityKey: authority.key,
      historyCurrency: authority.mainCurrency,
      historyRequestedPeriod: period,
      historyRequestGeneration: requestGeneration,
      historyLoading: true,
      historyError: null,
      historyMissingCurrencies: [],
      historyNativeSnapshots: [],
    })

    const requestIsCurrent = () =>
      requestGeneration === historyRequestGeneration &&
      currencyAuthorityKey(useCurrencyStore.getState()) === authority.key &&
      latestHistoryPeriod === period

    try {
      const now = dayjs()
      const startDate =
        period === 'month'
          ? now.startOf('month').format('YYYY-MM-DD')
          : period === 'ytd'
            ? now.startOf('year').format('YYYY-MM-DD')
            : period === '3m'
              ? now.subtract(3, 'month').format('YYYY-MM-DD')
              : period === '6m'
                ? now.subtract(6, 'month').format('YYYY-MM-DD')
                : period === '1y'
                  ? now.subtract(1, 'year').format('YYYY-MM-DD')
                  : '1970-01-01'
      const rows =
        period === 'month' || period === 'ytd'
          ? await query<NetWorthSnapshot>(
              'SELECT * FROM net_worth_snapshots WHERE date >= ? AND date <= ? ORDER BY date ASC, id ASC',
              [startDate, now.format('YYYY-MM-DD')]
            )
          : await query<NetWorthSnapshot>(
              'SELECT * FROM net_worth_snapshots WHERE date >= ? ORDER BY date ASC, id ASC',
              [startDate]
            )
      if (!requestIsCurrent()) return

      const nativeSnapshots = snapshotNativeEvidence(rows)
      if (!authority.mainCurrency) {
        set({
          historyComplete: false,
          historyLoading: false,
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
          historyComplete: false,
          historyLoading: false,
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
        authority.mainCurrency,
        authority.manualRates
      )
      if (!requestIsCurrent()) return

      const byId = new Map(converted.converted.map((row) => [row.id, row]))
      if (!converted.complete) {
        const missing = new Set(
          converted.converted.filter((row) => !row.complete).map((row) => row.fromCurrency)
        )
        set({
          historyComplete: false,
          historyLoading: false,
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
        historyLoading: false,
        historyError: null,
        historyMissingCurrencies: [],
        historyNativeSnapshots: nativeSnapshots,
      })
    } catch (error) {
      if (requestIsCurrent()) {
        set({
          history: [],
          historyComplete: false,
          historyLoading: false,
          historyError: getErrorMessage(error),
          historyMissingCurrencies: [],
          historyNativeSnapshots: [],
        })
      }
      throw error
    }
  },

  refresh: async (period = latestHistoryPeriod) => {
    const requestId = ++netWorthRequestId
    const authority = captureCurrencyAuthority(
      useCurrencyStore.getState(),
      dayjs().format('YYYY-MM-DD')
    )
    const initialHistoryGeneration = ++historyRequestGeneration
    netWorthStoreHasRefreshed = true
    latestHistoryPeriod = period
    set({
      isLoading: true,
      history: [],
      historyComplete: false,
      historyAuthorityKey: authority.key,
      historyCurrency: authority.mainCurrency,
      historyRequestedPeriod: period,
      historyRequestGeneration: initialHistoryGeneration,
      historyLoading: true,
      historyError: null,
      historyMissingCurrencies: [],
      historyNativeSnapshots: [],
    })
    try {
      await get().calculateCurrent()
      if (requestId !== netWorthRequestId) return
      await get().takeSnapshot()
      if (requestId !== netWorthRequestId) return
      if (initialHistoryGeneration !== historyRequestGeneration) return
      await get().loadHistory(period)
    } catch (error) {
      if (initialHistoryGeneration === historyRequestGeneration) {
        set({ historyLoading: false, historyError: getErrorMessage(error) })
      }
      throw error
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

  const authority = captureCurrencyAuthority(state, dayjs().format('YYYY-MM-DD'))
  const invalidationGeneration = ++historyRequestGeneration
  useNetWorthStore.setState({
    history: [],
    historyComplete: false,
    historyAuthorityKey: authority.key,
    historyCurrency: authority.mainCurrency,
    historyRequestedPeriod: latestHistoryPeriod,
    historyRequestGeneration: invalidationGeneration,
    historyLoading: netWorthStoreHasRefreshed,
    historyError: null,
    historyMissingCurrencies: [],
    historyNativeSnapshots: [],
  })

  if (!netWorthStoreHasRefreshed) return
  const requestId = ++netWorthRequestId
  void (async () => {
    await useNetWorthStore
      .getState()
      .calculateCurrent()
      .catch(() => {})
    if (requestId !== netWorthRequestId || invalidationGeneration !== historyRequestGeneration)
      return
    await useNetWorthStore.getState().loadHistory(latestHistoryPeriod)
  })()
    .catch(() => {})
    .finally(() => {
      if (requestId === netWorthRequestId) useNetWorthStore.setState({ isLoading: false })
    })
})
