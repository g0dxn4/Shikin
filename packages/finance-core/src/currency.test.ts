import { describe, expect, it } from 'vitest'
import { aggregateCentavosByCurrency } from './currency'
import * as currency from './currency'

describe('currency aggregation', () => {
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

  it('preserves empty totals, normalized ordering and arbitrary nonempty currencies', () => {
    expect(aggregateCentavosByCurrency([])).toEqual([])
    expect(
      aggregateCentavosByCurrency([
        { currency: ' usd ', amountCentavos: -7 },
        { currency: 'zzz', amountCentavos: 3 },
        { currency: 'eur', amountCentavos: 0 },
        { currency: 'USD', amountCentavos: 7 },
      ])
    ).toEqual([
      { currency: 'EUR', amountCentavos: 0 },
      { currency: 'USD', amountCentavos: 0 },
      { currency: 'ZZZ', amountCentavos: 3 },
    ])
  })

  it.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe centavos %s without rounding',
    (amountCentavos) => {
      expect(() => aggregateCentavosByCurrency([{ currency: 'USD', amountCentavos }])).toThrow(
        new RangeError('amountCentavos must be a safe integer')
      )
    }
  )

  it('preserves currency validation precedence and intermediate-total overflow', () => {
    expect(() => aggregateCentavosByCurrency([{ currency: ' ', amountCentavos: NaN }])).toThrow(
      new TypeError('currency must not be empty')
    )
    expect(() =>
      aggregateCentavosByCurrency([
        { currency: 'USD', amountCentavos: Number.MAX_SAFE_INTEGER },
        { currency: 'USD', amountCentavos: 1 },
        { currency: 'USD', amountCentavos: -1 },
      ])
    ).toThrow(new RangeError('Centavo total for USD exceeds the safe integer range'))
  })

  it('exports only currency aggregation, not the retired undated converter', () => {
    expect(Object.keys(currency).sort()).toEqual(['aggregateCentavosByCurrency'])
  })
})
