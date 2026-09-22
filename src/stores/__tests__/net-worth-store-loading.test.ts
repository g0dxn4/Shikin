import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/valuation-read', () => ({ readOwnershipValuation: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function valuation(targetCurrency: string | null) {
  return {
    complete: true,
    targetCurrency,
    totalAssetsCentavos: 0,
    totalLiabilitiesCentavos: 0,
    totalInvestmentsCentavos: 0,
    netWorthCentavos: 0,
    nativeTotals: [],
    missingCurrencies: [],
    unresolvedAccountIds: [],
    incompleteHoldingIds: [],
    accounts: [],
    holdings: [],
  }
}

async function loadFreshStores() {
  vi.resetModules()
  const { query, execute } = await import('@/lib/database')
  const { readOwnershipValuation } = await import('@/lib/valuation-read')
  const { useCurrencyStore } = await import('../currency-store')
  const { useNetWorthStore } = await import('../net-worth-store')
  const mockQuery = vi.mocked(query)
  const mockExecute = vi.mocked(execute)
  const mockRead = vi.mocked(readOwnershipValuation)

  mockQuery.mockResolvedValue([])
  mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
  useCurrencyStore.setState({
    mainCurrency: 'USD',
    preferredCurrency: 'USD',
    manualRates: [],
    loadRates: vi.fn(async () => {}),
  })

  return { mockQuery, mockRead, useCurrencyStore, useNetWorthStore }
}

describe('net-worth root loading ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves the selected history period during a periodless startup refresh', async () => {
    const { mockRead, useNetWorthStore } = await loadFreshStores()
    mockRead.mockImplementation(async ({ targetCurrency }) => valuation(targetCurrency))

    await useNetWorthStore.getState().refresh()
    expect(useNetWorthStore.getState().historyRequestedPeriod).toBe('1y')
    await useNetWorthStore.getState().loadHistory('6m')
    await useNetWorthStore.getState().refresh()
    expect(useNetWorthStore.getState()).toMatchObject({
      historyRequestedPeriod: '6m',
      historyComplete: true,
      historyLoading: false,
      isLoading: false,
    })

    await useNetWorthStore.getState().refresh('3m')
    expect(useNetWorthStore.getState().historyRequestedPeriod).toBe('3m')
  })

  it('settles loading after an authority replacement successfully reloads history', async () => {
    const { mockRead, useCurrencyStore, useNetWorthStore } = await loadFreshStores()
    const firstValuation = deferred<ReturnType<typeof valuation>>()
    mockRead
      .mockReturnValueOnce(firstValuation.promise)
      .mockImplementation(async ({ targetCurrency }) => valuation(targetCurrency))

    const initialRefresh = useNetWorthStore.getState().refresh('1y')
    await vi.waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1))
    useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'MXN' })
    firstValuation.resolve(valuation('USD'))

    await initialRefresh
    await vi.waitFor(() =>
      expect(useNetWorthStore.getState()).toMatchObject({
        historyCurrency: 'MXN',
        historyComplete: true,
        historyLoading: false,
      })
    )
    expect(useNetWorthStore.getState().isLoading).toBe(false)
  })

  it('settles loading after an authority replacement history read fails', async () => {
    const { mockQuery, mockRead, useCurrencyStore, useNetWorthStore } = await loadFreshStores()
    const firstValuation = deferred<ReturnType<typeof valuation>>()
    mockRead
      .mockReturnValueOnce(firstValuation.promise)
      .mockImplementation(async ({ targetCurrency }) => valuation(targetCurrency))
    mockQuery.mockRejectedValueOnce(new Error('replacement history failed'))

    const initialRefresh = useNetWorthStore.getState().refresh('1y')
    await vi.waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1))
    useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'MXN' })
    firstValuation.resolve(valuation('USD'))

    await initialRefresh
    await vi.waitFor(() =>
      expect(useNetWorthStore.getState()).toMatchObject({
        historyComplete: false,
        historyLoading: false,
        historyError: 'replacement history failed',
      })
    )
    expect(useNetWorthStore.getState().isLoading).toBe(false)
  })

  it('does not let an older authority replacement clear a newer root refresh loading state', async () => {
    const { mockQuery, mockRead, useCurrencyStore, useNetWorthStore } = await loadFreshStores()
    const firstValuation = deferred<ReturnType<typeof valuation>>()
    const latestHistory = deferred<never[]>()
    mockRead
      .mockReturnValueOnce(firstValuation.promise)
      .mockImplementation(async ({ targetCurrency }) => valuation(targetCurrency))
    mockQuery.mockImplementation((sql) => {
      if (String(sql).includes('SELECT id, currency')) {
        return Promise.resolve([{ id: 'today-mxn', currency: 'MXN' }])
      }
      return latestHistory.promise
    })

    const initialRefresh = useNetWorthStore.getState().refresh('1y')
    await vi.waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1))
    useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'MXN' })
    const latestRefresh = useNetWorthStore.getState().refresh('3m')
    firstValuation.resolve(valuation('USD'))

    await initialRefresh
    await vi.waitFor(() => {
      expect(mockRead).toHaveBeenCalledTimes(3)
      expect(useNetWorthStore.getState()).toMatchObject({
        historyRequestedPeriod: '3m',
        historyLoading: true,
      })
    })
    expect(useNetWorthStore.getState().isLoading).toBe(true)

    latestHistory.resolve([])
    await latestRefresh
    expect(useNetWorthStore.getState()).toMatchObject({
      historyRequestedPeriod: '3m',
      historyComplete: true,
      historyLoading: false,
      isLoading: false,
    })
  })
})
