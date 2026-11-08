import { describe, expect, it } from 'vitest'
import {
  calculateOwnershipValuation,
  decimalFromNumber,
  decodeInstrumentIdentityKey,
  instrumentIdentityKey,
  multiplyDecimalsToCentavos,
  valueHolding,
  type HoldingValuationInput,
  type InstrumentIdentity,
} from './valuation'

const identity: InstrumentIdentity = {
  assetType: 'stock',
  provider: 'manual',
  instrumentId: 'AAPL',
  exchange: 'XNAS',
  quoteCurrency: 'USD',
}
const instrumentKey = instrumentIdentityKey(identity)

function holding(overrides: Partial<HoldingValuationInput> = {}): HoldingValuationInput {
  return {
    id: 'holding',
    accountId: null,
    assetType: 'stock',
    quantityDecimal: '0.123456789012345678',
    costCurrency: 'USD',
    costBasisKnown: true,
    avgCostBasisDecimal: '0',
    instrumentKey,
    price: {
      ...identity,
      instrumentKey,
      unitPriceDecimal: '0.123456789012345678',
      quoteDate: '2026-04-18',
    },
    ...overrides,
  }
}

describe('decodeInstrumentIdentityKey', () => {
  it.each([
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
  ])('rejects the presentation-characterized malformed or noncanonical key %j', (key) => {
    expect(decodeInstrumentIdentityKey(key)).toBeNull()
  })

  it.each([
    ['v1|stock|manual|AAPL|XNAS|USD', 'AAPL', 'XNAS', 'USD'],
    ['v1|stock|manual|AAPL||USD', 'AAPL', '', 'USD'],
    ['v1|stock|manual|A%2FB|XNAS|USD', 'A/B', 'XNAS', 'USD'],
    ['v1|stock|manual|A%25B|XNAS|USD', 'A%B', 'XNAS', 'USD'],
    ['v1|stock|manual|A%257CB|XNAS|USD', 'A%7CB', 'XNAS', 'USD'],
    ['v1|stock|manual|ACCI%C3%93N|XNAS|MXN', 'ACCIÓN', 'XNAS', 'MXN'],
    ['v1|stock|manual|AAPL|X%20NAS|USD', 'AAPL', 'X NAS', 'USD'],
    ['v1|stock|manual|AAPL|XNAS|XYZ', 'AAPL', 'XNAS', 'XYZ'],
    ['v1|stock|manual|AAPL|XNAS|U%2FS', 'AAPL', 'XNAS', 'U/S'],
  ])(
    'decodes the complete identity of canonical key %s',
    (key, instrumentId, exchange, quoteCurrency) => {
      const decoded = decodeInstrumentIdentityKey(key)
      expect(decoded).toEqual({
        assetType: 'stock',
        provider: 'manual',
        instrumentId,
        exchange,
        quoteCurrency,
      })
      expect(instrumentIdentityKey(decoded!)).toBe(key)
    }
  )

  it.each(['stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'cetes', 'other'])(
    'accepts the existing %s asset type',
    (assetType) => {
      expect(decodeInstrumentIdentityKey(`v1|${assetType}|manual|AAPL|XNAS|USD`)).toEqual({
        ...identity,
        assetType,
      })
    }
  )

  it.each(['manual', 'alpha_vantage', 'finnhub', 'coingecko'])(
    'accepts the existing %s provider',
    (provider) => {
      expect(decodeInstrumentIdentityKey(`v1|stock|${provider}|AAPL|XNAS|USD`)).toEqual({
        ...identity,
        provider,
      })
    }
  )
})

describe('precise valuation', () => {
  it('multiplies fractional quantities and sub-cent prices before rounding once', () => {
    expect(multiplyDecimalsToCentavos(['0.123456789012345678', '0.123456789012345678'])).toBe(2)
  })

  it('expands bounded numeric exponent notation without inventing extra digits', () => {
    expect(decimalFromNumber(1e-7)).toBe('0.0000001')
    expect(decimalFromNumber(-1.25e3)).toBe('-1250')
    expect(() => decimalFromNumber(1e-41)).toThrow('supported precision')
  })

  it('rejects negative positions and bounds decimal multiplication work', () => {
    expect(() => valueHolding(holding({ quantityDecimal: '-1' }), 'USD')).toThrow(
      'quantity must be non-negative'
    )
    expect(() => multiplyDecimalsToCentavos(Array(17).fill('1'))).toThrow(
      'Too many decimal factors'
    )
  })

  it('preserves sub-cent value through FX before target rounding', () => {
    const result = valueHolding(
      holding({
        quantityDecimal: '1',
        price: {
          ...identity,
          instrumentKey,
          unitPriceDecimal: '0.0049',
          quoteDate: '2026-04-18',
        },
      }),
      'MXN',
      [{ fromCurrency: 'USD', toCurrency: 'MXN', rateDecimal: '20' }]
    )

    expect(result.valueCentavos).toBe(0)
    expect(result.convertedValueCentavos).toBe(10)
  })

  it('distinguishes unknown and explicitly known-zero cost basis', () => {
    expect(
      valueHolding(holding({ costBasisKnown: false, avgCostBasisDecimal: null }), 'USD')
        .gainLossCentavos
    ).toBeNull()
    expect(
      valueHolding(holding({ costBasisKnown: true, avgCostBasisDecimal: '0' }), 'USD')
        .gainLossCentavos
    ).toBe(2)
  })

  it('keeps same-ticker asset types, listings, providers, and currencies distinct', () => {
    const variants: InstrumentIdentity[] = [
      identity,
      { ...identity, assetType: 'crypto' },
      { ...identity, exchange: 'XMEX' },
      { ...identity, provider: 'finnhub' },
      { ...identity, quoteCurrency: 'MXN' },
    ]
    expect(new Set(variants.map(instrumentIdentityKey)).size).toBe(variants.length)
  })

  it('fails closed for an identity collision', () => {
    const result = valueHolding(
      holding({
        price: {
          ...identity,
          assetType: 'crypto',
          instrumentKey,
          unitPriceDecimal: '100',
          quoteDate: '2026-04-18',
        },
      }),
      'USD'
    )
    expect(result.complete).toBe(false)
    expect(result.reasons).toContain('verified_price_missing')
  })

  it('retains known native holding totals when target FX is missing', () => {
    const mxnIdentity: InstrumentIdentity = {
      ...identity,
      exchange: 'XMEX',
      quoteCurrency: 'MXN',
    }
    const mxnKey = instrumentIdentityKey(mxnIdentity)
    const result = calculateOwnershipValuation({
      targetCurrency: 'USD',
      accounts: [],
      holdings: [
        holding({
          quantityDecimal: '2',
          instrumentKey: mxnKey,
          price: {
            ...mxnIdentity,
            instrumentKey: mxnKey,
            unitPriceDecimal: '10',
            quoteDate: '2026-04-18',
          },
        }),
      ],
    })

    expect(result).toMatchObject({
      complete: false,
      totalAssetsCentavos: null,
      incompleteHoldingIds: ['holding'],
      missingCurrencies: ['MXN'],
      nativeTotals: [
        {
          currency: 'MXN',
          assetsCentavos: 2000,
          investmentsCentavos: 2000,
          netWorthCentavos: 2000,
        },
      ],
    })
  })

  it('applies ownership modes, signed card credit, and unresolved zero overlap', () => {
    const result = calculateOwnershipValuation({
      targetCurrency: 'USD',
      accounts: [
        {
          id: 'cash',
          name: 'Cash',
          type: 'investment',
          currency: 'USD',
          balanceCentavos: 100,
          valuationMode: 'cash_plus_holdings',
        },
        {
          id: 'snapshot',
          name: 'Snapshot',
          type: 'investment',
          currency: 'USD',
          balanceCentavos: 500,
          valuationMode: 'portfolio_snapshot',
        },
        {
          id: 'ambiguous',
          name: 'Ambiguous',
          type: 'investment',
          currency: 'USD',
          balanceCentavos: 0,
          valuationMode: 'unresolved',
        },
        {
          id: 'card',
          name: 'Card credit',
          type: 'credit_card',
          currency: 'USD',
          balanceCentavos: 25,
          valuationMode: 'cash_plus_holdings',
        },
      ],
      holdings: [
        holding({ id: 'cash-holding', accountId: 'cash', quantityDecimal: '1' }),
        holding({ id: 'snapshot-holding', accountId: 'snapshot', quantityDecimal: '1' }),
        holding({ id: 'ambiguous-holding', accountId: 'ambiguous', quantityDecimal: '1' }),
        holding({ id: 'unlinked', accountId: null, quantityDecimal: '1' }),
      ],
    })

    expect(result.complete).toBe(false)
    expect(result.unresolvedAccountIds).toEqual(['ambiguous'])
    expect(result.accounts.find((account) => account.id === 'card')).toMatchObject({
      rawBalanceCentavos: 25,
      assetCentavos: 25,
      liabilityCentavos: 0,
    })
    expect(result.holdings.find((item) => item.id === 'snapshot-holding')).toMatchObject({
      included: false,
      comparisonOnly: true,
    })
    expect(result.holdings.find((item) => item.id === 'cash-holding')?.included).toBe(true)
    expect(result.holdings.find((item) => item.id === 'unlinked')?.included).toBe(true)
  })

  it('requires real FX for value and cost conversions', () => {
    const result = valueHolding(holding({ costCurrency: 'MXN', avgCostBasisDecimal: '1' }), 'USD')
    expect(result.complete).toBe(true)
    expect(result.convertedCostBasisCentavos).toBeNull()
    expect(result.gainLossCentavos).toBeNull()
    expect(result.reasons).toContain('missing_cost_fx:MXN:USD')
  })
})
