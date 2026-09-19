import { describe, expect, it } from 'vitest'
import { valueHolding } from '@shikin/finance-core/valuation'
import { ratesForTarget, rowToHoldingInput } from '@/lib/valuation-read'

describe('frontend shared valuation selection', () => {
  it('matches the CLI synthetic sub-cent conversion scenario', () => {
    const key = 'v1|crypto|manual|AAPL|XNAS|USD'
    const input = rowToHoldingInput({
      id: 'same-scenario',
      account_id: null,
      symbol: 'DUP',
      name: 'Coin',
      type: 'crypto',
      shares: 1,
      quantity_decimal: '1',
      avg_cost_basis: 0,
      avg_cost_basis_decimal: '0',
      cost_basis_known: 1,
      instrument_key: key,
      currency: 'MXN',
      notes: null,
      created_at: '',
      updated_at: '',
      price_instrument_key: key,
      price_asset_type: 'crypto',
      price_provider: 'manual',
      price_instrument_id: 'AAPL',
      price_exchange: 'XNAS',
      price_quote_currency: 'USD',
      unit_price_decimal: '0.0049',
      quote_date: '2026-04-18',
    })
    expect(
      valueHolding(input, 'MXN', [{ fromCurrency: 'USD', toCurrency: 'MXN', rateDecimal: '20' }])
    ).toMatchObject({
      valueCentavos: 0,
      convertedValueCentavos: 10,
      gainLossCentavos: 10,
    })
  })

  it('normalizes tiny legacy quantities and tiny numeric FX rates like the CLI adapter', () => {
    const key = 'v1|stock|manual|TINY|XNAS|USD'
    const input = rowToHoldingInput({
      id: 'tiny',
      account_id: null,
      symbol: 'TINY',
      name: 'Tiny position',
      type: 'stock',
      shares: 1e-7,
      quantity_decimal: null,
      avg_cost_basis: 0,
      avg_cost_basis_decimal: '0',
      cost_basis_known: 1,
      instrument_key: key,
      currency: 'USD',
      notes: null,
      created_at: '',
      updated_at: '',
      price_instrument_key: key,
      price_asset_type: 'stock',
      price_provider: 'manual',
      price_instrument_id: 'TINY',
      price_exchange: 'XNAS',
      price_quote_currency: 'USD',
      unit_price_decimal: '10000000',
      quote_date: '2026-04-18',
    })
    const rates = ratesForTarget({ 'USD:MXN': 1e-7 }, 'MXN')

    expect(input.quantityDecimal).toBe('0.0000001')
    expect(rates).toEqual([{ fromCurrency: 'USD', toCurrency: 'MXN', rateDecimal: '0.0000001' }])
    expect(valueHolding(input, 'MXN', rates)).toMatchObject({
      valueCentavos: 100,
      convertedValueCentavos: 0,
    })
  })
})
