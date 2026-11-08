import { describe, expect, it } from 'vitest'
import { instrumentIdentityKey, multiplyDecimalsToCentavos } from '@shikin/finance-core/valuation'
import {
  QUOTE_HISTORY_FETCH_LIMIT,
  buildCompleteAllocation,
  quoteCurrencyEncodedInInstrumentKey,
  selectCurrentQuantityQuotePlot,
  type QuoteHistoryHolding,
  type QuoteHistorySeriesPoint,
} from '../investment-presentation'

const usdIdentity = {
  assetType: 'stock' as const,
  provider: 'manual' as const,
  instrumentId: 'AAPL',
  exchange: 'XNAS',
  quoteCurrency: 'USD',
}

const mxnIdentity = {
  ...usdIdentity,
  instrumentId: 'WALMEX',
  quoteCurrency: 'MXN',
}

const malformedInstrumentKeys = [
  '',
  'v0|stock|manual|AAPL|XNAS|USD',
  'v2|stock|manual|AAPL|XNAS|USD',
  'V1|stock|manual|AAPL|XNAS|USD',
  'stock|manual|AAPL|XNAS|USD',
  'v1|stock|manual|AAPL|XNAS',
  'v1|stock|manual|AAPL|XNAS|USD|extra',
  'v1||manual|AAPL|XNAS|USD',
  'v1|stock||AAPL|XNAS|USD',
  'v1|stock|manual||XNAS|USD',
  'v1|stock|manual|AAPL|XNAS|',
  'v1|option|manual|AAPL|XNAS|USD',
  'v1|Stock|manual|AAPL|XNAS|USD',
  'v1|stock|yahoo|AAPL|XNAS|USD',
  'v1|stock|Manual|AAPL|XNAS|USD',
  'v1|stock|manual|%|XNAS|USD',
  'v1|stock|manual|AAPL|%2|USD',
  'v1|stock|manual|AAPL|XNAS|%GG',
  'v1|stock|manual|%C3%28|XNAS|USD',
  'v1|stock|manual|%ED%A0%80|XNAS|USD',
  'v1|stock%7Cetf|manual|AAPL|XNAS|USD',
  'v1|stock|manual%7Cfinnhub|AAPL|XNAS|USD',
  'v1|stock|manual|A%7CB|XNAS|USD',
  'v1|stock|manual|AAPL|X%7CY|USD',
  'v1|stock|manual|AAPL|XNAS|U%7CD',
  'v1|%73tock|manual|AAPL|XNAS|USD',
  'v1|stock|%6Danual|AAPL|XNAS|USD',
  'v1|stock|manual|%41APL|XNAS|USD',
  'v1|stock|manual|AAPL|%58NAS|USD',
  'v1|stock|manual|AAPL|XNAS|%55SD',
  'v1|stock|manual|A%2fB|XNAS|USD',
  'v1|stock|manual|A/B|XNAS|USD',
  'v1|stock|manual|ACCIÓN|XNAS|USD',
  'v1|stock|manual| AAPL|XNAS|USD',
  'v1|stock|manual|AAPL%20|XNAS|USD',
  'v1|stock|manual|%20|XNAS|USD',
  'v1|stock|manual|AAPL|%20XNAS|USD',
  'v1|stock|manual|AAPL|XNAS|usd',
  'v1|stock|manual|AAPL|XNAS|%20USD',
  'v1|stock|manual|AAPL|XNAS|%20',
]

const canonicalInstrumentKeys = [
  ['v1|stock|manual|AAPL|XNAS|USD', 'USD'],
  ['v1|stock|manual|AAPL||USD', 'USD'],
  ['v1|stock|manual|A%2FB|XNAS|USD', 'USD'],
  ['v1|stock|manual|A%25B|XNAS|USD', 'USD'],
  ['v1|stock|manual|A%257CB|XNAS|USD', 'USD'],
  ['v1|stock|manual|ACCI%C3%93N|XNAS|MXN', 'MXN'],
  ['v1|stock|manual|AAPL|X%20NAS|USD', 'USD'],
  ['v1|stock|manual|AAPL|XNAS|XYZ', 'XYZ'],
  ['v1|stock|manual|AAPL|XNAS|U%2FS', 'U/S'],
] as const

