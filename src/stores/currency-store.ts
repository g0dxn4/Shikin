import {
  convertCentavosAsOf,
  convertDatedAmounts,
  FX_CURRENCIES,
  selectValuationRatesAsOf,
  type DatedConversion,
  type DatedExchangeRate,
  type SetExchangeRateInput,
} from '@shikin/finance-core/fx'
import type { ValuationRate } from '@shikin/finance-core/valuation'
import dayjs from 'dayjs'
import { create } from 'zustand'
import { getErrorMessage } from '@/lib/errors'
import {
  getCurrencySettings,
  listExchangeRates,
  setExchangeRate,
  setMainCurrency,
} from '@/lib/fx-service'
import { load } from '@/lib/storage'
import type { Account } from '@/types/database'

export type InvalidCurrencyDiagnostic = {
  accountId: string | null
  accountName: string | null
  value: string
}

export type NativeCurrencyTotal = {
  currency: string
  amountCentavos: number
}

type CompletePreferredAmount = {
  complete: true
  preferredCurrency: string
  amountCentavos: number
  missingCurrencies: readonly []
  reason?: never
}

type IncompletePreferredAmount = {
  complete: false
  preferredCurrency: string
  missingCurrencies: ReadonlyArray<string>
  reason: 'main_currency_unconfigured' | 'missing_exchange_rates' | 'invalid_currency_data'
  amountCentavos?: never
  invalidCurrencies?: ReadonlyArray<InvalidCurrencyDiagnostic>
  invalidData?: ReadonlyArray<string>
}

export type PreferredCurrencyAmountResult =
  | (CompletePreferredAmount & {
      conversion: DatedConversion
    })
  | (IncompletePreferredAmount & {
      conversion?: DatedConversion
    })
  | (CompletePreferredAmount & {
      knownTotalCentavos: number
      nativeTotals: ReadonlyArray<NativeCurrencyTotal>
      conversions: ReturnType<typeof convertDatedAmounts>['converted']
    })
  | (IncompletePreferredAmount & {
      knownTotalCentavos?: number
      nativeTotals?: ReadonlyArray<NativeCurrencyTotal>
      conversions?: ReturnType<typeof convertDatedAmounts>['converted']
    })

export interface CurrencyState {
  /** Authoritative database-backed presentation/reporting currency. */
  mainCurrency: string | null
  /** Configured main currency, or the legacy JSON preference/default as a setup draft only. */
  preferredCurrency: string
  /** Complete immutable manual rate history, including corrected rows. */
  manualRates: DatedExchangeRate[]
  isLoading: boolean
  error: string | null

  /** Load database main currency and complete manual history without network access. */
  loadRates: () => Promise<void>
  /** Explicitly persist the database-backed main currency. */
  setPreferredCurrency: (currency: string) => Promise<void>
  /** Append a manual rate or immutable correction using trusted adapter-local today. */
  saveExchangeRate: (input: Omit<SetExchangeRateInput, 'today'>) => Promise<void>
  convertHistoricalToPreferred: (
    amountCentavos: number,
    fromCurrency: string,
    date: string
  ) => PreferredCurrencyAmountResult
  convertCurrentToPreferred: (
    amountCentavos: number,
    fromCurrency: string,
    asOfDate?: string
  ) => PreferredCurrencyAmountResult
  getTotalBalanceInPreferred: (accounts: Account[]) => PreferredCurrencyAmountResult
  getCurrentValuationRates: (asOfDate?: string) => ValuationRate[]
}

const SETTINGS_KEY_PREFERRED_CURRENCY = 'preferred_currency'
const DEFAULT_SETUP_CURRENCY = 'USD'

function normalizeSupportedCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return (FX_CURRENCIES as readonly string[]).includes(normalized) ? normalized : null
}

function currencyDiagnosticValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '')
}

function requireSupportedCurrency(value: unknown): string {
  const normalized = normalizeSupportedCurrency(value)
  if (!normalized) throw new TypeError(`Unsupported currency: ${currencyDiagnosticValue(value)}`)
  return normalized
}

async function readLegacySetupDraft(): Promise<string> {
  try {
    const store = await load('settings.json')
    return (
      normalizeSupportedCurrency(await store.get(SETTINGS_KEY_PREFERRED_CURRENCY)) ??
      DEFAULT_SETUP_CURRENCY
    )
  } catch {
    return DEFAULT_SETUP_CURRENCY
  }
}

function localToday(): string {
  return dayjs().format('YYYY-MM-DD')
}

function unconfiguredResult(
  preferredCurrency: string,
  fromCurrency?: string,
  nativeTotals?: NativeCurrencyTotal[]
): PreferredCurrencyAmountResult {
  const source = normalizeSupportedCurrency(fromCurrency)
  return {
    complete: false,
    preferredCurrency,
    missingCurrencies: source ? [source] : [],
    reason: 'main_currency_unconfigured',
    ...(nativeTotals ? { nativeTotals } : {}),
  }
}

function accountNativeTotals(accounts: readonly Account[]): NativeCurrencyTotal[] {
  const totals = new Map<string, bigint>()
  for (const account of accounts) {
    const currency = requireSupportedCurrency(account.currency)
    if (!Number.isSafeInteger(account.balance)) {
      throw new RangeError('Account balance centavos must be a safe integer')
    }
    totals.set(currency, (totals.get(currency) ?? 0n) + BigInt(account.balance))
  }
  return [...totals]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, total]) => {
      const amountCentavos = Number(total)
      if (!Number.isSafeInteger(amountCentavos)) {
        throw new RangeError('Account balance total exceeds safe integer centavos')
      }
      return { currency, amountCentavos }
    })
}

