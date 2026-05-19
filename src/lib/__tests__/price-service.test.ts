import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Investment } from '@/types/database'

const { settingsStore } = vi.hoisted(() => ({
  settingsStore: new Map<string, string>(),
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => settingsStore.get(key)),
  })),
}))

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn(() => 'price-id'),
}))

import { execute, query } from '@/lib/database'
import { fetchAllCurrentPrices, savePricesToDB } from '../price-service'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

const baseInvestment: Investment = {
  id: 'inv-1',
  account_id: null,
  symbol: 'WALMEX.MX',
  name: 'Walmart de México',
  type: 'stock',
  shares: 1,
  avg_cost_basis: 10000,
  currency: 'MXN',
  notes: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

describe('price-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsStore.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('falls back from Alpha Vantage to Finnhub for market symbols', async () => {
    vi.useFakeTimers()
    settingsStore.set('alpha_vantage_key', 'alpha-key')
    settingsStore.set('finnhub_key', 'finnhub-key')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'Global Quote': {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ c: 72.34 }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const pricesPromise = fetchAllCurrentPrices([baseInvestment])
    await vi.runAllTimersAsync()
    const prices = await pricesPromise

    expect(prices.get('WALMEX.MX')).toBe(7234)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('alphavantage.co')
    expect(String(fetchMock.mock.calls[1][0])).toContain('finnhub.io')
  })

  it('skips manual assets when no live provider can price them', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const prices = await fetchAllCurrentPrices([
      { ...baseInvestment, symbol: 'MANUAL', type: 'other' },
    ])

    expect(prices.size).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      '[PriceService] Failed to fetch MANUAL:',
      expect.any(Error)
    )
  })

  it('saves refreshed prices with each holding currency', async () => {
    mockQuery.mockResolvedValue([])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })

    await savePricesToDB(
      new Map([
        ['WALMEX.MX', 7234],
        ['AAPL', 15000],
      ]),
      new Map([
        ['WALMEX.MX', 'MXN'],
        ['AAPL', 'USD'],
      ])
    )

    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO stock_prices'),
      ['price-id', 'WALMEX.MX', 7234, 'MXN', expect.any(String)]
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO stock_prices'),
      ['price-id', 'AAPL', 15000, 'USD', expect.any(String)]
    )
  })
})