function holding(
  identity: {
    assetType: 'stock' | 'etf' | 'crypto' | 'bond' | 'mutual_fund' | 'cetes' | 'other'
    provider: 'manual' | 'alpha_vantage' | 'finnhub' | 'coingecko'
    instrumentId: string
    exchange: string
    quoteCurrency: string
  },
  overrides: Partial<QuoteHistoryHolding> = {}
): QuoteHistoryHolding {
  return {
    id: identity.instrumentId,
    instrumentKey: instrumentIdentityKey(identity),
    quantityDecimal: '2',
    assetType: identity.assetType,
    provider: identity.provider,
    instrumentId: identity.instrumentId,
    exchange: identity.exchange,
    currentPriceCurrency: identity.quoteCurrency,
    ...overrides,
  }
}

function history(prices: Array<[string, string]>): QuoteHistorySeriesPoint[] {
  return prices.map(([date, unitPriceDecimal]) => ({ date, unitPriceDecimal }))
}

describe('buildCompleteAllocation', () => {
  it('uses exact converted shares and distinct chart colors, with no width floor', () => {
    const allocation = buildCompleteAllocation({
      totalsComplete: true,
      currency: 'eur',
      totalMarketValue: 1050,
      byType: {
        cash: { marketValue: 0 },
        stock: { marketValue: 999 },
        etf: { marketValue: 1 },
        crypto: { marketValue: 50 },
      },
    })

    expect(allocation?.currency).toBe('EUR')
    expect(allocation?.segments.map((segment) => segment.type)).toEqual(['stock', 'etf', 'crypto'])
    const tiny = allocation?.segments.find((segment) => segment.type === 'etf')
    expect(tiny?.widthPercent).toBe(`${(1 / 1050) * 100}%`)
    expect(tiny?.widthPercent).not.toContain('8%')
    expect(tiny?.widthPercent).not.toContain('2px')
    expect(new Set(allocation?.segments.map((segment) => segment.color)).size).toBe(3)
    expect(allocation?.segments.every((segment) => segment.color.includes('chart-'))).toBe(true)
    expect(allocation?.segments.some((segment) => segment.color.includes('opacity'))).toBe(false)
  })

  it('withholds an incomplete, unreconciled, empty, or negative allocation', () => {
    expect(
      buildCompleteAllocation({
        totalsComplete: false,
        currency: 'USD',
        totalMarketValue: 100,
        byType: { stock: { marketValue: 100 } },
      })
    ).toBeNull()
    expect(
      buildCompleteAllocation({
        totalsComplete: true,
        currency: null,
        totalMarketValue: 100,
        byType: { stock: { marketValue: 100 } },
      })
    ).toBeNull()
    expect(
      buildCompleteAllocation({
        totalsComplete: true,
        currency: 'USD',
        totalMarketValue: 101,
        byType: { stock: { marketValue: 100 } },
      })
    ).toBeNull()
    expect(
      buildCompleteAllocation({
        totalsComplete: true,
        currency: 'USD',
        totalMarketValue: 0,
        byType: {},
      })
    ).toBeNull()
    expect(
      buildCompleteAllocation({
        totalsComplete: true,
        currency: 'USD',
        totalMarketValue: 50,
        byType: { stock: { marketValue: 80 }, etf: { marketValue: -30 } },
      })
    ).toBeNull()
  })
})

