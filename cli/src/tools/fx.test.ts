// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'

const { mockGetCurrencySettings, mockListExchangeRates, mockSetMainCurrency, mockSetExchangeRate } =
  vi.hoisted(() => ({
    mockGetCurrencySettings: vi.fn(),
    mockListExchangeRates: vi.fn(),
    mockSetMainCurrency: vi.fn(),
    mockSetExchangeRate: vi.fn(),
  }))

vi.mock('../fx-service.js', () => ({
  getCurrencySettings: mockGetCurrencySettings,
  listExchangeRates: mockListExchangeRates,
  setMainCurrency: mockSetMainCurrency,
  setExchangeRate: mockSetExchangeRate,
}))

const { fxTools } = await import('./fx.js')
const getSettings = fxTools.find((tool) => tool.name === 'get-currency-settings')!
const setMain = fxTools.find((tool) => tool.name === 'set-main-currency')!
const listRates = fxTools.find((tool) => tool.name === 'list-exchange-rates')!
const setRate = fxTools.find((tool) => tool.name === 'set-exchange-rate')!

function rate(
  id: string,
  rateDecimal: string,
  supersedesRateId: string | null = null
): DatedExchangeRate {
  return {
    id,
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    rateDecimal,
    effectiveFrom: '2099-09-14',
    supersedesRateId,
    createdAt: `2099-09-14T0${supersedesRateId ? '2' : '1'}:00:00Z`,
    sourceNote: null,
  }
}

describe('dated FX automation tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrencySettings.mockReturnValue({ configured: false, mainCurrency: null })
    mockListExchangeRates.mockReturnValue([])
    mockSetMainCurrency.mockImplementation((currency: string) => ({
      configured: true,
      mainCurrency: currency,
    }))
    mockSetExchangeRate.mockImplementation((input) => ({
      ...rate('saved', input.rateDecimal, input.replacesRateId ?? null),
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      effectiveFrom: input.effectiveFrom,
    }))
  })

  it('declares precise read and audited write effects', () => {
    expect(getSettings.effects).toEqual({ readOnly: true, writesTo: [] })
    expect(listRates.effects).toEqual({ readOnly: true, writesTo: [] })
    expect(setMain.effects).toEqual({
      writesTo: ['settings', 'audit_log', 'app_data_state'],
    })
    expect(setRate.effects).toEqual({
      writesTo: ['manual_exchange_rates', 'audit_log', 'app_data_state'],
    })
  })

  it('reads an explicitly unconfigured setting and complete immutable history', async () => {
    const original = rate('original', '17')
    const correction = rate('correction', '17.25', original.id)
    mockListExchangeRates.mockReturnValue([original, correction])

    await expect(getSettings.execute({})).resolves.toEqual({
      configured: false,
      mainCurrency: null,
    })
    await expect(listRates.execute({})).resolves.toEqual({
      count: 2,
      rates: [
        expect.objectContaining({ id: 'original', direction: 'USD->MXN', status: 'corrected' }),
        expect.objectContaining({ id: 'correction', direction: 'USD->MXN', status: 'current' }),
      ],
    })
  })

  it('validates but does not write a main-currency dry run', async () => {
    const input = setMain.schema.parse({ currency: 'mxn', dryRun: true })

    await expect(setMain.execute(input)).resolves.toMatchObject({
      success: true,
      dryRun: true,
      before: { configured: false, mainCurrency: null },
      after: { configured: true, mainCurrency: 'MXN' },
    })
    expect(mockSetMainCurrency).not.toHaveBeenCalled()
    expect(() => setMain.schema.parse({ currency: 'USDT', dryRun: true })).toThrow()
  })

  it('writes main currency only after validation when not a dry run', async () => {
    const result = await setMain.execute(setMain.schema.parse({ currency: 'eur' }))

    expect(mockSetMainCurrency).toHaveBeenCalledWith('EUR')
    expect(result).toMatchObject({ success: true, configured: true, mainCurrency: 'EUR' })
  })

  it('keeps adapter-local today out of the public set-rate schema', async () => {
    const parsed = setRate.schema.parse({
      fromCurrency: 'usd',
      toCurrency: 'mxn',
      rateDecimal: '18.125',
      effectiveFrom: '2099-10-01',
      today: '1900-01-01',
    })

    expect(parsed).not.toHaveProperty('today')
    await setRate.execute(parsed)
    expect(mockSetExchangeRate).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCurrency: 'USD',
        toCurrency: 'MXN',
        rateDecimal: '18.125',
        effectiveFrom: '2099-10-01',
        today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    expect(mockSetExchangeRate.mock.calls[0]?.[0].today).not.toBe('1900-01-01')
  })

  it('validates a rate dry run without calling the mutation service', async () => {
    const input = setRate.schema.parse({
      fromCurrency: 'USD',
      toCurrency: 'MXN',
      rateDecimal: '18',
      effectiveFrom: '2099-10-01',
      dryRun: true,
    })

    await expect(setRate.execute(input)).resolves.toMatchObject({
      success: true,
      dryRun: true,
      rate: {
        fromCurrency: 'USD',
        toCurrency: 'MXN',
        rateDecimal: '18',
        effectiveFrom: '2099-10-01',
      },
    })
    expect(mockSetExchangeRate).not.toHaveBeenCalled()
  })

  it('requires correction acknowledgement and audit note before any write', async () => {
    const current = rate('current', '17')
    mockListExchangeRates.mockReturnValue([current])
    const input = setRate.schema.parse({
      fromCurrency: 'USD',
      toCurrency: 'MXN',
      rateDecimal: '17.5',
      effectiveFrom: current.effectiveFrom,
      replacesRateId: current.id,
      dryRun: true,
    })

    await expect(setRate.execute(input)).rejects.toThrow(/acknowledgement/)
    expect(mockSetExchangeRate).not.toHaveBeenCalled()
  })
})
