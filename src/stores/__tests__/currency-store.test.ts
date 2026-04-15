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

  describe('convertToPreferred', () => {
    it('returns same amount when currencies match', () => {
      useCurrencyStore.setState({ preferredCurrency: 'USD' })

      const result = useCurrencyStore.getState().convertToPreferred(10000, 'USD')

      expect(result).toBe(10000)
    })

    it('converts using cached rate', () => {
      useCurrencyStore.setState({
        preferredCurrency: 'EUR',
        rates: { 'USD:EUR': 0.92 },
      })

      const result = useCurrencyStore.getState().convertToPreferred(10000, 'USD')

      expect(result).toBe(9200) // Math.round(10000 * 0.92)
    })

    it('returns original amount when no rate available', () => {
      useCurrencyStore.setState({
        preferredCurrency: 'JPY',
        rates: {},
      })

      const result = useCurrencyStore.getState().convertToPreferred(10000, 'USD')

      expect(result).toBe(10000)
    })
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
    it('returns 1 for same currency', () => {
      expect(useCurrencyStore.getState().getRate('USD', 'USD')).toBe(1)
    })

    it('returns rate from cache', () => {
      useCurrencyStore.setState({ rates: { 'USD:EUR': 0.92 } })

      expect(useCurrencyStore.getState().getRate('USD', 'EUR')).toBe(0.92)
    })

    it('returns null when rate not found', () => {
      useCurrencyStore.setState({ rates: {} })

      expect(useCurrencyStore.getState().getRate('USD', 'BRL')).toBeNull()
    })
  })

  describe('getTotalBalanceInPreferred', () => {
    it('sums account balances converted to preferred currency', () => {
      useCurrencyStore.setState({
        preferredCurrency: 'USD',
        rates: { 'EUR:USD': 1.087 },
      })

      const accounts: Account[] = [
        {
          id: '1',
          name: 'Checking',
          type: 'checking',
          balance: 100000,
          currency: 'USD',
          icon: 'wallet',
          color: '#000000',
          is_archived: 0,
          created_at: '',
          updated_at: '',
        },
        {
          id: '2',
          name: 'Euro Savings',
          type: 'savings',
          balance: 50000,
          currency: 'EUR',
          icon: 'piggy-bank',
          color: '#111111',
          is_archived: 0,
          created_at: '',
          updated_at: '',
        },
      ]

      const total = useCurrencyStore.getState().getTotalBalanceInPreferred(accounts)

      // 100000 (USD->USD) + Math.round(50000 * 1.087) = 100000 + 54350 = 154350
      expect(total).toBe(154350)
    })
  })
})
