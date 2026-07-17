import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn(() => 'inv-test-id'),
}))

import { query, execute } from '@/lib/database'
import { useInvestmentStore } from '../investment-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('investment-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useInvestmentStore.setState({
      investments: [],
      portfolioSummary: {
        totalMarketValue: 0,
        totalCostBasis: 0,
        totalGainLoss: 0,
        totalGainLossPercent: 0,
        byType: {},
        byCurrency: {},
        currencies: [],
        isMixedCurrency: false,
        totalsComplete: true,
      },
      priceHistory: new Map(),
      isLoading: false,
      fetchError: null,
      error: null,
      lastPriceFetch: null,
    })
  })

  it('stores an error message when fetch fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    await expect(useInvestmentStore.getState().fetch()).rejects.toThrow('DB error')

    expect(useInvestmentStore.getState().isLoading).toBe(false)
    expect(useInvestmentStore.getState().fetchError).toBe('DB error')
    expect(useInvestmentStore.getState().error).toBeNull()
  })

  it('keeps price history failures out of fetchError', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Price history unavailable'))

    await expect(useInvestmentStore.getState().fetchPriceHistory('AAPL')).rejects.toThrow(
      'Price history unavailable'
    )

    expect(useInvestmentStore.getState().fetchError).toBeNull()
    expect(useInvestmentStore.getState().error).toBe('Price history unavailable')
  })

  it('loads investments and updates the portfolio summary', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 2,
        avg_cost_basis: 1000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        latest_price: 1500,
        latest_price_currency: 'USD',
        latest_price_date: '2024-01-10',
      },
    ])

    await useInvestmentStore.getState().fetch()

    expect(useInvestmentStore.getState().investments).toHaveLength(1)
    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      id: 'inv-1',
      symbol: 'AAPL',
      currentPrice: 1500,
      currentPriceCurrency: 'USD',
      marketValue: 3000,
      account_id: null,
    })

    expect(useInvestmentStore.getState().portfolioSummary).toEqual({
      totalMarketValue: 3000,
      totalCostBasis: 2000,
      totalGainLoss: 1000,
      totalGainLossPercent: 50,
      byType: {
        stock: {
          marketValue: 3000,
          gainLoss: 1000,
          count: 1,
        },
      },
      byCurrency: {
        USD: {
          marketValue: 3000,
          costBasis: 2000,
          gainLoss: 1000,
          count: 1,
        },
      },
      currencies: ['USD'],
      isMixedCurrency: false,
      totalsComplete: true,
    })

    expect(useInvestmentStore.getState().isLoading).toBe(false)
    expect(useInvestmentStore.getState().fetchError).toBeNull()
    expect(useInvestmentStore.getState().error).toBeNull()
  })

  it('marks totals incomplete when a quote currency cannot be converted', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'BTC',
        name: 'Bitcoin',
        type: 'crypto',
        shares: 1,
        avg_cost_basis: 100_000,
        currency: 'MXN',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        latest_price: 50_000,
        latest_price_currency: 'USD',
        latest_price_date: '2024-01-10',
      },
    ])

    await useInvestmentStore.getState().fetch()

    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      currentPrice: 50_000,
      currentPriceCurrency: 'USD',
      marketValue: 50_000,
    })
    expect(useInvestmentStore.getState().portfolioSummary).toMatchObject({
      totalMarketValue: null,
      totalGainLoss: null,
      totalGainLossPercent: null,
      totalsComplete: false,
    })
  })

  it('does not reject when fetch fails after add', async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockRejectedValueOnce(new Error('Refresh failed'))

    await expect(
      useInvestmentStore.getState().add({
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 2,
        avgCost: 1000,
        currency: 'USD',
      })
    ).resolves.toBeUndefined()

    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(useInvestmentStore.getState().error).toBeNull()
  })

  it('adds a CETES holding with normalized symbol and centavo cost basis', async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockResolvedValueOnce([])

    await useInvestmentStore.getState().add({
      symbol: 'cetes-28',
      name: 'CETES 28 días',
      type: 'cetes',
      shares: 10,
      avgCost: 9.91,
      currency: 'MXN',
      accountId: 'acct-invest',
      notes: 'Manual government note',
    })

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO investments'), [
      'inv-test-id',
      'acct-invest',
      'CETES-28',
      'CETES 28 días',
      'cetes',
      10,
      991,
      'MXN',
      'Manual government note',
      expect.any(String),
      expect.any(String),
    ])
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('updates an investment and clears optional account and notes', async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockResolvedValueOnce([])

    await useInvestmentStore.getState().update('inv-1', {
      symbol: 'walmex.mx',
      name: 'Walmart de México',
      type: 'stock',
      shares: 3,
      avgCost: 72.5,
      currency: 'MXN',
    })

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE investments SET'), [
      null,
      'WALMEX.MX',
      'Walmart de México',
      'stock',
      3,
      7250,
      'MXN',
      null,
      expect.any(String),
      'inv-1',
    ])
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('deletes an investment and refreshes cached holdings', async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockResolvedValueOnce([])

    await useInvestmentStore.getState().remove('inv-1')

    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM investments WHERE id = ?', ['inv-1'])
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('computes mixed-currency summary correctly', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 2,
        avg_cost_basis: 1000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        latest_price: 1500,
        latest_price_currency: 'USD',
        latest_price_date: '2024-01-10',
      },
      {
        id: 'inv-2',
        account_id: null,
        symbol: 'WALMEX.MX',
        name: 'Walmart de México',
        type: 'stock',
        shares: 10,
        avg_cost_basis: 5000,
        currency: 'MXN',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        latest_price: 6000,
        latest_price_currency: 'MXN',
        latest_price_date: '2024-01-10',
      },
    ])

    await useInvestmentStore.getState().fetch()

    const summary = useInvestmentStore.getState().portfolioSummary
    expect(summary.isMixedCurrency).toBe(true)
    expect(summary.totalsComplete).toBe(false)
    expect(summary.currencies).toEqual(['MXN', 'USD'])
    expect(summary.byCurrency).toEqual({
      USD: { marketValue: 3000, costBasis: 2000, gainLoss: 1000, count: 1 },
      MXN: { marketValue: 60000, costBasis: 50000, gainLoss: 10000, count: 1 },
    })
    expect(summary.totalMarketValue).toBeNull()
    expect(summary.totalCostBasis).toBeNull()
  })

  it('updates lastPriceFetch via setLastPriceFetch', () => {
    const now = '2024-06-01T12:00:00Z'
    useInvestmentStore.getState().setLastPriceFetch(now)
    expect(useInvestmentStore.getState().lastPriceFetch).toBe(now)
  })
})
