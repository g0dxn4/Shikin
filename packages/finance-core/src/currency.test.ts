import { describe, expect, it } from 'vitest'
import { aggregateCentavosByCurrency, convertCurrencyTotals } from './currency'

describe('currency aggregation and conversion', () => {
  it('aggregates integer centavos independently by normalized currency', () => {
    expect(
      aggregateCentavosByCurrency([
        { currency: 'mxn', amountCentavos: 10_001 },
        { currency: ' MXN ', amountCentavos: -1 },
        { currency: 'USD', amountCentavos: 250 },
      ])
    ).toEqual([
      { currency: 'MXN', amountCentavos: 10_000 },
      { currency: 'USD', amountCentavos: 250 },
    ])
  })

  it('returns a complete centavo total only when every conversion is explicit', () => {
    const totals = [
      { currency: 'EUR', amountCentavos: 10_00 },
      { currency: 'USD', amountCentavos: 20_00 },
    ]

    expect(
      convertCurrencyTotals(totals, 'USD', [{ fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.1 }])
    ).toMatchObject({ complete: true, totalCentavos: 3_100, missingCurrencies: [] })

    expect(convertCurrencyTotals(totals, 'USD', [])).toEqual({
      complete: false,
      targetCurrency: 'USD',
      totalCentavos: null,
      missingCurrencies: ['EUR'],
      converted: [
        {
          currency: 'USD',
          amountCentavos: 2_000,
          targetCurrency: 'USD',
          rate: 1,
          convertedAmountCentavos: 2_000,
        },
      ],
    })
  })
})