function invalidResult(
  preferredCurrency: string,
  error: unknown,
  invalidCurrencies?: InvalidCurrencyDiagnostic[]
): PreferredCurrencyAmountResult {
  return {
    complete: false,
    preferredCurrency,
    missingCurrencies: [],
    reason: 'invalid_currency_data',
    ...(invalidCurrencies?.length ? { invalidCurrencies } : {}),
    invalidData: [getErrorMessage(error)],
  }
}

function convertOne(
  amountCentavos: number,
  fromCurrency: string,
  asOfDate: string,
  state: Pick<CurrencyState, 'mainCurrency' | 'preferredCurrency' | 'manualRates'>
): PreferredCurrencyAmountResult {
  if (!state.mainCurrency) return unconfiguredResult(state.preferredCurrency, fromCurrency)

  try {
    const source = requireSupportedCurrency(fromCurrency)
    const conversion = convertCentavosAsOf({
      amountCentavos,
      fromCurrency: source,
      toCurrency: state.mainCurrency,
      asOfDate,
      rates: state.manualRates,
    })
    if (!conversion.complete) {
      return {
        complete: false,
        preferredCurrency: state.mainCurrency,
        missingCurrencies: [source],
        reason: 'missing_exchange_rates',
        conversion,
      }
    }
    return {
      complete: true,
      preferredCurrency: state.mainCurrency,
      amountCentavos: conversion.amountCentavos,
      missingCurrencies: [],
      conversion,
    }
  } catch (error) {
    const normalized = normalizeSupportedCurrency(fromCurrency)
    return invalidResult(
      state.mainCurrency,
      error,
      normalized
        ? undefined
        : [
            {
              accountId: null,
              accountName: null,
              value: currencyDiagnosticValue(fromCurrency),
            },
          ]
    )
  }
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  mainCurrency: null,
  preferredCurrency: DEFAULT_SETUP_CURRENCY,
  manualRates: [],
  isLoading: false,
  error: null,

  loadRates: async () => {
    set({ isLoading: true, error: null })
    const setupDraft = await readLegacySetupDraft()
    try {
      const [settings, manualRates] = await Promise.all([
        getCurrencySettings(),
        listExchangeRates(),
      ])
      set({
        mainCurrency: settings.mainCurrency,
        preferredCurrency: settings.mainCurrency ?? setupDraft,
        manualRates,
      })
    } catch (error) {
      // A failed database switch/read must never leave another database's authority in memory.
      set({
        mainCurrency: null,
        preferredCurrency: setupDraft,
        manualRates: [],
        error: getErrorMessage(error),
      })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  setPreferredCurrency: async (currency) => {
    const normalized = requireSupportedCurrency(currency)
    set({ isLoading: true, error: null })
    try {
      const settings = await setMainCurrency(normalized)
      if (!settings.configured) throw new Error('Main currency was not configured')
      set({ mainCurrency: settings.mainCurrency, preferredCurrency: settings.mainCurrency })
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  saveExchangeRate: async (input) => {
    set({ isLoading: true, error: null })
    try {
      await setExchangeRate({ ...input, today: localToday() })
      await get().loadRates()
    } catch (error) {
      set({ error: getErrorMessage(error), isLoading: false })
      throw error
    }
  },

  convertHistoricalToPreferred: (amountCentavos, fromCurrency, date) =>
    convertOne(amountCentavos, fromCurrency, date, get()),

  convertCurrentToPreferred: (amountCentavos, fromCurrency, asOfDate = localToday()) =>
    convertOne(amountCentavos, fromCurrency, asOfDate, get()),

  getTotalBalanceInPreferred: (accounts) => {
    const { mainCurrency, preferredCurrency, manualRates } = get()
    const invalidCurrencies = accounts.flatMap((account) => {
      if (normalizeSupportedCurrency(account.currency)) return []
      return [
        {
          accountId: account.id,
          accountName: account.name,
          value: currencyDiagnosticValue(account.currency),
        },
      ]
    })
    if (invalidCurrencies.length > 0) {
      return invalidResult(
        mainCurrency ?? preferredCurrency,
        new TypeError('Unsupported account currency'),
        invalidCurrencies
      )
    }

    try {
      const nativeTotals = accountNativeTotals(accounts)
      if (!mainCurrency) return unconfiguredResult(preferredCurrency, undefined, nativeTotals)

      const today = localToday()
      const result = convertDatedAmounts(
        accounts.map((account) => ({
          id: account.id,
          amountCentavos: account.balance,
          currency: requireSupportedCurrency(account.currency),
          date: today,
        })),
        mainCurrency,
        manualRates
      )
      if (!result.complete) {
        const missingCurrencies = [
          ...new Set(
            result.converted
              .filter((conversion) => !conversion.complete)
              .map((conversion) => conversion.fromCurrency)
          ),
        ].sort()
        return {
          complete: false,
          preferredCurrency: mainCurrency,
          missingCurrencies,
          reason: 'missing_exchange_rates',
          knownTotalCentavos: result.knownTotalCentavos,
          nativeTotals: result.nativeTotals,
          conversions: result.converted,
        }
      }
      return {
        complete: true,
        preferredCurrency: mainCurrency,
        amountCentavos: result.totalCentavos!,
        missingCurrencies: [],
        knownTotalCentavos: result.knownTotalCentavos,
        nativeTotals: result.nativeTotals,
        conversions: result.converted,
      }
    } catch (error) {
      return invalidResult(mainCurrency ?? preferredCurrency, error)
    }
  },

  getCurrentValuationRates: (asOfDate = localToday()) => {
    const { mainCurrency, manualRates } = get()
    return mainCurrency ? selectValuationRatesAsOf(manualRates, mainCurrency, asOfDate) : []
  },
}))
