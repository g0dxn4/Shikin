import { createElement, useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/valuation-read', () => ({ readOwnershipValuation: vi.fn() }))

import { readOwnershipValuation } from '@/lib/valuation-read'
import { useNetWorthStore } from '../net-worth-store'

const mockRead = vi.mocked(readOwnershipValuation)
const complete = {
  complete: true,
  targetCurrency: 'USD',
  totalAssetsCentavos: 12_500,
  totalLiabilitiesCentavos: 2_000,
  totalInvestmentsCentavos: 2_500,
  netWorthCentavos: 10_500,
  nativeTotals: [],
  missingCurrencies: [],
  unresolvedAccountIds: [],
  incompleteHoldingIds: [],
  accounts: [
    {
      id: 'card-credit',
      name: 'Card credit',
      type: 'credit_card',
      currency: 'USD',
      rawBalanceCentavos: 500,
      assetCentavos: 500,
      liabilityCentavos: 0,
      valuationMode: 'cash_plus_holdings' as const,
      linkedHoldingIds: [],
      included: true,
      reason: null,
    },
    {
      id: 'card-debt',
      name: 'Card debt',
      type: 'credit_card',
      currency: 'USD',
      rawBalanceCentavos: -2000,
      assetCentavos: 0,
      liabilityCentavos: 2000,
      valuationMode: 'cash_plus_holdings' as const,
      linkedHoldingIds: [],
      included: true,
      reason: null,
    },
  ],
  holdings: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function Caller() {
  const calculate = useNetWorthStore((state) => state.calculateCurrent)
  useEffect(() => {
    void calculate().catch(() => {})
  }, [calculate])
  return null
}

describe('ownership-aware net-worth store', () => {
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
      unresolvedAccountIds: [],
      incompleteHoldingIds: [],
      assetBreakdown: [],
      liabilityBreakdown: [],
      history: [],
      isLoading: false,
    })
  })

  it('keeps signed card credit as an asset and card debt as a liability', async () => {
    mockRead.mockResolvedValue(complete)
    await useNetWorthStore.getState().calculateCurrent()
    expect(useNetWorthStore.getState()).toMatchObject({
      totalAssets: 12_500,
      totalLiabilities: 2_000,
      netWorth: 10_500,
    })
    expect(useNetWorthStore.getState().assetBreakdown).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'card-credit', balance: 500 })])
    )
    expect(useNetWorthStore.getState().liabilityBreakdown).toEqual([
      expect.objectContaining({ id: 'card-debt', balance: -2000 }),
    ])
  })

  it('uses null totals and exposes unresolved ownership instead of guessing', async () => {
    mockRead.mockResolvedValue({
      ...complete,
      complete: false,
      totalAssetsCentavos: null,
      totalLiabilitiesCentavos: null,
      totalInvestmentsCentavos: null,
      netWorthCentavos: null,
      unresolvedAccountIds: ['broker'],
    })
    await useNetWorthStore.getState().calculateCurrent()
    expect(useNetWorthStore.getState()).toMatchObject({
      totalsComplete: false,
      netWorth: null,
      unresolvedAccountIds: ['broker'],
    })
  })

  it('preserves the module-level read queue across unmounts and after failures', async () => {
    const first = deferred<typeof complete>()
    mockRead.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(complete)
    const caller = render(createElement(Caller))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1))
    caller.unmount()
    render(createElement(Caller))
    await Promise.resolve()
    expect(mockRead).toHaveBeenCalledTimes(1)
    first.reject(new Error('read failed'))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(useNetWorthStore.getState().netWorth).toBe(10_500))
  })
})
