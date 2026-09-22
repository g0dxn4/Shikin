import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'
import type { Account } from '@/types/database'

const {
  mockStoreGet,
  mockGetCurrencySettings,
  mockListExchangeRates,
  mockSetMainCurrency,
  mockSetExchangeRate,
} = vi.hoisted(() => ({
  mockStoreGet: vi.fn(),
  mockGetCurrencySettings: vi.fn(),
  mockListExchangeRates: vi.fn(),
  mockSetMainCurrency: vi.fn(),
  mockSetExchangeRate: vi.fn(),
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue({ get: mockStoreGet }),
}))

vi.mock('@/lib/fx-service', () => ({
  getCurrencySettings: mockGetCurrencySettings,
  listExchangeRates: mockListExchangeRates,
  setMainCurrency: mockSetMainCurrency,
  setExchangeRate: mockSetExchangeRate,
}))

import { useCurrencyStore } from '../currency-store'

function rate(
  id: string,
  effectiveFrom: string,
  rateDecimal: string,
  fromCurrency = 'USD',
  toCurrency = 'MXN',
  supersedesRateId: string | null = null
): DatedExchangeRate {
  return {
    id,
    fromCurrency,
    toCurrency,
    rateDecimal,
    effectiveFrom,
    supersedesRateId,
    createdAt: `${effectiveFrom}T12:00:00Z`,
    sourceNote: null,
  }
}

function account(id: string, balance: number, currency: string): Account {
  return {
    id,
    name: `Account ${id}`,
    type: 'checking',
    balance,
    currency,
    icon: 'wallet',
    color: '#000000',
    is_archived: 0,
    created_at: '',
    updated_at: '',
  }
}

const history = [
  rate('rate-17', '2025-09-01', '17'),
  rate('rate-18', '2025-09-15', '18'),
  rate('future', '2026-01-01', '19'),
]

