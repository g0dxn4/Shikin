import { describe, expect, it } from 'vitest'
import {
  apportionConvertedAmount,
  assertFxDate,
  convertCentavosAsOf,
  convertDatedAmounts,
  planExchangeRate,
  selectEffectiveRate,
  selectValuationRatesAsOf,
  validateRateDecimal,
  type DatedExchangeRate,
} from './fx'
const rate = (
  id: string,
  effectiveFrom: string,
  rateDecimal: string,
  supersedesRateId: string | null = null
): DatedExchangeRate => ({
  id,
  fromCurrency: 'USD',
  toCurrency: 'MXN',
  rateDecimal,
  effectiveFrom,
  supersedesRateId,
  createdAt: '2025-09-01T00:00:00Z',
  sourceNote: null,
})
const rates = [
  rate('17', '2025-09-01', '17'),
  rate('18', '2025-09-15', '18'),
  rate('future', '2026-01-01', '19'),
]
const convert = (amountCentavos: number, asOfDate = '2025-09-14', history = rates) =>
  convertCentavosAsOf({
    amountCentavos,
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    asOfDate,
    rates: history,
  })
describe('dated manual FX', () => {
  it('uses transaction date, midmonth boundary and explicitly supplied current date, never future/provider/inverse', () => {
    expect(convert(10000).amountCentavos).toBe(170000)
    expect(convert(10000, '2025-09-15').amountCentavos).toBe(180000)
    expect(convert(10000, '2025-12-31').rateId).toBe('18')
    expect(convert(10000, '2025-08-31')).toMatchObject({
      complete: false,
      amountCentavos: null,
      missingReason: 'missing_direct_rate',
    })
    expect(
      convertCentavosAsOf({
        amountCentavos: 100,
        fromCurrency: 'MXN',
        toCurrency: 'USD',
        asOfDate: '2025-10-01',
        rates,
      }).complete
    ).toBe(false)
    expect(
      convertCentavosAsOf({
        amountCentavos: -100,
        fromCurrency: 'USD',
        toCurrency: 'USD',
        asOfDate: '2025-10-01',
        rates: [],
      })
    ).toMatchObject({ complete: true, amountCentavos: -100, rateDecimal: '1', rateId: null })
    expect(selectValuationRatesAsOf(rates, 'MXN', '2025-09-15')).toEqual([
      { fromCurrency: 'USD', toCurrency: 'MXN', rateDecimal: '18' },
    ])
  })
  it('validates exact decimals, signed half-cent, tiny rates and safe boundaries', () => {
    const half = [rate('half', '2025-09-01', '0.5')]
    expect(convert(1, undefined, half).amountCentavos).toBe(1)
    expect(convert(-1, undefined, half).amountCentavos).toBe(-1)
    expect(
      convert(1, undefined, [rate('tiny', '2025-09-01', `0.${'0'.repeat(39)}1`)]).amountCentavos
    ).toBe(0)
    expect(
      convert(Number.MAX_SAFE_INTEGER, undefined, [rate('one', '2025-09-01', '1')]).amountCentavos
    ).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => convert(Number.MAX_SAFE_INTEGER)).toThrow(/safe integer/)
    expect(() => convert(1.1)).toThrow()
    for (const bad of [
      '1e-2',
      'NaN',
      'Infinity',
      '-1',
      '0',
      '+1',
      '.5',
      ' 1',
      '1.',
      '0.' + '1'.repeat(41),
    ])
      expect(() => validateRateDecimal(bad)).toThrow()
    expect(validateRateDecimal('001.2300')).toBe('1.23')
  })
  it('rejects impossible/non-calendar dates without timezone normalization', () => {
    for (const bad of [
      '2025-02-29',
      '1900-02-29',
      '2025-04-31',
      '2025-00-01',
      '2025-01-00',
      '0000-01-01',
      '2025-09-15T00:00:00Z',
      '2025-9-15',
    ])
      expect(() => assertFxDate(bad)).toThrow()
    for (const good of ['2000-02-29', '2024-02-29', '2025-09-15'])
      expect(() => assertFxDate(good)).not.toThrow()
  })
  it('converts parents individually and preserves known/native subtotals and unresolved IDs', () => {
    const result = convertDatedAmounts(
      [
        { id: 'a', amountCentavos: 1, currency: 'USD', date: '2025-09-01' },
        { id: 'b', amountCentavos: 1, currency: 'USD', date: '2025-09-01' },
        { id: 'missing', amountCentavos: 300, currency: 'EUR', date: '2025-09-01' },
      ],
      'MXN',
      [rate('half', '2025-09-01', '0.5')]
    )
    expect(result).toMatchObject({
      complete: false,
      totalCentavos: null,
      knownTotalCentavos: 2,
      unresolvedIds: ['missing'],
      nativeTotals: [
        { currency: 'EUR', amountCentavos: 300 },
        { currency: 'USD', amountCentavos: 2 },
      ],
    })
    expect(() =>
      convertDatedAmounts(
        [
          { id: 'a', amountCentavos: Number.MAX_SAFE_INTEGER, currency: 'USD', date: '2025-09-01' },
          { id: 'b', amountCentavos: 1, currency: 'USD', date: '2025-09-01' },
        ],
        'USD',
        []
      )
    ).toThrow(/safe integer/)
  })
  it('apportions with stable ID ties, signed symmetry, validated original totals and exact sum', () => {
    const allocations = [
      { id: 'b', amountCentavos: 1 },
      { id: 'a', amountCentavos: 1 },
      { id: 'c', amountCentavos: 1 },
    ]
    expect(apportionConvertedAmount(2, allocations, 3)).toEqual([
      { id: 'b', amountCentavos: 1 },
      { id: 'a', amountCentavos: 1 },
      { id: 'c', amountCentavos: 0 },
    ])
    expect(apportionConvertedAmount(-2, allocations, -3).map((r) => r.amountCentavos)).toEqual([
      -1, -1, 0,
    ])
    for (let target = 0; target < 200; target++)
      expect(
        apportionConvertedAmount(target, allocations, 3).reduce((s, r) => s + r.amountCentavos, 0)
      ).toBe(target)
    expect(() => apportionConvertedAmount(2, allocations, 4)).toThrow(/original/)
    expect(() => apportionConvertedAmount(-2, allocations, 3)).toThrow(/sign/)
    expect(() => apportionConvertedAmount(2, [{ id: 'a', amountCentavos: 0 }], 0)).toThrow()
  })
  it('rejects ambiguous chains and requires optimistic leaf corrections with acknowledgement', () => {
    const correction = rate('corrected', '2025-09-01', '17.1', '17')
    expect(
      selectEffectiveRate([...rates, correction].reverse(), 'USD', 'MXN', '2025-09-14')?.id
    ).toBe('corrected')
    for (const bad of [
      [...rates, correction, rate('fork', '2025-09-01', '17.2', '17')],
      [...rates, rate('duplicate', '2025-09-01', '17')],
      [rate('a', '2025-09-01', '17', 'b'), rate('b', '2025-09-01', '17', 'a')],
      [correction],
    ])
      expect(() => selectEffectiveRate(bad, 'USD', 'MXN', '2025-09-14')).toThrow()
    const input = {
      fromCurrency: 'USD',
      toCurrency: 'MXN',
      effectiveFrom: '2025-09-01',
      rateDecimal: '17.2',
      today: '2025-09-30',
      replacesRateId: '17',
    }
    expect(() => planExchangeRate(rates, input, { id: 'new', createdAt: 'now' })).toThrow(
      /acknowledgement/
    )
    const acknowledged = {
      ...input,
      acknowledgeHistoricalChange: true,
      auditNote: 'Correct transcription',
    }
    expect(
      planExchangeRate(rates, acknowledged, { id: 'new', createdAt: 'now' }).rate.supersedesRateId
    ).toBe('17')
    expect(() =>
      planExchangeRate([...rates, correction], acknowledged, { id: 'new', createdAt: 'now' })
    ).toThrow(/Stale/)
  })
})
