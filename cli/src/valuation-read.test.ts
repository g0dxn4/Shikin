import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./database.js', () => ({ query: vi.fn() }))
import { query } from './database.js'
import { valueHolding } from '@shikin/finance-core/valuation'
import {
  readOwnershipValuation,
  rowToHoldingInput,
  type InvestmentValuationRow,
} from './valuation-read.js'

const mockQuery = vi.mocked(query)

describe('CLI ownership valuation read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('matches the frontend synthetic sub-cent conversion scenario', () => {
    const input = rowToHoldingInput({
      ...holding('same-scenario', null),
      type: 'crypto',
      quantity_decimal: '1',
      avg_cost_basis_decimal: '0',
      price_asset_type: 'crypto',
      unit_price_decimal: '0.0049',
      instrument_key: 'v1|crypto|manual|AAPL|XNAS|USD',
      price_instrument_key: 'v1|crypto|manual|AAPL|XNAS|USD',
    })
    expect(
      valueHolding(input, 'MXN', [{ fromCurrency: 'USD', toCurrency: 'MXN', rateDecimal: '20' }])
    ).toMatchObject({
      valueCentavos: 0,
      convertedValueCentavos: 10,
      gainLossCentavos: 10,
    })
  })

  it('honors explicit account modes even for zero balances and counts unlinked holdings once', () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM accounts WHERE'))
        return [
          {
            id: 'snapshot',
            name: 'Snapshot',
            type: 'investment',
            currency: 'USD',
            balance: 500,
            account_mode: 'snapshot_only',
            valuation_mode: null,
          },
          {
            id: 'explicit-cash',
            name: 'Explicit cash ownership',
            type: 'investment',
            currency: 'USD',
            balance: 0,
            account_mode: 'snapshot_only',
            valuation_mode: 'cash_plus_holdings',
          },
          {
            id: 'unresolved',
            name: 'Ambiguous',
            type: 'investment',
            currency: 'USD',
            balance: 0,
            valuation_mode: 'unresolved',
          },
          {
            id: 'credit',
            name: 'Card credit',
            type: 'credit_card',
            currency: 'USD',
            balance: 25,
            valuation_mode: 'cash_plus_holdings',
          },
        ]
      if (sql.includes('FROM investments i'))
        return [
          holding('snapshot-holding', 'snapshot'),
          holding('explicit-cash-holding', 'explicit-cash'),
          holding('ambiguous-holding', 'unresolved'),
          holding('unlinked', null),
        ]
      return []
    })
    const result = readOwnershipValuation('USD')
    expect(result.complete).toBe(false)
    expect(result.unresolvedAccountIds).toEqual(['unresolved'])
    expect(result.holdings.find((item) => item.id === 'snapshot-holding')).toMatchObject({
      included: false,
      comparisonOnly: true,
    })
    expect(result.holdings.find((item) => item.id === 'explicit-cash-holding')?.included).toBe(true)
    expect(result.holdings.find((item) => item.id === 'unlinked')?.included).toBe(true)
    expect(result.accounts.find((item) => item.id === 'credit')).toMatchObject({
      rawBalanceCentavos: 25,
      assetCentavos: 25,
      liabilityCentavos: 0,
    })
  })
})

function holding(id: string, accountId: string | null): InvestmentValuationRow {
  const key = 'v1|stock|manual|AAPL|XNAS|USD'
  return {
    id,
    account_id: accountId,
    account_name: null,
    symbol: 'AAPL',
    name: id,
    type: 'stock',
    shares: 1,
    quantity_decimal: '1',
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
    price_instrument_id: 'AAPL',
    price_exchange: 'XNAS',
    price_quote_currency: 'USD',
    unit_price_decimal: '1',
    quote_date: '2026-04-18',
  }
}
