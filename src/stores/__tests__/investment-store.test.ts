import { beforeEach, describe, expect, it, vi } from 'vitest'
import { instrumentIdentityKey } from '@shikin/finance-core/valuation'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'
import type * as PriceService from '@/lib/price-service'
import type { InvestmentValuationRow } from '@/lib/valuation-read'

vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/ulid', () => ({ generateId: vi.fn(() => 'inv-test-id') }))
vi.mock('@/lib/price-service', async (importOriginal) => {
  const original = await importOriginal<typeof PriceService>()
  return { ...original, fetchVerifiedPrice: vi.fn() }
})
vi.mock('@/lib/storage', () => ({
  load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })),
}))

import { execute, query } from '@/lib/database'
import { useCurrencyStore } from '../currency-store'
import { fetchVerifiedPrice } from '@/lib/price-service'
import { useInvestmentStore } from '../investment-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)
const mockFetchPrice = vi.mocked(fetchVerifiedPrice)
const identity = {
  assetType: 'stock' as const,
  provider: 'manual' as const,
  instrumentId: 'AAPL',
  exchange: 'XNAS',
  quoteCurrency: 'USD',
}
const key = instrumentIdentityKey(identity)

function row(overrides: Record<string, unknown> = {}): InvestmentValuationRow {
  return {
    id: 'inv-1',
    account_id: null,
    symbol: 'AAPL',
    name: 'Apple',
    type: 'stock',
    shares: 0.1,
    quantity_decimal: '0.123456789012345678',
    avg_cost_basis: 0,
    avg_cost_basis_decimal: '0',
    cost_basis_known: 1,
    instrument_key: key,
    currency: 'USD',
    notes: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    price_instrument_key: key,
    price_asset_type: 'stock',
    price_provider: 'manual',
    price_instrument_id: 'AAPL',
    price_exchange: 'XNAS',
    price_quote_currency: 'USD',
    unit_price_decimal: '0.123456789012345678',
    quote_date: '2026-04-18',
    ...overrides,
  }
}

