import { describe, expect, it } from 'vitest'
import {
  calculateOwnershipValuation,
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

describe('precise valuation', () => {
  it('multiplies fractional quantities and sub-cent prices before rounding once', () => {
    expect(multiplyDecimalsToCentavos(['0.123456789012345678', '0.123456789012345678'])).toBe(2)
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
