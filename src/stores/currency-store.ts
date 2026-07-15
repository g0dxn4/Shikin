import {
  aggregateCentavosByCurrency,
  convertCurrencyTotals,
  type ConversionRate,
  type CurrencyAmount,
} from '@shikin/finance-core'
import { create } from 'zustand'
import { load } from '@/lib/storage'
import { getErrorMessage } from '@/lib/errors'
import { refreshRates, getCachedRates, getLastFetchDate } from '@/lib/exchange-rate-service'
import type { Account } from '@/types/database'

export type InvalidCurrencyDiagnostic = {
  accountId: string | null
  accountName: string | null
  value: string
}

export type InvalidRateDiagnostic = {
  fromCurrency: string
  toCurrency: string
  rate: string
}

export type PreferredCurrencyAmountResult =
  | {
      complete: true
      preferredCurrency: string
      amountCentavos: number
      missingCurrencies: readonly []
    }
  | {
      complete: false
      preferredCurrency: string
      missingCurrencies: ReadonlyArray<string>
      reason: 'missing_exchange_rates' | 'invalid_currency_data'
      invalidCurrencies?: ReadonlyArray<InvalidCurrencyDiagnostic>
      invalidRates?: ReadonlyArray<InvalidRateDiagnostic>
    }

interface CurrencyState {
  /** Map of "FROM:TO" -> rate */
  rates: Record<string, number>
  invalidRates: InvalidRateDiagnostic[]
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

  /** Convert centavos to the preferred currency without assuming a missing rate is 1:1 */
  convertToPreferred: (
    amountCentavos: number,
    fromCurrency: string
  ) => PreferredCurrencyAmountResult

  /** Sum all account balances only when every required conversion rate is available */
  getTotalBalanceInPreferred: (accounts: Account[]) => PreferredCurrencyAmountResult

  /** Get a valid rate for a specific pair from the local cache */
  getRate: (from: string, to: string) => number | null

  /** Auto-refresh rates if stale (>24h) */
  autoRefreshIfStale: () => Promise<void>
}

interface CachedRateRow {
  from_currency: string
  to_currency: string
  rate: number
}

const SETTINGS_KEY_PREFERRED_CURRENCY = 'preferred_currency'
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9]{2,10}$/.test(normalized) ? normalized : null
}

function currencyDiagnosticValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '')
}

function requireCurrencyCode(value: unknown): string {
  const normalized = normalizeCurrencyCode(value)
  if (!normalized) throw new TypeError('currency must not be empty')
  return normalized
}

function isValidRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

function buildRateCache(rows: ReadonlyArray<CachedRateRow>): {
  rates: Record<string, number>
  invalidRates: InvalidRateDiagnostic[]
} {
  const rates: Record<string, number> = {}
  const invalidRates: InvalidRateDiagnostic[] = []
  for (const row of rows) {
    const from = normalizeCurrencyCode(row.from_currency)
    const to = normalizeCurrencyCode(row.to_currency)
    if (!from || !to || !isValidRate(row.rate)) {
      invalidRates.push({
        fromCurrency: currencyDiagnosticValue(row.from_currency),
        toCurrency: currencyDiagnosticValue(row.to_currency),
        rate: currencyDiagnosticValue(row.rate),
      })
      continue
    }
    rates[`${from}:${to}`] = row.rate
  }
  return { rates, invalidRates }
}

function getUsableRates(
  rates: Readonly<Record<string, number>>,
  targetCurrency: string
): ConversionRate[] {
  const target = requireCurrencyCode(targetCurrency)
  const normalizedRates = new Map<string, ConversionRate>()

  for (const [pair, rate] of Object.entries(rates)) {
    const parts = pair.split(':')
    if (parts.length !== 2 || !isValidRate(rate)) continue
    const from = normalizeCurrencyCode(parts[0])
    const to = normalizeCurrencyCode(parts[1])
    if (!from || !to || to !== target) continue
    normalizedRates.set(from, { fromCurrency: from, toCurrency: to, rate })
  }

  return [...normalizedRates.values()]
}

type CurrencyAmountInput = CurrencyAmount & {
  accountId?: string | null
  accountName?: string | null
}