describe('precise investment store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useInvestmentStore.setState({
      investments: [],
      priceHistory: new Map(),
      isLoading: false,
      fetchError: null,
      error: null,
      lastPriceFetch: null,
      refreshFailures: {},
    })
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [],
      loadRates: vi.fn(async () => {}),
    })
  })

  it('uses exact quantity and authoritative identity-keyed quote', async () => {
    mockQuery.mockResolvedValueOnce([row()])
    await useInvestmentStore.getState().fetch()
    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      quantityDecimal: '0.123456789012345678',
      marketValue: 2,
      currentPriceDecimal: '0.123456789012345678',
      gainLoss: 2,
    })
  })

  it('normalizes a tiny legacy quantity while disclosing legacy number precision', async () => {
    mockQuery.mockResolvedValueOnce([
      row({ shares: 1e-7, quantity_decimal: null, unit_price_decimal: '10000000' }),
    ])

    await useInvestmentStore.getState().fetch()

    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      quantityDecimal: '0.0000001',
      quantityPrecision: 'legacy_number',
      marketValue: 100,
    })
  })

  it('uses converted cost basis for the same cross-currency ROI fixture as the CLI', async () => {
    useCurrencyStore.setState({
      manualRates: [
        {
          id: 'mxn-usd',
          fromCurrency: 'MXN',
          toCurrency: 'USD',
          rateDecimal: '0.05',
          effectiveFrom: '2000-01-01',
          supersedesRateId: null,
          createdAt: '2000-01-01T00:00:00Z',
          sourceNote: null,
        },
      ],
    })
    mockQuery.mockResolvedValueOnce([
      row({
        shares: 1,
        quantity_decimal: '1',
        avg_cost_basis: 10000,
        avg_cost_basis_decimal: '100',
        currency: 'MXN',
        unit_price_decimal: '10',
      }),
    ])

    await useInvestmentStore.getState().fetch()

    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      marketValue: 1000,
      convertedCostBasis: 500,
      gainLoss: 500,
      gainLossPercent: 100,
    })
  })

  it('keeps native holding value but clears old target values when main is unset', async () => {
    useCurrencyStore.setState({ mainCurrency: null, preferredCurrency: 'USD', manualRates: [] })
    mockQuery.mockResolvedValueOnce([row()])

    await useInvestmentStore.getState().fetch()

    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      marketValue: 2,
      convertedMarketValue: null,
      valuationComplete: false,
      valuationReasons: expect.arrayContaining(['main_currency_unconfigured']),
    })
    expect(useInvestmentStore.getState().portfolioSummary).toMatchObject({
      totalMarketValue: null,
      preferredCurrency: null,
      totalsComplete: false,
    })
  })

  it('does not trust legacy symbol-only price fields', async () => {
    mockQuery.mockResolvedValueOnce([
      row({
        instrument_key: null,
        price_instrument_key: null,
        unit_price_decimal: null,
        latest_price: 999999,
      }),
    ])
    await useInvestmentStore.getState().fetch()
    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      marketValue: null,
      valuationComplete: false,
    })
    expect(useInvestmentStore.getState().portfolioSummary.totalMarketValue).toBeNull()
  })

  it('suppresses gains for unknown basis but distinguishes known zero', async () => {
    mockQuery.mockResolvedValueOnce([row({ cost_basis_known: 0, avg_cost_basis_decimal: null })])
    await useInvestmentStore.getState().fetch()
    expect(useInvestmentStore.getState().investments[0]).toMatchObject({
      costBasisKnown: false,
      gainLoss: null,
    })
  })

  it('writes exact decimal fields and a verified manual zero quote', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockResolvedValue([])
    await useInvestmentStore.getState().add({
      symbol: 'MAN',
      name: 'Manual',
      type: 'other',
      quantityDecimal: '0.00000001',
      avgCostDecimal: '0',
      costBasisKnown: true,
      currency: 'USD',
      priceProvider: 'manual',
      instrumentId: 'manual-asset',
      quoteCurrency: 'USD',
      manualPriceDecimal: '0',
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO investments'),
      expect.arrayContaining(['0.00000001', '0', 1])
    )
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO instrument_prices'),
      expect.arrayContaining(['0'])
    )
  })

  it('does not mutate or discard the accepted identity when provider refresh fails', async () => {
    useInvestmentStore.setState({
      investments: [
        {
          ...row(),
          quantityDecimal: '0.123456789012345678',
          quantityPrecision: 'exact_decimal',
          avgCostBasisDecimal: '0',
          costBasisKnown: true,
          currentPrice: 12,
          currentPriceDecimal: '0.123456789012345678',
          currentPriceCurrency: 'USD',
          priceProvider: 'manual',
          priceInstrumentId: 'AAPL',
          priceExchange: 'XNAS',
          marketValue: 2,
          convertedMarketValue: 2,
          costBasis: 0,
          convertedCostBasis: 0,
          gainLoss: 2,
          gainLossPercent: null,
          lastPriceDate: '2026-04-18',
          valuationComplete: true,
          valuationReasons: [],
        },
      ] as never,
    })
    mockFetchPrice.mockRejectedValue(new Error('provider unavailable'))
    await expect(
      useInvestmentStore.getState().update('inv-1', {
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        quantityDecimal: '1',
        costBasisKnown: false,
        currency: 'USD',
        priceProvider: 'finnhub',
        instrumentId: 'AAPL',
        exchange: 'US',
        quoteCurrency: 'USD',
      })
    ).rejects.toThrow('provider unavailable')
    expect(mockExecute).not.toHaveBeenCalled()
    expect(useInvestmentStore.getState().investments[0]?.instrument_key).toBe(key)
  })

  it('persists empty or whitespace notes as NULL, omits to preserve, and leaves identity/money unchanged', async () => {
    const holding = {
      ...row({ id: 'inv-1', account_id: 'acct-1', notes: 'keep notes' }),
      quantityDecimal: '0.123456789012345678',
      quantityPrecision: 'exact_decimal',
      avgCostBasisDecimal: '0',
      costBasisKnown: true,
      currentPrice: 12,
      currentPriceDecimal: '0.123456789012345678',
      currentPriceCurrency: 'USD',
      priceProvider: 'manual',
      priceInstrumentId: 'AAPL',
      priceExchange: 'XNAS',
      marketValue: 2,
      convertedMarketValue: 2,
      costBasis: 0,
      convertedCostBasis: 0,
      gainLoss: 2,
      gainLossPercent: null,
      lastPriceDate: '2026-04-18',
      valuationComplete: true,
      valuationReasons: [],
    }
    const seed = () => useInvestmentStore.setState({ investments: [holding] as never })
    seed()
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockResolvedValue([])

    const base = {
      symbol: 'AAPL',
      name: 'Apple',
      type: 'stock' as const,
      shares: 0.1,
      quantityDecimal: '0.123456789012345678',
      avgCostDecimal: '0',
      costBasisKnown: true,
      currency: 'USD' as const,
      accountId: 'acct-1',
    }

    expect(useInvestmentStore.getState().getById('inv-1')?.id).toBe('inv-1')
    await useInvestmentStore.getState().update('inv-1', { ...base, notes: '   ' })
    const whitespaceCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE investments')
    )
    expect(whitespaceCall?.[1]).toEqual([
      'acct-1',
      'AAPL',
      'Apple',
      'stock',
      0.1,
      '0.123456789012345678',
      0,
      '0',
      1,
      key,
      'USD',
      null,
      expect.any(String),
      'inv-1',
    ])

    mockExecute.mockClear()
    seed()
    await useInvestmentStore.getState().update('inv-1', base)
    const omittedCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE investments')
    )
    expect(omittedCall?.[1]?.[11]).toBe('keep notes')
    expect(omittedCall?.[1]?.slice(0, 11)).toEqual([
      'acct-1',
      'AAPL',
      'Apple',
      'stock',
      0.1,
      '0.123456789012345678',
      0,
      '0',
      1,
      key,
      'USD',
    ])

    mockExecute.mockClear()
    await useInvestmentStore.getState().add({
      symbol: 'MSFT',
      name: 'Microsoft',
      type: 'stock',
      quantityDecimal: '1',
      avgCostDecimal: '0',
      costBasisKnown: true,
      currency: 'USD',
      notes: '   ',
    })
    const insertCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO investments')
    )
    expect(insertCall?.[1]?.[12]).toBeNull()
  })
})

