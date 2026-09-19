import { beforeEach, describe, expect, it, vi } from 'vitest'
import { instrumentIdentityKey } from '@shikin/finance-core/valuation'
import type * as PriceService from '@/lib/price-service'

vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/ulid', () => ({ generateId: vi.fn(() => 'inv-test-id') }))
vi.mock('@/lib/price-service', async (importOriginal) => {
  const original = await importOriginal<typeof PriceService>()
  return { ...original, fetchVerifiedPrice: vi.fn() }
})
vi.mock('@/lib/storage', () => ({
  load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })),
}))
vi.mock('@/lib/exchange-rate-service', () => ({
  getCachedRates: vi.fn(async () => []),
  getLastFetchDate: vi.fn(async () => null),
  refreshRates: vi.fn(),
}))

import { execute, query } from '@/lib/database'
import { getCachedRates } from '@/lib/exchange-rate-service'
import { fetchVerifiedPrice } from '@/lib/price-service'
import { useInvestmentStore } from '../investment-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)
const mockFetchPrice = vi.mocked(fetchVerifiedPrice)
const mockGetCachedRates = vi.mocked(getCachedRates)
const identity = {
  assetType: 'stock' as const,
  provider: 'manual' as const,
  instrumentId: 'AAPL',
  exchange: 'XNAS',
  quoteCurrency: 'USD',
}
const key = instrumentIdentityKey(identity)

function row(overrides: Record<string, unknown> = {}) {
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
    mockGetCachedRates.mockResolvedValueOnce([
      { from_currency: 'MXN', to_currency: 'USD', rate: 0.05, date: '2026-04-18' },
    ])
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
})