describe('currency-store dated FX adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 8, 20, 12))
    mockStoreGet.mockResolvedValue(null)
    mockGetCurrencySettings.mockResolvedValue({ configured: false, mainCurrency: null })
    mockListExchangeRates.mockResolvedValue([])
    mockSetMainCurrency.mockImplementation(async (currency: string) => ({
      configured: true,
      mainCurrency: currency,
    }))
    mockSetExchangeRate.mockResolvedValue(rate('saved', '2025-09-20', '18'))
    useCurrencyStore.setState({
      mainCurrency: null,
      preferredCurrency: 'USD',
      manualRates: [],
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => vi.useRealTimers())

  it('loads DB authority and full immutable manual history offline', async () => {
    mockStoreGet.mockResolvedValue('EUR')
    mockGetCurrencySettings.mockResolvedValue({ configured: true, mainCurrency: 'MXN' })
    mockListExchangeRates.mockResolvedValue(history)

    await useCurrencyStore.getState().loadRates()

    expect(useCurrencyStore.getState()).toMatchObject({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: history,
      isLoading: false,
      error: null,
    })
  })

  it('uses a legacy JSON preference only as an unconfigured setup draft', async () => {
    mockStoreGet.mockResolvedValue('eur')

    await useCurrencyStore.getState().loadRates()

    expect(useCurrencyStore.getState()).toMatchObject({
      mainCurrency: null,
      preferredCurrency: 'EUR',
      manualRates: [],
    })
    expect(mockSetMainCurrency).not.toHaveBeenCalled()
  })

  it('clears another database authority when either DB read fails', async () => {
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: history,
    })
    mockStoreGet.mockResolvedValue('EUR')
    mockListExchangeRates.mockRejectedValue(new Error('database unavailable'))

    await expect(useCurrencyStore.getState().loadRates()).rejects.toThrow('database unavailable')

    expect(useCurrencyStore.getState()).toMatchObject({
      mainCurrency: null,
      preferredCurrency: 'EUR',
      manualRates: [],
      isLoading: false,
      error: 'database unavailable',
    })
  })

  it('explicitly saves the DB-backed main choice without writing JSON or changing money', async () => {
    await useCurrencyStore.getState().setPreferredCurrency('mxn')

    expect(mockSetMainCurrency).toHaveBeenCalledWith('MXN')
    expect(useCurrencyStore.getState()).toMatchObject({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
    })
  })

  it('supplies trusted local today for rate saves and reloads DB state', async () => {
    mockGetCurrencySettings.mockResolvedValue({ configured: true, mainCurrency: 'MXN' })
    mockListExchangeRates.mockResolvedValue([rate('saved', '2025-09-20', '18')])

    await useCurrencyStore.getState().saveExchangeRate({
      fromCurrency: 'USD',
      toCurrency: 'MXN',
      rateDecimal: '18',
      effectiveFrom: '2025-09-20',
      sourceNote: 'Manual quote',
    })

    expect(mockSetExchangeRate).toHaveBeenCalledWith({
      fromCurrency: 'USD',
      toCurrency: 'MXN',
      rateDecimal: '18',
      effectiveFrom: '2025-09-20',
      sourceNote: 'Manual quote',
      today: '2025-09-20',
    })
    expect(useCurrencyStore.getState().manualRates).toHaveLength(1)
  })

  it('converts historical and current amounts by explicit effective date with exact provenance', () => {
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: history,
    })

    expect(
      useCurrencyStore.getState().convertHistoricalToPreferred(10_000, 'USD', '2025-09-14')
    ).toMatchObject({
      complete: true,
      preferredCurrency: 'MXN',
      amountCentavos: 170_000,
      conversion: {
        rateId: 'rate-17',
        rateDecimal: '17',
        effectiveFrom: '2025-09-01',
        asOfDate: '2025-09-14',
        direction: 'USD->MXN',
      },
    })
    expect(useCurrencyStore.getState().convertCurrentToPreferred(10_000, 'USD')).toMatchObject({
      complete: true,
      amountCentavos: 180_000,
      conversion: { rateId: 'rate-18', asOfDate: '2025-09-20' },
    })
  })

  it('never uses future or inverse rates and distinguishes missing main', () => {
    useCurrencyStore.setState({
      preferredCurrency: 'EUR',
      mainCurrency: null,
      manualRates: history,
    })
    expect(
      useCurrencyStore.getState().convertHistoricalToPreferred(10_000, 'USD', '2025-09-14')
    ).toEqual({
      complete: false,
      preferredCurrency: 'EUR',
      missingCurrencies: ['USD'],
      reason: 'main_currency_unconfigured',
    })

    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: history,
    })
    expect(
      useCurrencyStore.getState().convertHistoricalToPreferred(10_000, 'MXN', '2025-09-20')
    ).toMatchObject({
      complete: false,
      missingCurrencies: ['MXN'],
      reason: 'missing_exchange_rates',
      conversion: { rateId: null, rateDecimal: null, direction: 'MXN->USD' },
    })
  })

  it('returns invalid-currency diagnostics instead of treating malformed data as 1:1', () => {
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD', manualRates: [] })

    expect(useCurrencyStore.getState().convertCurrentToPreferred(100, 'USDT')).toMatchObject({
      complete: false,
      preferredCurrency: 'USD',
      missingCurrencies: [],
      reason: 'invalid_currency_data',
      invalidCurrencies: [{ accountId: null, accountName: null, value: 'USDT' }],
    })
  })

  it('keeps native account groups visible while main currency is unconfigured', () => {
    useCurrencyStore.setState({
      mainCurrency: null,
      preferredCurrency: 'EUR',
      manualRates: history,
    })

    expect(
      useCurrencyStore
        .getState()
        .getTotalBalanceInPreferred([account('usd', 100, 'USD'), account('mxn', 250, 'MXN')])
    ).toEqual({
      complete: false,
      preferredCurrency: 'EUR',
      missingCurrencies: [],
      reason: 'main_currency_unconfigured',
      nativeTotals: [
        { currency: 'MXN', amountCentavos: 250 },
        { currency: 'USD', amountCentavos: 100 },
      ],
    })
  })

  it('converts every account before summing and exposes known/native incomplete totals', () => {
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: [...history, rate('eur-mxn', '2025-09-01', '2.5', 'EUR', 'MXN')],
    })

    const complete = useCurrencyStore
      .getState()
      .getTotalBalanceInPreferred([
        account('native', 100, 'MXN'),
        account('usd-a', 1, 'USD'),
        account('usd-b', 1, 'USD'),
      ])
    expect(complete).toMatchObject({
      complete: true,
      amountCentavos: 136,
      knownTotalCentavos: 136,
      nativeTotals: [
        { currency: 'MXN', amountCentavos: 100 },
        { currency: 'USD', amountCentavos: 2 },
      ],
    })

    const incomplete = useCurrencyStore
      .getState()
      .getTotalBalanceInPreferred([account('native', 100, 'MXN'), account('cad', 50, 'CAD')])
    expect(incomplete).toMatchObject({
      complete: false,
      reason: 'missing_exchange_rates',
      missingCurrencies: ['CAD'],
      knownTotalCentavos: 100,
      nativeTotals: [
        { currency: 'CAD', amountCentavos: 50 },
        { currency: 'MXN', amountCentavos: 100 },
      ],
    })
    expect(incomplete).not.toHaveProperty('amountCentavos')
  })

  it('provides only direct exact decimal valuation rates as of local today', () => {
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: history,
    })
    expect(useCurrencyStore.getState().getCurrentValuationRates()).toEqual([
      { fromCurrency: 'USD', toCurrency: 'MXN', rateDecimal: '18' },
    ])

    useCurrencyStore.setState({ mainCurrency: null })
    expect(useCurrencyStore.getState().getCurrentValuationRates()).toEqual([])
  })
})
