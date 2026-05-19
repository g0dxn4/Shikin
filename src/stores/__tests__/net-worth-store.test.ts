import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query } from '@/lib/database'
import { useNetWorthStore } from '../net-worth-store'

const mockQuery = vi.mocked(query)

describe('net-worth-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNetWorthStore.setState({
      totalAssets: 0,
      totalLiabilities: 0,
      totalInvestments: 0,
      netWorth: 0,
      assetBreakdown: [],
      liabilityBreakdown: [],
      history: [],
      isLoading: false,
    })
  })

  it('values investments with the latest saved price when available', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'acct-checking',
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 10000,
          icon: null,
          color: null,
          is_archived: 0,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'inv-aapl',
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
        },
      ])

    await useNetWorthStore.getState().calculateCurrent()

    expect(useNetWorthStore.getState()).toMatchObject({
      totalInvestments: 3000,
      totalAssets: 13000,
      totalLiabilities: 0,
      netWorth: 13000,
    })
  })

  it('falls back to investment cost basis when no latest price exists', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'inv-cetes',
        account_id: null,
        symbol: 'CETES-28',
        name: 'CETES 28 días',
        type: 'cetes',
        shares: 3,
        avg_cost_basis: 2000,
        currency: 'MXN',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        latest_price: null,
      },
    ])

    await useNetWorthStore.getState().calculateCurrent()

    expect(useNetWorthStore.getState()).toMatchObject({
      totalInvestments: 6000,
      totalAssets: 6000,
      netWorth: 6000,
    })
  })

  it('adds investment account cash balance and linked holdings intentionally', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'acct-checking',
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 10000,
          icon: null,
          color: null,
          is_archived: 0,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'acct-brokerage',
          name: 'Brokerage Cash',
          type: 'investment',
          currency: 'USD',
          balance: 50000,
          icon: null,
          color: null,
          is_archived: 0,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'acct-card',
          name: 'Credit Card',
          type: 'credit_card',
          currency: 'USD',
          balance: -2000,
          icon: null,
          color: null,
          is_archived: 0,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'inv-voo',
          account_id: 'acct-brokerage',
          symbol: 'VOO',
          name: 'Vanguard S&P 500 ETF',
          type: 'etf',
          shares: 2,
          avg_cost_basis: 12000,
          currency: 'USD',
          notes: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          latest_price: 15000,
        },
      ])

    await useNetWorthStore.getState().calculateCurrent()

    expect(useNetWorthStore.getState()).toMatchObject({
      totalInvestments: 30000,
      totalAssets: 90000,
      totalLiabilities: 2000,
      netWorth: 88000,
    })
    expect(useNetWorthStore.getState().assetBreakdown).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'acct-brokerage', balance: 50000 })])
    )
  })
})
