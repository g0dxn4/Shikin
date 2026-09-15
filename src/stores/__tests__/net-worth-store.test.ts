import { createElement, useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query } from '@/lib/database'
import { useNetWorthStore } from '../net-worth-store'

const mockQuery = vi.mocked(query)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function account(balance: number) {
  return {
    id: `acct-${balance}`,
    name: 'Checking',
    type: 'checking',
    currency: 'USD',
    balance,
    icon: null,
    color: null,
    is_archived: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function NetWorthCalculationCaller() {
  const calculateCurrent = useNetWorthStore((state) => state.calculateCurrent)

  useEffect(() => {
    void calculateCurrent().catch(() => {})
  }, [calculateCurrent])

  return null
}

describe('net-worth-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNetWorthStore.setState({
      totalAssets: 0,
      totalLiabilities: 0,
      totalInvestments: 0,
      netWorth: 0,
      totalsComplete: true,
      preferredCurrency: 'USD',
      missingCurrencies: [],
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
        currency: 'USD',
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

  it('marks totals unavailable when an exchange rate is missing', async () => {
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
        latest_price: null,
      },
    ])

    await useNetWorthStore.getState().calculateCurrent()

    expect(useNetWorthStore.getState()).toMatchObject({
      totalsComplete: false,
      totalInvestments: 0,
      netWorth: 0,
      missingCurrencies: ['MXN'],
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

  it('serializes calculations across unmounted and remounted callers', async () => {
    const firstAccounts = deferred<ReturnType<typeof account>[]>()
    mockQuery
      .mockImplementationOnce(() => firstAccounts.promise)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([account(20000)])
      .mockResolvedValueOnce([])

    const firstCaller = render(createElement(NetWorthCalculationCaller))
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
    firstCaller.unmount()

    render(createElement(NetWorthCalculationCaller))
    await Promise.resolve()

    expect(mockQuery).toHaveBeenCalledTimes(1)

    firstAccounts.resolve([account(10000)])

    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(useNetWorthStore.getState().netWorth).toBe(20000))
  })

  it('propagates a calculation failure without poisoning later queued reads', async () => {
    const failedAccounts = deferred<ReturnType<typeof account>[]>()
    mockQuery
      .mockImplementationOnce(() => failedAccounts.promise)
      .mockResolvedValueOnce([account(30000)])
      .mockResolvedValueOnce([])

    const failed = useNetWorthStore.getState().calculateCurrent()
    const later = useNetWorthStore.getState().calculateCurrent()
    const failedExpectation = expect(failed).rejects.toThrow('Account query failed')

    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
    failedAccounts.reject(new Error('Account query failed'))

    await failedExpectation
    await later

    expect(mockQuery).toHaveBeenCalledTimes(3)
    expect(useNetWorthStore.getState().netWorth).toBe(30000)
  })
})
