import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01RATE000000000000000000000'),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { query, execute } from '@/lib/database'
import { fetchRates, getRate, convertAmount, refreshRates, COMMON_CURRENCIES } from '../exchange-rate-service'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('exchange-rate-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchRates', () => {
    it('calls frankfurter.app with base currency', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base: 'USD',
          date: '2024-01-15',
          rates: { EUR: 0.92, GBP: 0.79 },
        }),
      })

      const rates = await fetchRates('USD')
      expect(mockFetch).toHaveBeenCalledWith('https://api.frankfurter.app/latest?from=USD')
      expect(rates).toEqual({ EUR: 0.92, GBP: 0.79 })
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(fetchRates('USD')).rejects.toThrow('Failed to fetch rates')
    })
  })

  describe('getRate', () => {
    it('returns 1 for same currency', async () => {
      const rate = await getRate('USD', 'USD')
      expect(rate).toBe(1)
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('returns cached rate from database', async () => {
      // Today's cached rate found
      mockQuery.mockResolvedValueOnce([{ rate: 0.92 }])

      const rate = await getRate('USD', 'EUR')
      expect(rate).toBe(0.92)
    })

    it('falls back to fetching when no cache exists', async () => {
      // No today's rate
      mockQuery.mockResolvedValueOnce([])
      // No recent rate
      mockQuery.mockResolvedValueOnce([])
      // Fetch succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base: 'USD',
          date: '2024-01-15',
          rates: { EUR: 0.93 },
        }),
      })
      // Store rate
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })

      const rate = await getRate('USD', 'EUR')
      expect(rate).toBe(0.93)
    })

    it('uses recent cached rate when fetch fails', async () => {
      // No today's rate
      mockQuery.mockResolvedValueOnce([])
      // Recent cached rate exists
      mockQuery.mockResolvedValueOnce([{ rate: 0.91 }])
      // Fetch fails
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const rate = await getRate('USD', 'EUR')
      expect(rate).toBe(0.91)
    })

    it('throws when no rate available anywhere', async () => {
      // No today's rate
      mockQuery.mockResolvedValueOnce([])
      // No recent rate
      mockQuery.mockResolvedValueOnce([])
      // Fetch fails
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(getRate('USD', 'XYZ')).rejects.toThrow('No exchange rate available')
    })
  })

  describe('convertAmount', () => {
    it('returns same amount for same currency', async () => {
      const result = await convertAmount(10000, 'USD', 'USD')
      expect(result).toBe(10000)
    })

    it('converts correctly with Math.round', async () => {
      // Mock getRate to return a rate
      mockQuery.mockResolvedValueOnce([{ rate: 0.92 }])

      const result = await convertAmount(10000, 'USD', 'EUR')
      // 10000 * 0.92 = 9200
      expect(result).toBe(9200)
    })

    it('rounds to nearest integer (centavos)', async () => {
      mockQuery.mockResolvedValueOnce([{ rate: 0.923456 }])

      const result = await convertAmount(10000, 'USD', 'EUR')
      // 10000 * 0.923456 = 9234.56 => rounded to 9235
      expect(result).toBe(9235)
      expect(Number.isInteger(result)).toBe(true)
    })
  })

  describe('refreshRates', () => {
    it('fetches rates for all common currencies', async () => {
      // Each currency fetch returns some rates
      for (const _currency of COMMON_CURRENCIES) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            base: 'USD',
            date: '2024-01-15',
            rates: { EUR: 0.92, GBP: 0.79 },
          }),
        })
      }
      // Allow all storeRate calls
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

      const allRates = await refreshRates()
      expect(Object.keys(allRates).length).toBe(COMMON_CURRENCIES.length)
      expect(mockFetch).toHaveBeenCalledTimes(COMMON_CURRENCIES.length)
    })

    it('continues when a currency fetch fails', async () => {
      // First currency succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base: 'USD',
          date: '2024-01-15',
          rates: { EUR: 0.92 },
        }),
      })
      // Rest fail
      for (let i = 1; i < COMMON_CURRENCIES.length; i++) {
        mockFetch.mockRejectedValueOnce(new Error('Network error'))
      }
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

      // Should not throw
      const allRates = await refreshRates()
      expect(Object.keys(allRates)).toHaveLength(1)
    })

    it('stores rates in the database', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base: 'USD',
          date: '2024-01-15',
          rates: { EUR: 0.92 },
        }),
      })
      // Rest of currencies fail
      for (let i = 1; i < COMMON_CURRENCIES.length; i++) {
        mockFetch.mockRejectedValueOnce(new Error('fail'))
      }
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

      await refreshRates()
      // EUR is in COMMON_CURRENCIES, so it should be stored
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO exchange_rates'),
        expect.arrayContaining(['USD', 'EUR', 0.92])
      )
    })
  })

  describe('COMMON_CURRENCIES', () => {
    it('includes expected currencies', () => {
      expect(COMMON_CURRENCIES).toContain('USD')
      expect(COMMON_CURRENCIES).toContain('EUR')
      expect(COMMON_CURRENCIES).toContain('GBP')
      expect(COMMON_CURRENCIES).toContain('MXN')
    })
  })
})
