import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockStoreGet, mockStoreSet, mockStoreSave,
  mockRefreshRates, mockGetCachedRates, mockGetLastFetchDate,
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
    useCurrencyStore.setState({
      rates: {},
      preferredCurrency: 'USD',
      lastFetched: null,
      isLoading: false,
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

      const accounts = [
        { id: '1', name: 'Checking', type: 'checking', balance: 100000, currency: 'USD', is_archived: 0, created_at: '', updated_at: '' },
        { id: '2', name: 'Euro Savings', type: 'savings', balance: 50000, currency: 'EUR', is_archived: 0, created_at: '', updated_at: '' },
      ] as any[]

      const total = useCurrencyStore.getState().getTotalBalanceInPreferred(accounts)

      // 100000 (USD->USD) + Math.round(50000 * 1.087) = 100000 + 54350 = 154350
      expect(total).toBe(154350)
    })
  })
})
