import { describe, expect, it } from 'vitest'
import {
  projectScopedRecurringEstimate,
  recurringEquivalentCentavos,
  type ScopedEstimateDataset,
} from './scoped-estimates.js'

const dataset = (): ScopedEstimateDataset => ({
  accounts: [{ id: 'bank' }],
  categories: [{ id: 'food' }],
  rates: [],
  recurringRules: [
    {
      id: 'rule',
      amount: 10000,
      currency: 'MXN',
      account_id: 'bank',
      category_id: 'food',
      is_active: 1,
      type: 'expense',
      frequency: 'monthly',
      tags: ['business'],
    },
  ],
  subscriptions: [
    {
      id: 'subscription',
      amount: 10000,
      currency: 'MXN',
      account_id: 'bank',
      category_id: 'food',
      is_active: 1,
      billing_cycle: 'monthly',
    },
  ],
})
const project = (data = dataset(), scope: unknown = {}) =>
  projectScopedRecurringEstimate({ dataset: data, scope, currency: 'MXN', asOf: '2026-01-20' })

describe('separate read-only current-definition recurring estimates', () => {
  it('returns separate source subtotals, never a combined amount with unknown overlap', () => {
    const data = dataset()
    const before = JSON.stringify(data)
    const result = project(data)
    expect(result).toMatchObject({
      basis: 'recurring_estimate',
      combinedMonthlyCentavos: null,
      combinedYearlyCentavos: null,
      combinedComplete: false,
      combinedReason: 'cross_source_overlap_unknown',
      recurringRules: { complete: true, monthlyCentavos: 10000, yearlyCentavos: 120000 },
      subscriptions: { complete: true, monthlyCentavos: 10000, yearlyCentavos: 120000 },
    })
    expect(JSON.stringify(data)).toBe(before)
  })
  it('uses persisted rule currency, not the account denomination', () => {
    const data = dataset()
    const result = project({
      ...data,
      recurringRules: [{ ...data.recurringRules[0]!, currency: 'USD' }],
    })
    expect(result.recurringRules).toMatchObject({
      complete: false,
      monthlyCentavos: null,
      known: { monthlyCentavos: 0 },
      nativeTotals: [{ currency: 'USD', monthlyCentavos: 10000 }],
    })
    expect(result.subscriptions.complete).toBe(true)
  })
  it('keeps missing persisted currency unresolved without inheriting the account or summing unknown denominations', () => {
    const data = dataset()
    const result = project({
      ...data,
      recurringRules: [{ ...data.recurringRules[0]!, currency: null }],
    })
    expect(result.recurringRules).toMatchObject({
      complete: false,
      monthlyCentavos: null,
      nativeTotals: [],
      allocations: [{ currency: null, nativeAmountCentavos: 10000 }],
    })
  })
  it('selects only active expense rules and active subscriptions', () => {
    const data = dataset()
    const result = project({
      ...data,
      recurringRules: [
        data.recurringRules[0]!,
        { ...data.recurringRules[0]!, id: 'income', type: 'income' },
        { ...data.recurringRules[0]!, id: 'inactive', is_active: 0 },
      ],
      subscriptions: [
        data.subscriptions[0]!,
        { ...data.subscriptions[0]!, id: 'inactive', is_active: 0 },
      ],
    })
    expect(result.recurringRules.allocations.map((row) => row.id)).toEqual(['rule'])
    expect(result.subscriptions.allocations.map((row) => row.id)).toEqual(['subscription'])
  })
  it('does not fabricate complete subscription selection under include OR exclude tags', () => {
    for (const scope of [{ tags: ['business'] }, { excludeTags: ['personal'] }]) {
      const result = project(dataset(), scope)
      expect(result.recurringRules.complete).toBe(true)
      expect(result.subscriptions).toMatchObject({
        complete: false,
        monthlyCentavos: null,
        issues: [{ code: 'unsupported_subscription_tags', id: null }],
        known: { monthlyCentavos: 0 },
      })
    }
  })
  it('explicitly discloses unsupported subscription tags even in an empty captured source', () => {
    expect(
      project({ ...dataset(), subscriptions: [] }, { tags: ['business'] }).subscriptions
    ).toMatchObject({
      complete: false,
      monthlyCentavos: null,
      issues: [{ code: 'unsupported_subscription_tags' }],
    })
  })
  it('ports existing source frequency policies using exact centavos rather than floating math', () => {
    expect(recurringEquivalentCentavos(100, 'weekly', 'subscription')).toEqual({
      monthlyCentavos: 433,
      yearlyCentavos: 5200,
    })
    expect(recurringEquivalentCentavos(100, 'weekly', 'recurring_rule')).toEqual({
      monthlyCentavos: 435,
      yearlyCentavos: 5214,
    })
    expect(recurringEquivalentCentavos(100, 'biweekly', 'recurring_rule')).toEqual({
      monthlyCentavos: 217,
      yearlyCentavos: 2607,
    })
    expect(recurringEquivalentCentavos(100, 'daily', 'recurring_rule')).toEqual({
      monthlyCentavos: 3000,
      yearlyCentavos: 36000,
    })
    expect(recurringEquivalentCentavos(1, 'quarterly', 'subscription')).toEqual({
      monthlyCentavos: 0,
      yearlyCentavos: 4,
    })
    expect(recurringEquivalentCentavos(Number.MAX_SAFE_INTEGER, 'yearly', 'subscription')).toEqual({
      monthlyCentavos: 750599937895083,
      yearlyCentavos: Number.MAX_SAFE_INTEGER,
    })
    expect(() =>
      recurringEquivalentCentavos(Number.MAX_SAFE_INTEGER, 'weekly', 'subscription')
    ).toThrow('safe integer')
  })
  it('exposes unresolved scope and limits FX authority to direct manual asOf rates', () => {
    expect(project(dataset(), { categoryIds: ['gone'] }).recurringRules).toMatchObject({
      complete: false,
      monthlyCentavos: null,
      issues: [{ code: 'missing_category' }],
    })
    const data = dataset()
    const result = project({
      ...data,
      recurringRules: [{ ...data.recurringRules[0]!, currency: 'USD' }],
      rates: [
        {
          id: 'dated',
          fromCurrency: 'USD',
          toCurrency: 'MXN',
          rateDecimal: '2',
          effectiveFrom: '2026-01-21',
          supersedesRateId: null,
          createdAt: '2026-01-21',
          sourceNote: null,
        },
      ],
    })
    expect(result.recurringRules.complete).toBe(false)
  })
})