function authorityRate(id: string): DatedExchangeRate {
  return {
    id,
    fromCurrency: 'MXN',
    toCurrency: 'USD',
    rateDecimal: '0.05',
    effectiveFrom: '2000-01-01',
    supersedesRateId: null,
    createdAt: '2000-01-01T00:00:00Z',
    sourceNote: null,
  }
}

async function freshAuthorityStores() {
  vi.resetModules()
  // Fresh imports exercise module-time subscription registration and its initial sentinel.
  const { useCurrencyStore: currency } = await import('../currency-store')
  const { useInvestmentStore: investments } = await import('../investment-store')
  return { currency, investments }
}

describe('investment currency authority subscription', () => {
  it('keeps its empty-string sentinel and exact ordered key across equivalent notifications', async () => {
    const { currency, investments } = await freshAuthorityStores()
    const callbacks: string[] = []
    investments.setState({
      investments: [row()] as never,
      fetch: vi.fn(async () => {
        const state = currency.getState()
        callbacks.push(
          `${state.mainCurrency ?? 'null'}:${state.manualRates.map((rate) => rate.id).join(',')}`
        )
      }),
    })

    currency.setState({ preferredCurrency: 'MXN' })
    currency.setState({ isLoading: true })
    currency.setState({ manualRates: [] })
    currency.setState({ mainCurrency: 'USD' })
    currency.setState({ manualRates: [authorityRate('r1'), authorityRate('r2')] })
    currency.setState({ manualRates: [authorityRate('r1'), authorityRate('r2')] })
    currency.setState({ isLoading: false, preferredCurrency: 'EUR' })
    currency.setState({ manualRates: [authorityRate('r2'), authorityRate('r1')] })
    currency.setState({ mainCurrency: ' USD ', manualRates: [authorityRate(' r2 ')] })

    expect(callbacks).toEqual(['null:', 'USD:', 'USD:r1,r2', 'USD:r2,r1', ' USD : r2 '])
  })

  it('does not activate empty holdings even while loading and swallows populated refresh failures', async () => {
    const { currency, investments } = await freshAuthorityStores()
    const callbacks: string[] = []
    investments.setState({
      isLoading: true,
      fetch: vi.fn(async () => {
        callbacks.push('refresh rejected')
        throw new Error('valuation unavailable')
      }),
    })
    currency.setState({ mainCurrency: 'USD', manualRates: [authorityRate('r1')] })
    currency.setState({ mainCurrency: 'MXN' })
    expect(callbacks).toEqual([])

    investments.setState({ investments: [row()] as never })
    currency.setState({ isLoading: true })
    currency.setState({ manualRates: [authorityRate('r1')] })
    expect(callbacks).toEqual([])

    currency.setState({ manualRates: [authorityRate('r1'), authorityRate('r2')] })
    await Promise.resolve()
    expect(callbacks).toEqual(['refresh rejected'])
    expect(investments.getState().isLoading).toBe(true)
    expect(investments.getState().fetchError).toBeNull()
  })

  it('keeps read-before-authority order, publication order, and selected price history on authority failure', async () => {
    const { currency, investments } = await freshAuthorityStores()
    const trace: unknown[] = []
    const priceHistory = new Map([
      ['selected-instrument', [{ date: '2026-04-18', unitPriceDecimal: '1' }]],
    ])
    currency.setState({
      mainCurrency: 'USD',
      loadRates: vi.fn(async () => {
        trace.push('load authority')
        throw new Error('authority unavailable')
      }),
    })
    investments.setState({ priceHistory })
    mockQuery.mockReset()
    mockQuery.mockImplementation(async () => {
      trace.push('read holdings')
      return [row()]
    })
    const unsubscribe = investments.subscribe((state) => {
      trace.push({
        loading: state.isLoading,
        ids: state.investments.map((holding) => holding.id),
        total: state.portfolioSummary.totalMarketValue,
        fetchError: state.fetchError,
      })
    })

    try {
      await investments.getState().fetch()
      expect(trace).toEqual([
        { loading: true, ids: [], total: 0, fetchError: null },
        'read holdings',
        'load authority',
        { loading: true, ids: ['inv-1'], total: 0, fetchError: null },
        { loading: true, ids: ['inv-1'], total: 2, fetchError: null },
        { loading: false, ids: ['inv-1'], total: 2, fetchError: null },
      ])
      expect(investments.getState().priceHistory).toBe(priceHistory)
    } finally {
      unsubscribe()
    }
  })

  it('publishes only the latest overlapping holdings read and retains failed-read error timing', async () => {
    const { currency, investments } = await freshAuthorityStores()
    const trace: unknown[] = []
    let finishOld!: (rows: InvestmentValuationRow[]) => void
    let finishNew!: (rows: InvestmentValuationRow[]) => void
    // The project's ES2020 library target does not expose Promise.withResolvers.
    const oldRows = new Promise<InvestmentValuationRow[]>((resolve) => {
      finishOld = resolve
    })
    const newRows = new Promise<InvestmentValuationRow[]>((resolve) => {
      finishNew = resolve
    })
    currency.setState({
      mainCurrency: 'USD',
      loadRates: vi.fn(async () => {
        trace.push('load authority')
      }),
    })
    mockQuery.mockReset()
    mockQuery
      .mockImplementationOnce(() => {
        trace.push('read old')
        return oldRows
      })
      .mockImplementationOnce(() => {
        trace.push('read new')
        return newRows
      })
    const unsubscribe = investments.subscribe((state) => {
      trace.push([
        state.isLoading,
        state.investments.map((holding) => holding.id),
        state.fetchError,
      ])
    })

    try {
      const oldRead = investments.getState().fetch()
      const newRead = investments.getState().fetch()
      finishNew([row({ id: 'new' })])
      await newRead
      finishOld([row({ id: 'old' })])
      await oldRead
      mockQuery.mockRejectedValueOnce(new Error('holdings unavailable'))
      await expect(investments.getState().fetch()).rejects.toThrow('holdings unavailable')
      expect(trace).toEqual([
        [true, [], null],
        'read old',
        [true, [], null],
        'read new',
        'load authority',
        [true, ['new'], null],
        [true, ['new'], null],
        [false, ['new'], null],
        'load authority',
        [true, ['new'], null],
        [true, ['new'], 'holdings unavailable'],
        [false, ['new'], 'holdings unavailable'],
      ])
    } finally {
      unsubscribe()
    }
  })
})
