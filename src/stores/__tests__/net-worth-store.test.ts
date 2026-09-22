import { createElement, useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/valuation-read', () => ({ readOwnershipValuation: vi.fn() }))

import { execute, query } from '@/lib/database'
import { readOwnershipValuation } from '@/lib/valuation-read'
import { useCurrencyStore } from '../currency-store'
import { useNetWorthStore } from '../net-worth-store'

const mockRead = vi.mocked(readOwnershipValuation)
const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

function makeRate(id: string, rateDecimal: string, toCurrency = 'USD') {
  return {
    id,
    fromCurrency: 'EUR',
    toCurrency,
    rateDecimal,
    effectiveFrom: '2020-01-01',
    supersedesRateId: null,
    createdAt: '',
    sourceNote: null,
  }
}

function euroSnapshot(id: string, date: string, amountCentavos = 10_000) {
  return {
    id,
    date,
    total_assets: amountCentavos,
    total_liabilities: 0,
    net_worth: amountCentavos,
    total_investments: 0,
    breakdown_json: '{}',
    currency: 'EUR',
    created_at: '',
  }
}

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
      historyComplete: true,
      historyAuthorityKey: 'USD|',
      historyCurrency: 'USD',
      historyRequestedPeriod: '1y',
      historyRequestGeneration: 0,
      historyLoading: false,
      historyError: null,
      historyMissingCurrencies: [],
      historyNativeSnapshots: [],
      isLoading: false,
    })
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [],
      loadRates: vi.fn(async () => {}),
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

  it('uses one captured currency authority for delayed totals and account breakdowns', async () => {
    const delayed = deferred<typeof complete>()
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: [
        {
          id: 'usd-mxn',
          fromCurrency: 'USD',
          toCurrency: 'MXN',
          rateDecimal: '20',
          effectiveFrom: '2020-01-01',
          supersedesRateId: null,
          createdAt: '',
          sourceNote: null,
        },
      ],
    })
    mockRead.mockReturnValueOnce(delayed.promise)

    const calculation = useNetWorthStore.getState().calculateCurrent()
    await vi.waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1))
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD', manualRates: [] })
    delayed.resolve({
      ...complete,
      targetCurrency: 'MXN',
      totalAssetsCentavos: 10_000,
      accounts: [
        {
          ...complete.accounts[0],
          rawBalanceCentavos: 500,
          assetCentavos: 500,
        },
      ],
    })
    await calculation

    expect(useNetWorthStore.getState()).toMatchObject({
      preferredCurrency: 'MXN',
      totalAssets: 10_000,
      assetBreakdown: [{ id: 'card-credit', convertedBalance: 10_000 }],
    })
  })

  it('does not relabel today’s existing snapshot after a main-currency change', async () => {
    useNetWorthStore.setState({
      totalAssets: 12_500,
      totalLiabilities: 2_000,
      totalInvestments: 2_500,
      netWorth: 10_500,
      totalsComplete: true,
      preferredCurrency: 'MXN',
    })
    mockQuery.mockResolvedValueOnce([{ id: 'today-usd', currency: 'USD' }])

    await useNetWorthStore.getState().takeSnapshot()

    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('converts each stored history point at its own date', async () => {
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: [
        {
          id: 'sep-14',
          fromCurrency: 'USD',
          toCurrency: 'MXN',
          rateDecimal: '17',
          effectiveFrom: '2024-09-14',
          supersedesRateId: null,
          createdAt: '',
          sourceNote: null,
        },
        {
          id: 'sep-15',
          fromCurrency: 'USD',
          toCurrency: 'MXN',
          rateDecimal: '18',
          effectiveFrom: '2024-09-15',
          supersedesRateId: null,
          createdAt: '',
          sourceNote: null,
        },
      ],
    })
    mockQuery.mockResolvedValueOnce([
      {
        id: 'first',
        date: '2024-09-14',
        total_assets: 10_000,
        total_liabilities: 0,
        net_worth: 10_000,
        total_investments: 0,
        breakdown_json: '{}',
        currency: 'USD',
        created_at: '',
      },
      {
        id: 'second',
        date: '2024-09-15',
        total_assets: 10_000,
        total_liabilities: 0,
        net_worth: 10_000,
        total_investments: 0,
        breakdown_json: '{}',
        currency: 'USD',
        created_at: '',
      },
    ])

    await useNetWorthStore.getState().loadHistory('all')

    expect(useNetWorthStore.getState().history).toEqual([
      { date: '2024-09-14', netWorth: 170_000, assets: 170_000, liabilities: 0 },
      { date: '2024-09-15', netWorth: 180_000, assets: 180_000, liabilities: 0 },
    ])
  })

  it('keeps same-currency historical stocks as separate dated native evidence', async () => {
    useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'MXN', manualRates: [] })
    mockQuery.mockResolvedValueOnce([
      {
        id: 'first',
        date: '2024-09-14',
        total_assets: 10_000,
        total_liabilities: 0,
        net_worth: 10_000,
        total_investments: 0,
        breakdown_json: '{}',
        currency: 'USD',
        created_at: '',
      },
      {
        id: 'second',
        date: '2024-09-15',
        total_assets: 10_000,
        total_liabilities: 0,
        net_worth: 10_000,
        total_investments: 0,
        breakdown_json: '{}',
        currency: 'USD',
        created_at: '',
      },
    ])

    await useNetWorthStore.getState().loadHistory('all')

    expect(useNetWorthStore.getState()).toMatchObject({
      historyComplete: false,
      historyNativeSnapshots: [
        { id: 'first', date: '2024-09-14', currency: 'USD', amountCentavos: 10_000 },
        { id: 'second', date: '2024-09-15', currency: 'USD', amountCentavos: 10_000 },
      ],
    })
  })

  it('immediately withholds old converted history during a same-main rate correction, failure, and recovery', async () => {
    const row = euroSnapshot('eur-snapshot', '2024-01-15')
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [makeRate('eur-usd-v1', '2')],
    })
    mockQuery.mockResolvedValueOnce([row])
    await useNetWorthStore.getState().loadHistory('1y')

    expect(useNetWorthStore.getState()).toMatchObject({
      history: [{ date: '2024-01-15', netWorth: 20_000 }],
      historyComplete: true,
      historyAuthorityKey: 'USD|eur-usd-v1',
      historyCurrency: 'USD',
      historyRequestedPeriod: '1y',
    })

    const rejectedRead = deferred<(typeof row)[]>()
    useCurrencyStore.setState({ manualRates: [makeRate('eur-usd-v2', '3')] })
    mockQuery.mockReturnValueOnce(rejectedRead.promise)
    const rejectedLoad = useNetWorthStore.getState().loadHistory('1y')

    expect(useNetWorthStore.getState()).toMatchObject({
      history: [],
      historyComplete: false,
      historyAuthorityKey: 'USD|eur-usd-v2',
      historyCurrency: 'USD',
      historyRequestedPeriod: '1y',
      historyLoading: true,
      historyError: null,
    })

    rejectedRead.reject(new Error('history read failed'))
    await expect(rejectedLoad).rejects.toThrow('history read failed')
    expect(useNetWorthStore.getState()).toMatchObject({
      history: [],
      historyComplete: false,
      historyLoading: false,
      historyError: 'history read failed',
    })

    const recoveredRead = deferred<(typeof row)[]>()
    mockQuery.mockReturnValueOnce(recoveredRead.promise)
    const recoveredLoad = useNetWorthStore.getState().loadHistory('1y')
    expect(useNetWorthStore.getState().history).toEqual([])
    recoveredRead.resolve([row])
    await recoveredLoad

    expect(useNetWorthStore.getState()).toMatchObject({
      history: [{ date: '2024-01-15', netWorth: 30_000 }],
      historyComplete: true,
      historyAuthorityKey: 'USD|eur-usd-v2',
      historyCurrency: 'USD',
      historyLoading: false,
      historyError: null,
    })
  })

  it('ignores an initial history read completed under an obsolete authority before first refresh', async () => {
    const oldRead = deferred<ReturnType<typeof euroSnapshot>[]>()
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [makeRate('eur-usd', '2')],
    })
    mockQuery.mockReturnValueOnce(oldRead.promise)

    const load = useNetWorthStore.getState().loadHistory('6m')
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: [makeRate('eur-mxn', '20', 'MXN')],
    })

    expect(useNetWorthStore.getState()).toMatchObject({
      history: [],
      historyComplete: false,
      historyAuthorityKey: 'MXN|eur-mxn',
      historyCurrency: 'MXN',
      historyRequestedPeriod: '6m',
    })

    oldRead.resolve([euroSnapshot('old-usd', '2024-01-15')])
    await load
    expect(useNetWorthStore.getState()).toMatchObject({
      history: [],
      historyComplete: false,
      historyAuthorityKey: 'MXN|eur-mxn',
      historyCurrency: 'MXN',
    })
  })

  it('publishes only the latest requested period when history reads resolve in reverse order', async () => {
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD', manualRates: [] })
    const threeMonthRead = deferred<ReturnType<typeof euroSnapshot>[]>()
    const oneYearRead = deferred<ReturnType<typeof euroSnapshot>[]>()
    mockQuery.mockReturnValueOnce(threeMonthRead.promise).mockReturnValueOnce(oneYearRead.promise)

    const threeMonthLoad = useNetWorthStore.getState().loadHistory('3m')
    const oneYearLoad = useNetWorthStore.getState().loadHistory('1y')
    oneYearRead.resolve([
      { ...euroSnapshot('latest', '2024-01-15'), currency: 'USD', net_worth: 30_000 },
    ])
    await oneYearLoad
    expect(useNetWorthStore.getState()).toMatchObject({
      history: [{ date: '2024-01-15', netWorth: 30_000 }],
      historyComplete: true,
      historyRequestedPeriod: '1y',
    })

    threeMonthRead.resolve([
      { ...euroSnapshot('stale', '2024-02-15'), currency: 'USD', net_worth: 20_000 },
    ])
    await threeMonthLoad
    expect(useNetWorthStore.getState()).toMatchObject({
      history: [{ date: '2024-01-15', netWorth: 30_000 }],
      historyComplete: true,
      historyRequestedPeriod: '1y',
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

  it('withholds USD history across a fast current MXN recalculation and failed history reload, then recovers', async () => {
    const row = euroSnapshot('switch-snapshot', '2024-01-15')
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [makeRate('eur-usd', '2')],
    })
    mockRead.mockResolvedValue(complete)
    mockQuery.mockImplementation((sql) => {
      if (String(sql).includes('SELECT id, currency')) {
        return Promise.resolve([{ id: 'today', currency: 'USD' }])
      }
      return Promise.resolve([row])
    })
    await useNetWorthStore.getState().refresh('1y')
    expect(useNetWorthStore.getState().history[0]?.netWorth).toBe(20_000)

    const failedMxnRead = deferred<(typeof row)[]>()
    mockRead.mockResolvedValueOnce({ ...complete, targetCurrency: 'MXN' })
    mockQuery.mockImplementation((sql) => {
      if (String(sql).includes('net_worth_snapshots WHERE date >= ?')) return failedMxnRead.promise
      return Promise.resolve([{ id: 'today', currency: 'USD' }])
    })
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: [makeRate('eur-mxn', '20', 'MXN')],
    })

    expect(useNetWorthStore.getState()).toMatchObject({
      history: [],
      historyComplete: false,
      historyAuthorityKey: 'MXN|eur-mxn',
      historyCurrency: 'MXN',
    })
    await vi.waitFor(() => expect(useNetWorthStore.getState().preferredCurrency).toBe('MXN'))
    expect(useNetWorthStore.getState().history).toEqual([])
    failedMxnRead.reject(new Error('MXN history unavailable'))
    await vi.waitFor(() =>
      expect(useNetWorthStore.getState()).toMatchObject({
        historyComplete: false,
        historyLoading: false,
        historyError: 'MXN history unavailable',
      })
    )

    const recoveredMxnRead = deferred<(typeof row)[]>()
    mockQuery.mockReturnValueOnce(recoveredMxnRead.promise)
    const recovery = useNetWorthStore.getState().loadHistory('1y')
    recoveredMxnRead.resolve([row])
    await recovery
    expect(useNetWorthStore.getState()).toMatchObject({
      history: [{ date: '2024-01-15', netWorth: 200_000 }],
      historyComplete: true,
      historyAuthorityKey: 'MXN|eur-mxn',
      historyCurrency: 'MXN',
      historyError: null,
    })
  })
})
