import { create } from 'zustand'
import { load } from '@/lib/storage'
import {
  refreshRates,
  getCachedRates,
  getLastFetchDate,
} from '@/lib/exchange-rate-service'
import type { Account } from '@/types/database'

interface CurrencyState {
  /** Map of "FROM:TO" -> rate */
  rates: Record<string, number>
  preferredCurrency: string
  lastFetched: string | null
  isLoading: boolean
  error: string | null

  /** Load cached rates from DB and preferred currency from settings */
  loadRates: () => Promise<void>

  /** Fetch fresh rates from frankfurter.app and store them */
  refreshRates: () => Promise<void>

  /** Set the user's preferred display currency */
  setPreferredCurrency: (currency: string) => Promise<void>

  /** Convert centavos amount from a given currency to the preferred currency */
  convertToPreferred: (amountCentavos: number, fromCurrency: string) => number

  /** Sum all account balances converted to the preferred currency */
  getTotalBalanceInPreferred: (accounts: Account[]) => number

  /** Get rate for a specific pair from the local cache */
  getRate: (from: string, to: string) => number | null

  /** Auto-refresh rates if stale (>24h) */
  autoRefreshIfStale: () => Promise<void>
}

const SETTINGS_KEY_PREFERRED_CURRENCY = 'preferred_currency'
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  rates: {},
  preferredCurrency: 'USD',
  lastFetched: null,
  isLoading: false,
  error: null,

  loadRates: async () => {
    set({ isLoading: true, error: null })
    try {
      // Load preferred currency from localStorage settings
      const store = await load('settings.json')
      const saved = (await store.get(SETTINGS_KEY_PREFERRED_CURRENCY)) as string | null
      if (saved) {
        set({ preferredCurrency: saved })
      }

      // Load cached rates from DB
      const cachedRows = await getCachedRates()
      const ratesMap: Record<string, number> = {}
      for (const row of cachedRows) {
        ratesMap[`${row.from_currency}:${row.to_currency}`] = row.rate
      }
      set({ rates: ratesMap })

      // Load last fetch date
      const lastDate = await getLastFetchDate()
      set({ lastFetched: lastDate })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  refreshRates: async () => {
    set({ isLoading: true, error: null })
    try {
      await refreshRates()

      // Reload rates from DB
      const cachedRows = await getCachedRates()
      const ratesMap: Record<string, number> = {}
      for (const row of cachedRows) {
        ratesMap[`${row.from_currency}:${row.to_currency}`] = row.rate
      }

      const today = new Date().toISOString().split('T')[0]
      set({ rates: ratesMap, lastFetched: today })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  setPreferredCurrency: async (currency: string) => {
    set({ preferredCurrency: currency })
    const store = await load('settings.json')
    await store.set(SETTINGS_KEY_PREFERRED_CURRENCY, currency)
    await store.save()
  },

  convertToPreferred: (amountCentavos: number, fromCurrency: string): number => {
    const { preferredCurrency, rates } = get()
    if (fromCurrency === preferredCurrency) return amountCentavos

    const key = `${fromCurrency}:${preferredCurrency}`
    const rate = rates[key]
    if (rate == null) return amountCentavos // No rate available, return as-is

    return Math.round(amountCentavos * rate)
  },

  getTotalBalanceInPreferred: (accounts: Account[]): number => {
    const { convertToPreferred } = get()
    return accounts.reduce((sum, account) => {
      return sum + convertToPreferred(account.balance, account.currency)
    }, 0)
  },

  getRate: (from: string, to: string): number | null => {
    if (from === to) return 1
    const { rates } = get()
    return rates[`${from}:${to}`] ?? null
  },

  autoRefreshIfStale: async () => {
    const { lastFetched, refreshRates: doRefresh, loadRates } = get()

    // Always load cached rates first
    await loadRates()

    if (!lastFetched) {
      // Never fetched — do initial fetch
      await doRefresh()
      return
    }

    const lastDate = new Date(lastFetched)
    const now = new Date()
    if (now.getTime() - lastDate.getTime() > STALE_THRESHOLD_MS) {
      await doRefresh()
    }
  },
}))
