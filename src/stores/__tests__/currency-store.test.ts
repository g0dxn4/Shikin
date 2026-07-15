import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Account } from '@/types/database'

const {
  mockStoreGet,
  mockStoreSet,
  mockStoreSave,
  mockRefreshRates,
  mockGetCachedRates,
  mockGetLastFetchDate,
} = vi.hoisted(() => ({
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockStoreSave: vi.fn(),
  mockRefreshRates: vi.fn(),
  mockGetCachedRates: vi.fn(),
  mockGetLastFetchDate: vi.fn(),
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
  }),
}))

vi.mock('@/lib/exchange-rate-service', () => ({
  refreshRates: mockRefreshRates,
  getCachedRates: mockGetCachedRates,
  getLastFetchDate: mockGetLastFetchDate,
}))

import { useCurrencyStore } from '../currency-store'

function makeAccount(id: string, balance: number, currency: string): Account {
  return {
    id,
    name: `Account ${id}`,
    type: 'checking',
    balance,
    currency,
    icon: 'wallet',
    color: '#000000',
    is_archived: 0,
    created_at: '',
    updated_at: '',
  }
}

describe('currency-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock implementations to ensure clean state
    mockStoreGet.mockReset()
    mockStoreSet.mockReset()
    mockStoreSave.mockReset()
    mockRefreshRates.mockReset()
    mockGetCachedRates.mockReset()
    mockGetLastFetchDate.mockReset()

    useCurrencyStore.setState({
      rates: {},
      invalidRates: [],
      preferredCurrency: 'USD',
      lastFetched: null,
      isLoading: false,
      error: null,
    })
  })

  describe('autoRefreshIfStale', () => {
    it('does not fail startup when refresh fails but cached rates exist', async () => {
      // Setup: cached rates exist but are stale
      // First call is from loadRates
      mockStoreGet.mockResolvedValueOnce(null)
      mockGetCachedRates.mockResolvedValueOnce([
        { from_currency: 'USD', to_currency: 'EUR', rate: 0.92, date: '2026-03-17' },
      ])
      mockGetLastFetchDate.mockResolvedValueOnce('2020-01-01') // Very old date (stale)

      // Refresh fails (but should have fetched fresh rates after refresh)
      mockRefreshRates.mockRejectedValueOnce(new Error('Network unavailable'))
      // Second getCachedRates call from the failed refreshRates
      mockGetCachedRates.mockResolvedValueOnce([
        { from_currency: 'USD', to_currency: 'EUR', rate: 0.92, date: '2026-03-17' },
      ])

      // Should NOT throw because we have cached rates
      await expect(useCurrencyStore.getState().autoRefreshIfStale()).resolves.toBeUndefined()

      // Error should be stored in state
      expect(useCurrencyStore.getState().error).toBe('Network unavailable')

      // Cached rates should still be available
      expect(useCurrencyStore.getState().rates['USD:EUR']).toBe(0.92)
    })

    it('fails startup when refresh fails and no cached rates exist', async () => {
      // Setup: no cached rates and stale lastFetched
      mockStoreGet.mockResolvedValueOnce(null)
      mockGetCachedRates.mockResolvedValueOnce([])
      mockGetLastFetchDate.mockResolvedValueOnce('2020-01-01') // Very old date (stale)

      // Refresh fails and still no rates after refresh
      mockRefreshRates.mockRejectedValueOnce(new Error('Network unavailable'))
      mockGetCachedRates.mockResolvedValueOnce([]) // Still no rates after failed refresh

      // Should throw because we have no cached rates to fall back on
      await expect(useCurrencyStore.getState().autoRefreshIfStale()).rejects.toThrow(
        'Network unavailable'
      )

      expect(useCurrencyStore.getState().error).toBe('Network unavailable')
    })

    it('refreshes when stale and no cached rates exist', async () => {
      // Setup: no cached rates and stale lastFetched
      mockStoreGet.mockResolvedValueOnce(null)
      mockGetCachedRates.mockResolvedValueOnce([])
      mockGetLastFetchDate.mockResolvedValueOnce('2020-01-01') // Very old date (stale)
      mockRefreshRates.mockResolvedValueOnce({})
      // Second getCachedRates call after refreshRates
      mockGetCachedRates.mockResolvedValueOnce([
        { from_currency: 'USD', to_currency: 'EUR', rate: 0.92, date: '2026-03-17' },
      ])

      await useCurrencyStore.getState().autoRefreshIfStale()

      expect(mockRefreshRates).toHaveBeenCalledTimes(1)
      expect(useCurrencyStore.getState().rates['USD:EUR']).toBe(0.92)
    })

    it('skips refresh when rates are not stale', async () => {
      // Setup: recent lastFetched
      mockStoreGet.mockResolvedValueOnce(null)
      mockGetCachedRates.mockResolvedValueOnce([
        { from_currency: 'USD', to_currency: 'EUR', rate: 0.92, date: '2026-03-17' },
      ])
      mockGetLastFetchDate.mockResolvedValueOnce(new Date().toISOString().split('T')[0]) // Today

      await useCurrencyStore.getState().autoRefreshIfStale()

      // Should not call refresh because rates are fresh
      expect(mockRefreshRates).not.toHaveBeenCalled()

      // Cached rates should still be loaded
      expect(useCurrencyStore.getState().rates['USD:EUR']).toBe(0.92)
    })
  })

  describe('loadRates', () => {
    it('loads preferred currency from settings and cached rates from DB', async () => {
      mockStoreGet.mockResolvedValueOnce('EUR')
      mockGetCachedRates.mockResolvedValueOnce([
        { from_currency: 'USD', to_currency: 'EUR', rate: 0.92, date: '2026-03-17' },
        { from_currency: 'EUR', to_currency: 'USD', rate: 1.087, date: '2026-03-17' },
      ])
      mockGetLastFetchDate.mockResolvedValueOnce('2026-03-17')

      await useCurrencyStore.getState().loadRates()

      const state = useCurrencyStore.getState()
      expect(state.preferredCurrency).toBe('EUR')
      expect(state.rates['USD:EUR']).toBe(0.92)
      expect(state.rates['EUR:USD']).toBe(1.087)
      expect(state.lastFetched).toBe('2026-03-17')
    })

    it('keeps USD as default when no saved preference', async () => {
      mockStoreGet.mockResolvedValueOnce(null)
      mockGetCachedRates.mockResolvedValueOnce([])
      mockGetLastFetchDate.mockResolvedValueOnce(null)

      await useCurrencyStore.getState().loadRates()

      expect(useCurrencyStore.getState().preferredCurrency).toBe('USD')
    })

    it('sets isLoading during load', async () => {
      mockStoreGet.mockResolvedValueOnce(null)
      mockGetCachedRates.mockResolvedValueOnce([])
      mockGetLastFetchDate.mockResolvedValueOnce(null)

      const promise = useCurrencyStore.getState().loadRates()
      expect(useCurrencyStore.getState().isLoading).toBe(true)
      await promise
      expect(useCurrencyStore.getState().isLoading).toBe(false)
    })

    it('stores an error message when loading rates fails', async () => {
      mockStoreGet.mockRejectedValueOnce(new Error('settings unavailable'))

      await expect(useCurrencyStore.getState().loadRates()).rejects.toThrow('settings unavailable')

      expect(useCurrencyStore.getState().isLoading).toBe(false)
      expect(useCurrencyStore.getState().error).toBe('settings unavailable')
    })
  })

  describe('setPreferredCurrency', () => {
    it('updates state and persists to settings store', async () => {
      await useCurrencyStore.getState().setPreferredCurrency('MXN')

      expect(useCurrencyStore.getState().preferredCurrency).toBe('MXN')
      expect(mockStoreSet).toHaveBeenCalledWith('preferred_currency', 'MXN')
      expect(mockStoreSave).toHaveBeenCalled()
    })
  })

  describe('invalid cached rate diagnostics', () => {
    it('returns typed source/target/rate details for malformed cached rows', async () => {
      mockStoreGet.mockResolvedValueOnce(null)
      mockGetCachedRates.mockResolvedValueOnce([
        { from_currency: ' ', to_currency: 'USD', rate: 1, date: '2026-03-17' },
      ])
      mockGetLastFetchDate.mockResolvedValueOnce('2026-03-17')

      await useCurrencyStore.getState().loadRates()

      expect(
        useCurrencyStore
          .getState()
          .getTotalBalanceInPreferred([makeAccount('valid', 100_000, 'USD')])
      ).toEqual({
        complete: false,
        preferredCurrency: 'USD',
        missingCurrencies: [],
        reason: 'invalid_currency_data',
        invalidRates: [{ fromCurrency: '', toCurrency: 'USD', rate: '1' }],
      })
    })
  })

  describe('convertToPreferred', () => {
    it('returns a complete same-currency amount without a cached rate', () => {
      useCurrencyStore.setState({ preferredCurrency: ' usd ', rates: {} })

      expect(useCurrencyStore.getState().convertToPreferred(10_000, 'USD')).toEqual({
        complete: true,
        preferredCurrency: 'USD',
        amountCentavos: 10_000,
        missingCurrencies: [],
      })
    })

    it('normalizes currency codes and converts using a valid cached rate', () => {
      useCurrencyStore.setState({
        preferredCurrency: ' usd ',
        rates: { ' eur : usd ': 1.1 },
      })

      expect(useCurrencyStore.getState().convertToPreferred(10_000, ' eur ')).toEqual({
        complete: true,
        preferredCurrency: 'USD',
        amountCentavos: 11_000,
        missingCurrencies: [],
      })
    })

    it('returns an explicit incomplete result when no rate is available', () => {
      useCurrencyStore.setState({ preferredCurrency: 'JPY', rates: {} })

      expect(useCurrencyStore.getState().convertToPreferred(10_000, 'USD')).toEqual({
        complete: false,
        preferredCurrency: 'JPY',
        missingCurrencies: ['USD'],
        reason: 'missing_exchange_rates',
      })
    })

    it.each(['', 'US D'])('returns invalid-data diagnostics for malformed input %j', (currency) => {
      expect(useCurrencyStore.getState().convertToPreferred(10_000, currency)).toEqual({
        complete: false,
        preferredCurrency: 'USD',
        missingCurrencies: [],
        reason: 'invalid_currency_data',
        invalidCurrencies: [{ accountId: null, accountName: null, value: currency.trim() }],
      })
    })

    it('accepts a non-fiat asset code for a same-asset total', () => {
      useCurrencyStore.setState({ preferredCurrency: 'USDT', rates: {} })

      expect(useCurrencyStore.getState().convertToPreferred(10_000, ' usdt ')).toEqual({
        complete: true,
        preferredCurrency: 'USDT',
        amountCentavos: 10_000,
        missingCurrencies: [],
      })
    })

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -0.5])(
      'rejects an invalid, zero, or negative cached rate (%s)',
      (rate) => {
        useCurrencyStore.setState({ preferredCurrency: 'USD', rates: { 'EUR:USD': rate } })

        expect(useCurrencyStore.getState().convertToPreferred(10_000, 'EUR')).toEqual({
          complete: false,
          preferredCurrency: 'USD',
          missingCurrencies: ['EUR'],
          reason: 'missing_exchange_rates',
        })
      }
    )
  })

  describe('refreshRates', () => {
    it('calls exchange rate service and reloads rates', async () => {
      mockRefreshRates.mockResolvedValueOnce({})
      mockGetCachedRates.mockResolvedValueOnce([
        { from_currency: 'USD', to_currency: 'GBP', rate: 0.79, date: '2026-03-17' },
      ])

      await useCurrencyStore.getState().refreshRates()

      expect(mockRefreshRates).toHaveBeenCalledTimes(1)
      expect(useCurrencyStore.getState().rates['USD:GBP']).toBe(0.79)
      expect(useCurrencyStore.getState().lastFetched).toBeTruthy()
    })
  })

  describe('getRate', () => {
    it('normalizes same-currency codes', () => {
      expect(useCurrencyStore.getState().getRate(' usd ', 'USD')).toBe(1)
    })

    it('returns a normalized valid rate from cache', () => {
      useCurrencyStore.setState({ rates: { ' usd : eur ': 0.92 } })

      expect(useCurrencyStore.getState().getRate('USD', ' eur ')).toBe(0.92)
    })

    it.each([Number.NaN, 0, -1])('returns null for unusable cached rate %s', (rate) => {
      useCurrencyStore.setState({ rates: { 'USD:EUR': rate } })

      expect(useCurrencyStore.getState().getRate('USD', 'EUR')).toBeNull()
    })

    it('returns null when rate is not found', () => {
      useCurrencyStore.setState({ rates: {} })

      expect(useCurrencyStore.getState().getRate('USD', 'BRL')).toBeNull()
    })
  })

  describe('getTotalBalanceInPreferred', () => {
    it('sums account balances only after complete conversion', () => {
      useCurrencyStore.setState({
        preferredCurrency: 'USD',
        rates: { 'EUR:USD': 1.087 },
      })

      const total = useCurrencyStore
        .getState()
        .getTotalBalanceInPreferred([
          makeAccount('1', 100_000, 'USD'),
          makeAccount('2', 50_000, 'EUR'),
        ])

      expect(total).toEqual({
        complete: true,
        preferredCurrency: 'USD',
        amountCentavos: 154_350,
        missingCurrencies: [],
      })
    })

    it('aggregates normalized same-currency accounts without rates', () => {
      useCurrencyStore.setState({ preferredCurrency: 'mxn', rates: {} })

      expect(
        useCurrencyStore
          .getState()
          .getTotalBalanceInPreferred([
            makeAccount('1', 10_000, ' MXN '),
            makeAccount('2', 5_000, 'mxn'),
          ])
      ).toEqual({
        complete: true,
        preferredCurrency: 'MXN',
        amountCentavos: 15_000,
        missingCurrencies: [],
      })
    })

    it('returns affected-account diagnostics instead of throwing for invalid currency data', () => {
      useCurrencyStore.setState({ preferredCurrency: 'USD', rates: {} })
      const invalidAccount = makeAccount('broken', 50_000, ' ')
      invalidAccount.name = 'Broken savings'

      expect(
        useCurrencyStore
          .getState()
          .getTotalBalanceInPreferred([makeAccount('valid', 100_000, 'USD'), invalidAccount])
      ).toEqual({
        complete: false,
        preferredCurrency: 'USD',
        missingCurrencies: [],
        reason: 'invalid_currency_data',
        invalidCurrencies: [{ accountId: 'broken', accountName: 'Broken savings', value: '' }],
      })
    })

    it('reports every missing currency and does not expose a partial amount', () => {
      useCurrencyStore.setState({ preferredCurrency: 'USD', rates: {} })

      const total = useCurrencyStore
        .getState()
        .getTotalBalanceInPreferred([
          makeAccount('1', 100_000, 'USD'),
          makeAccount('2', 50_000, 'eur'),
          makeAccount('3', 25_000, ' MXN '),
        ])

      expect(total).toEqual({
        complete: false,
        preferredCurrency: 'USD',
        missingCurrencies: ['EUR', 'MXN'],
        reason: 'missing_exchange_rates',
      })
      expect(total).not.toHaveProperty('amountCentavos')
    })
  })
})