function convertAmountsToPreferred(
  amounts: ReadonlyArray<CurrencyAmountInput>,
  preferredCurrency: string,
  rates: Readonly<Record<string, number>>,
  invalidRates: ReadonlyArray<InvalidRateDiagnostic>
): PreferredCurrencyAmountResult {
  const preferred = normalizeCurrencyCode(preferredCurrency)
  const invalidCurrencies: InvalidCurrencyDiagnostic[] = amounts.flatMap((amount) => {
    if (normalizeCurrencyCode(amount.currency)) return []
    return [
      {
        accountId: amount.accountId ?? null,
        accountName: amount.accountName ?? null,
        value: currencyDiagnosticValue(amount.currency),
      },
    ]
  })
  if (!preferred) {
    invalidCurrencies.unshift({
      accountId: null,
      accountName: null,
      value: currencyDiagnosticValue(preferredCurrency),
    })
  }
  if (!preferred || invalidCurrencies.length > 0 || invalidRates.length > 0) {
    return {
      complete: false,
      preferredCurrency: preferred ?? currencyDiagnosticValue(preferredCurrency).toUpperCase(),
      missingCurrencies: [],
      reason: 'invalid_currency_data',
      ...(invalidCurrencies.length > 0 ? { invalidCurrencies } : {}),
      ...(invalidRates.length > 0 ? { invalidRates } : {}),
    }
  }

  const normalizedAmounts = amounts.map((amount) => ({
    currency: requireCurrencyCode(amount.currency),
    amountCentavos: amount.amountCentavos,
  }))
  const totals = aggregateCentavosByCurrency(normalizedAmounts)
  const result = convertCurrencyTotals(totals, preferred, getUsableRates(rates, preferred))

  if (result.complete) {
    return {
      complete: true,
      preferredCurrency: result.targetCurrency,
      amountCentavos: result.totalCentavos,
      missingCurrencies: [],
    }
  }

  return {
    complete: false,
    preferredCurrency: result.targetCurrency,
    missingCurrencies: result.missingCurrencies,
    reason: 'missing_exchange_rates',
  }
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  rates: {},
  invalidRates: [],
  preferredCurrency: 'USD',
  lastFetched: null,
  isLoading: false,
  error: null,

  loadRates: async () => {
    set({ isLoading: true, error: null })
    try {
      // Load preferred currency from localStorage settings
      const store = await load('settings.json')
      const saved = await store.get(SETTINGS_KEY_PREFERRED_CURRENCY)
      const savedCurrency = normalizeCurrencyCode(saved)
      if (savedCurrency) {
        set({ preferredCurrency: savedCurrency })
      }

      // Load cached rates from DB. Invalid cache rows are unavailable, never usable as rates.
      const cachedRows = await getCachedRates()
      set(buildRateCache(cachedRows))

      // Load last fetch date
      const lastDate = await getLastFetchDate()
      set({ lastFetched: lastDate })
    } catch (err) {
      set({ error: getErrorMessage(err) })
      throw err
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
      const rateCache = buildRateCache(cachedRows)

      const today = new Date().toISOString().split('T')[0]
      set({ ...rateCache, lastFetched: today })
    } catch (err) {
      set({ error: getErrorMessage(err) })
      throw err
    } finally {
      set({ isLoading: false })
    }
  },

  setPreferredCurrency: async (currency: string) => {
    const normalizedCurrency = requireCurrencyCode(currency)
    set({ preferredCurrency: normalizedCurrency })
    const store = await load('settings.json')
    await store.set(SETTINGS_KEY_PREFERRED_CURRENCY, normalizedCurrency)
    await store.save()
  },

  convertToPreferred: (amountCentavos, fromCurrency) => {
    const { preferredCurrency, rates, invalidRates } = get()
    return convertAmountsToPreferred(
      [{ currency: fromCurrency, amountCentavos }],
      preferredCurrency,
      rates,
      invalidRates
    )
  },

  getTotalBalanceInPreferred: (accounts) => {
    const { preferredCurrency, rates, invalidRates } = get()
    return convertAmountsToPreferred(
      accounts.map((account) => ({
        currency: account.currency,
        amountCentavos: account.balance,
        accountId: account.id,
        accountName: account.name,
      })),
      preferredCurrency,
      rates,
      invalidRates
    )
  },

  getRate: (from, to) => {
    const normalizedFrom = normalizeCurrencyCode(from)
    const normalizedTo = normalizeCurrencyCode(to)
    if (!normalizedFrom || !normalizedTo) return null
    if (normalizedFrom === normalizedTo) return 1

    const rate = getUsableRates(get().rates, normalizedTo).find(
      (candidate) => candidate.fromCurrency === normalizedFrom
    )?.rate
    return rate ?? null
  },

  autoRefreshIfStale: async () => {
    const { refreshRates: doRefresh, loadRates } = get()

    // Always load cached rates first (updates lastFetched and rates in state)
    await loadRates()

    // Get updated state after loadRates
    const { lastFetched } = get()

    if (!lastFetched) {
      // Never fetched — do initial fetch
      // If this fails, we don't have any cached data so it's a real startup failure
      await doRefresh()
      return
    }

    const lastDate = new Date(lastFetched)
    const now = new Date()
    if (now.getTime() - lastDate.getTime() > STALE_THRESHOLD_MS) {
      // Rates are stale — attempt refresh but don't fail startup if cached data exists
      // This prevents spurious startup failures when network is unavailable
      // but we have usable cached rates from a previous fetch
      try {
        await doRefresh()
      } catch (err) {
        // Refresh failed - get potentially updated state
        const { rates: updatedRates } = get()
        // Only re-throw if we have no usable cached rates
        const hasCachedRates = Object.keys(updatedRates).length > 0
        if (!hasCachedRates) {
          throw err
        }
        // Otherwise, silently use stale cached rates
        // The error is already stored in state by refreshRates
      }
    }
  },
}))
