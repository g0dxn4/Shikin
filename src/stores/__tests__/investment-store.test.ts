import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
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
        latest_price_date: '2024-01-10',
      },
    ])

    await useInvestmentStore.getState().fetch()

    expect(useInvestmentStore.getState().investments).toHaveLength(1)
    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      id: 'inv-1',
      symbol: 'AAPL',
      currentPrice: 1500,
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
    })

    expect(useInvestmentStore.getState().isLoading).toBe(false)
    expect(useInvestmentStore.getState().fetchError).toBeNull()
    expect(useInvestmentStore.getState().error).toBeNull()
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
})
