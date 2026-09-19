import { describe, expect, it } from 'vitest'
import { valueHolding } from '@shikin/finance-core/valuation'
import { rowToHoldingInput } from '@/lib/valuation-read'

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
})