describe('quoteCurrencyEncodedInInstrumentKey', () => {
  it('reads quote currency from a core identity key and rejects a currency-stripped key', () => {
    const key = instrumentIdentityKey(mxnIdentity)
    expect(quoteCurrencyEncodedInInstrumentKey(key)).toBe('MXN')
    expect(key).not.toContain('rowCurrency')
    expect(quoteCurrencyEncodedInInstrumentKey('v1|stock|manual|AAPL|XNAS')).toBeNull()
    expect(quoteCurrencyEncodedInInstrumentKey(`${key}|extra`)).toBeNull()
  })

  it.each(malformedInstrumentKeys)('rejects malformed or noncanonical key %j', (key) => {
    expect(quoteCurrencyEncodedInInstrumentKey(key)).toBeNull()
  })

  it.each(canonicalInstrumentKeys)('reads canonical key %s as %s', (key, currency) => {
    expect(quoteCurrencyEncodedInInstrumentKey(key)).toBe(currency)
  })

  it.each(['stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'cetes', 'other'])(
    'accepts the existing %s asset type',
    (assetType) => {
      expect(quoteCurrencyEncodedInInstrumentKey(`v1|${assetType}|manual|AAPL|XNAS|USD`)).toBe(
        'USD'
      )
    }
  )

  it.each(['manual', 'alpha_vantage', 'finnhub', 'coingecko'])(
    'accepts the existing %s provider',
    (provider) => {
      expect(quoteCurrencyEncodedInInstrumentKey(`v1|stock|${provider}|AAPL|XNAS|USD`)).toBe('USD')
    }
  )
})

describe('selectCurrentQuantityQuotePlot', () => {
  const left = holding(usdIdentity, { id: 'left', quantityDecimal: '2' })
  const right = holding(
    { ...usdIdentity, instrumentId: 'MSFT' },
    { id: 'right', quantityDecimal: '1' }
  )

  function provenMap(): Map<string, QuoteHistorySeriesPoint[]> {
    return new Map([
      [
        left.instrumentKey!,
        history([
          ['2026-01-01', '10'],
          ['2026-02-01', '12'],
        ]),
      ],
      [
        right.instrumentKey!,
        history([
          ['2026-01-01', '4'],
          ['2026-02-01', '5'],
        ]),
      ],
    ])
  }

  it.each(malformedInstrumentKeys)('withholds ownership for malformed key %j', (key) => {
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [holding(usdIdentity, { instrumentKey: key })],
        historyByKey: new Map([
          [
            key,
            history([
              ['2026-01-01', '10'],
              ['2026-02-01', '12'],
            ]),
          ],
        ]),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toEqual({
      status: 'withheld',
      reason: 'ownership-unproven',
      rangeSelectable: false,
    })
  })

  it('reports encoded quote currency before competing ownership failures', () => {
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [
          holding(usdIdentity, {
            instrumentKey: 'v1|stock|manual|WALMEX|XNAS|MXN',
            provider: null,
            quantityDecimal: '',
          }),
        ],
        historyByKey: provenMap(),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toEqual({
      status: 'withheld',
      reason: 'quote-currency-mismatch',
      rangeSelectable: false,
    })
  })

  it.each([
    { assetType: 'option' },
    { assetType: 'etf' },
    { provider: 'yahoo' },
    { provider: 'finnhub' },
  ])('withholds mismatched holding identity %j', (overrides) => {
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [holding(usdIdentity, overrides)],
        historyByKey: provenMap(),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toEqual({
      status: 'withheld',
      reason: 'ownership-unproven',
      rangeSelectable: false,
    })
  })

  it('preserves encoder normalization when proving holding identity', () => {
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [
          holding(usdIdentity, {
            instrumentId: ' AAPL ',
            exchange: ' XNAS ',
            currentPriceCurrency: ' usd ',
          }),
        ],
        historyByKey: provenMap(),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toEqual({
      status: 'plot',
      currency: 'USD',
      points: [
        { date: '2026-01-01', valueCentavos: 2000 },
        { date: '2026-02-01', valueCentavos: 2400 },
      ],
    })
  })

  it('sums current quantities at shared recorded quotes in the report currency', () => {
    const plot = selectCurrentQuantityQuotePlot({
      holdings: [left, right],
      historyByKey: provenMap(),
      reportCurrency: 'USD',
      totalsComplete: true,
      rangeStart: null,
    })

    expect(plot).toEqual({
      status: 'plot',
      currency: 'USD',
      points: [
        {
          date: '2026-01-01',
          valueCentavos:
            multiplyDecimalsToCentavos(['2', '10']) + multiplyDecimalsToCentavos(['1', '4']),
        },
        {
          date: '2026-02-01',
          valueCentavos:
            multiplyDecimalsToCentavos(['2', '12']) + multiplyDecimalsToCentavos(['1', '5']),
        },
      ],
    })
    if (plot.status !== 'plot') throw new Error('expected plot')
    expect(plot.points).toHaveLength(2)
    expect(plot.points.map((point) => point.date)).toEqual(['2026-01-01', '2026-02-01'])
  })

  it('keeps a large safe centavo total exact instead of compacting it', () => {
    const large = holding(usdIdentity, { quantityDecimal: '1000000000.5' })
    const plot = selectCurrentQuantityQuotePlot({
      holdings: [large],
      historyByKey: new Map([
        [
          large.instrumentKey!,
          history([
            ['2026-03-01', '2'],
            ['2026-03-02', '2'],
          ]),
        ],
      ]),
      reportCurrency: 'USD',
      totalsComplete: true,
      rangeStart: null,
    })
    expect(plot.status).toBe('plot')
    if (plot.status !== 'plot') throw new Error('expected plot')
    expect(plot.points[0]?.valueCentavos).toBe(multiplyDecimalsToCentavos(['1000000000.5', '2']))
    expect(plot.points[0]?.valueCentavos).toBeGreaterThan(1_000_000_000)
  })

  it('withholds mixed quote currencies, foreign quotes, and unproven ownership', () => {
    const mxn = holding(mxnIdentity)
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [left, mxn],
        historyByKey: new Map([
          [
            left.instrumentKey!,
            history([
              ['2026-01-01', '1'],
              ['2026-01-02', '1'],
            ]),
          ],
          [
            mxn.instrumentKey!,
            history([
              ['2026-01-01', '1'],
              ['2026-01-02', '1'],
            ]),
          ],
        ]),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toMatchObject({
      status: 'withheld',
      reason: 'quote-currency-mismatch',
      rangeSelectable: false,
    })

    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [mxn],
        historyByKey: new Map([
          [
            mxn.instrumentKey!,
            history([
              ['2026-01-01', '1'],
              ['2026-01-02', '1'],
            ]),
          ],
        ]),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      }).status
    ).toBe('withheld')

    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [holding(usdIdentity, { instrumentKey: 'v1|stock|manual|OTHER|XNAS|USD' })],
        historyByKey: provenMap(),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toMatchObject({ status: 'withheld', reason: 'ownership-unproven' })

    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [holding(usdIdentity, { provider: null })],
        historyByKey: provenMap(),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toMatchObject({ status: 'withheld', reason: 'ownership-unproven' })
  })

  it('does not draw a line from fewer than two common recorded dates or a forward-filled gap', () => {
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [left],
        historyByKey: new Map([[left.instrumentKey!, history([['2026-01-01', '10']])]]),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toMatchObject({
      status: 'withheld',
      reason: 'fewer-than-two-common-dates',
      rangeSelectable: true,
    })

    const gapped = selectCurrentQuantityQuotePlot({
      holdings: [left, right],
      historyByKey: new Map([
        [
          left.instrumentKey!,
          history([
            ['2026-01-01', '10'],
            ['2026-01-03', '11'],
          ]),
        ],
        [
          right.instrumentKey!,
          history([
            ['2026-01-02', '4'],
            ['2026-01-03', '5'],
          ]),
        ],
      ]),
      reportCurrency: 'USD',
      totalsComplete: true,
      rangeStart: null,
    })
    expect(gapped).toMatchObject({ status: 'withheld', reason: 'fewer-than-two-common-dates' })
    expect(gapped).not.toMatchObject({ status: 'plot' })
  })

  it('withholds missing, partial, invalid, truncated, or incomplete-total history', () => {
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [left, right],
        historyByKey: new Map([
          [
            left.instrumentKey!,
            history([
              ['2026-01-01', '10'],
              ['2026-02-01', '12'],
            ]),
          ],
        ]),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toMatchObject({ status: 'withheld', reason: 'history-missing', rangeSelectable: false })

    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [left],
        historyByKey: new Map([
          [
            left.instrumentKey!,
            history([
              ['2026-01-01', '10'],
              ['2026-02-31', '12'],
            ]),
          ],
        ]),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toMatchObject({ status: 'withheld', reason: 'series-invalid' })

    const truncatedPoints = Array.from({ length: QUOTE_HISTORY_FETCH_LIMIT }, (_, index) => {
      const date = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10)
      return [date, '1'] as [string, string]
    })
    expect(truncatedPoints).toHaveLength(QUOTE_HISTORY_FETCH_LIMIT)
    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [left],
        historyByKey: new Map([[left.instrumentKey!, history(truncatedPoints)]]),
        reportCurrency: 'USD',
        totalsComplete: true,
        rangeStart: null,
      })
    ).toMatchObject({ status: 'withheld', reason: 'series-truncated', rangeSelectable: true })

    expect(
      selectCurrentQuantityQuotePlot({
        holdings: [left],
        historyByKey: provenMap(),
        reportCurrency: 'USD',
        totalsComplete: false,
        rangeStart: null,
      })
    ).toMatchObject({ status: 'withheld', reason: 'totals-incomplete', rangeSelectable: false })
  })

  it('matches the populated QA fixture: current quantities at three shared recorded quotes', () => {
    const north = holding(
      {
        assetType: 'stock',
        provider: 'manual',
        instrumentId: 'QA-NORTHWIND',
        exchange: 'QA-MANUAL',
        quoteCurrency: 'USD',
      },
      { id: 'north', quantityDecimal: '12' }
    )
    const harbor = holding(
      {
        assetType: 'etf',
        provider: 'manual',
        instrumentId: 'QA-HARBOR',
        exchange: 'QA-MANUAL',
        quoteCurrency: 'USD',
      },
      { id: 'harbor', quantityDecimal: '5' }
    )
    expect(north.instrumentKey).toBe('v1|stock|manual|QA-NORTHWIND|QA-MANUAL|USD')
    expect(harbor.instrumentKey).toBe('v1|etf|manual|QA-HARBOR|QA-MANUAL|USD')

    const plot = selectCurrentQuantityQuotePlot({
      holdings: [north, harbor],
      historyByKey: new Map([
        [
          north.instrumentKey!,
          history([
            ['2026-08-15', '76.5'],
            ['2026-09-16', '81.25'],
            ['2026-10-17', '84.5'],
          ]),
        ],
        [
          harbor.instrumentKey!,
          history([
            ['2026-08-15', '118.4'],
            ['2026-09-16', '122.1'],
            ['2026-10-17', '125.6'],
          ]),
        ],
      ]),
      reportCurrency: 'USD',
      totalsComplete: true,
      rangeStart: null,
    })

    expect(plot).toEqual({
      status: 'plot',
      currency: 'USD',
      points: [
        { date: '2026-08-15', valueCentavos: 151000 },
        { date: '2026-09-16', valueCentavos: 158550 },
        { date: '2026-10-17', valueCentavos: 164200 },
      ],
    })
  })

  it('does not need a history-row currency column when the key currency is the report currency', () => {
    const points = history([
      ['2026-04-01', '3'],
      ['2026-04-02', '4'],
    ])
    expect(points.every((point) => !('currency' in point))).toBe(true)
    const plot = selectCurrentQuantityQuotePlot({
      holdings: [left],
      historyByKey: new Map([[left.instrumentKey!, points]]),
      reportCurrency: 'usd',
      totalsComplete: true,
      rangeStart: '2026-04-01',
    })
    expect(plot).toMatchObject({ status: 'plot', currency: 'USD' })
  })
})
