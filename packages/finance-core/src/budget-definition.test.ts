import { describe, expect, it } from 'vitest'
import {
  resolveBudgetDefinition,
  MAX_BUDGET_AMOUNT,
  type BudgetDefinition,
} from './budget-definition.js'

const stored: BudgetDefinition = {
  name: ' B ',
  amount: 100,
  currency: ' eur ',
  period: 'monthly',
  basis: 'gross_cashflow',
  category_id: 'food',
  scope_json: '{ "categoryIds": ["food"], "tags": ["Business"] }',
  is_active: 1,
}
const references = { accounts: [{ id: 'bank' }], categories: [{ id: 'food' }] }
const resolve = (
  patch: Parameters<typeof resolveBudgetDefinition>[0]['patch'] = {},
  overrides: Partial<Parameters<typeof resolveBudgetDefinition>[0]> = {}
) => resolveBudgetDefinition({ stored, patch, mainCurrency: 'USD', references, ...overrides })

describe('sparse budget definition policy', () => {
  it('preserves all omitted bytes and normalized no-ops including a different main currency', () => {
    expect(resolve()).toEqual(stored)
    expect(resolve({ scope: { tags: [' business '], categoryIds: ['food'] } })).toEqual(stored)
    expect(resolve({ amountCentavos: 200 })).toEqual({ ...stored, amount: 200 })
  })
  it('does not repair an omitted legacy category mirror during another field change', () => {
    const legacy = { ...stored, category_id: null }
    expect(resolve({ amountCentavos: 200 }, { stored: legacy })).toEqual({ ...legacy, amount: 200 })
    expect(
      resolve({ scope: { tags: ['business'], categoryIds: ['food'] } }, { stored: legacy })
    ).toEqual(legacy)
  })
  it('enforces the original major-unit maximum even when rounding conceals the excess', () => {
    expect(() => resolve({ amount: 1_000_000_000.001, amountCentavos: 100_000_000_000 })).toThrow(
      'Budget amount exceeds the supported maximum.'
    )
  })
  it('compares actual currency meaning before requiring amount re-entry', () => {
    expect(resolve({ currency: ' EUR ' }).currency).toBe('EUR')
    expect(() => resolve({ currency: 'USD' })).toThrow('Re-enter the amount')
    expect(resolve({ currency: 'USD', amountCentavos: 250 })).toEqual({
      ...stored,
      currency: 'USD',
      amount: 250,
    })
  })
  it.each(['CHF', ' usd ', '', 'usd', '2026-01-01'])(
    'rejects malformed authoritative main %j even with explicit currency',
    (mainCurrency) => {
      expect(() => resolve({ currency: 'EUR', amountCentavos: 100 }, { mainCurrency })).toThrow(
        `Unsupported currency: ${mainCurrency}`
      )
    }
  )
  it('uses no fallback for absent settings and checks every supplied captured default', () => {
    expect(resolve({}, { mainCurrency: null })).toEqual(stored)
    expect(() =>
      resolve({ name: 'New', amountCentavos: 100 }, { stored: undefined, mainCurrency: null })
    ).toThrow('Configure a database main currency')
    expect(
      resolve(
        { name: 'New', amountCentavos: 100, currency: 'EUR' },
        { stored: undefined, mainCurrency: null }
      ).currency
    ).toBe('EUR')
    expect(() => resolve({ currency: 'EUR', expectedMainCurrency: 'MXN' })).toThrow(
      'Main currency changed'
    )
    expect(() => resolve({ expectedMainCurrency: '' })).toThrow('Main currency changed')
  })
  it.each([0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER, MAX_BUDGET_AMOUNT * 100 + 1])(
    'rejects invalid cents %j',
    (amountCentavos) => {
      expect(() => resolve({ amountCentavos })).toThrow()
    }
  )
  it('accepts the exact shared maximum and requires a name for new definitions', () => {
    expect(resolve({ amountCentavos: MAX_BUDGET_AMOUNT * 100 }).amount).toBe(100_000_000_000)
    expect(() => resolve({ amountCentavos: 100 }, { stored: undefined })).toThrow(
      'A budget name is required.'
    )
    expect(() => resolve({ name: '  ' })).toThrow('A budget name is required.')
    expect(resolve({ name: ' New ' }).name).toBe('New')
  })
  it('keeps explicit scope clear, replacement and dangling references safe', () => {
    expect(JSON.parse(resolve({ scope: {} }).scope_json)).toEqual({
      accountIds: [],
      excludeAccountIds: [],
      categoryIds: [],
      excludeCategoryIds: [],
      tags: [],
      excludeTags: [],
    })
    expect(resolve({ scope: {} }).category_id).toBeNull()
    expect(() => resolve({}, { references: { accounts: [], categories: [] } })).toThrow(
      'Scope category food is missing.'
    )
    expect(
      resolve({ scope: {} }, { stored: { ...stored, scope_json: 'bad' } }).category_id
    ).toBeNull()
    expect(() => resolve({}, { stored: { ...stored, scope_json: 'bad' } })).toThrow()
  })
  it('uses currency/configuration, re-entry, scope, amount, name, period, basis order', () => {
    const invalid = {
      currency: 'USD',
      scope: { accountIds: ['gone'] },
      amountCentavos: undefined,
      name: '',
    }
    expect(() => resolve(invalid, { mainCurrency: 'CHF' })).toThrow('Unsupported currency: CHF')
    expect(() => resolve(invalid)).toThrow('Re-enter the amount')
    expect(() => resolve({ ...invalid, amountCentavos: 0 })).toThrow(
      'Scope account gone is missing.'
    )
    expect(() => resolve({ amountCentavos: 0, name: '' })).toThrow(
      'A positive budget amount is required.'
    )
    expect(() => resolve({ name: '', period: 'bad' as 'monthly' })).toThrow(
      'A budget name is required.'
    )
    expect(() => resolve({ period: 'bad' as 'monthly', basis: 'bad' as 'gross_cashflow' })).toThrow(
      'Invalid budget period.'
    )
    expect(() => resolve({ basis: 'bad' as 'gross_cashflow' })).toThrow('Invalid budget basis.')
  })
})
