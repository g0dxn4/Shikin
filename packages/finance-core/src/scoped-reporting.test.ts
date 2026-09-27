import { describe, expect, it } from 'vitest'
import {
  projectScopedReport,
  sumScopedCentavos,
  type ScopedReportDataset,
  type ScopedReportTransaction,
} from './scoped-reporting.js'
import { resolveReportWindow } from './report-window.js'
import type { ConsumptionClassification } from './corrections.js'
import type { DatedExchangeRate } from './fx.js'

const window = resolveReportWindow({ asOf: '2026-01-20', timeZone: 'America/Mexico_City' })
const tx = (id: string, patch: Partial<ScopedReportTransaction> = {}): ScopedReportTransaction => ({
  id,
  account_id: 'bank',
  category_id: 'food',
  type: 'expense',
  amount: 25000,
  currency: 'MXN',
  date: '2026-01-10',
  status: 'posted',
  ...patch,
})
const classification = (
  transactionId: string,
  patch: Partial<ConsumptionClassification> = {}
): ConsumptionClassification => ({
  id: `c-${transactionId}`,
  transaction_id: transactionId,
  split_id: null,
  role: 'purchase',
  referenced_purchase_id: null,
  ...patch,
})
const rate = (patch: Partial<DatedExchangeRate> = {}): DatedExchangeRate => ({
  id: 'rate',
  fromCurrency: 'USD',
  toCurrency: 'MXN',
  rateDecimal: '0.5',
  effectiveFrom: '2026-01-01',
  supersedesRateId: null,
  createdAt: '2026-01-01',
  sourceNote: null,
  ...patch,
})
const dataset = (
  transactions: ScopedReportTransaction[] = [],
  patch: Partial<ScopedReportDataset> = {}
): ScopedReportDataset => ({
  accounts: [
    { id: 'bank', type: 'checking', currency: 'MXN', account_mode: 'transactional' },
    { id: 'card', type: 'credit_card', currency: 'MXN', account_mode: 'transactional' },
  ],
  categories: [{ id: 'food' }, { id: 'rent' }],
  transactions,
  splits: [],
  classifications: [],
  coverage: ['bank', 'card'].map((account_id) => ({
    account_id,
    source_namespace: 'independent-source',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    status: 'verified',
  })),
  rates: [],
  activePaymentLinks: [],
  ...patch,
})
const report = (
  data: ScopedReportDataset,
  scope: unknown = {},
  basis: 'gross_cashflow' | 'net_consumption' = 'gross_cashflow'
) => projectScopedReport({ dataset: data, scope, basis, window, currency: 'MXN' })

describe('pure scoped actual reports', () => {
  it('keeps MXN250 as 25000 cents and gross income separate from budget expenses', () => {
    const result = report(
      dataset([tx('expense'), tx('income', { type: 'income', amount: 90000 })]),
      { categoryIds: ['food'] }
    )
    expect(result).toMatchObject({
      complete: true,
      totals: { expenseCentavos: 25000, incomeCentavos: 90000, consumptionCentavos: null },
    })
    expect(100000 - result.totals.expenseCentavos!).toBe(75000)
    expect(result.transactionIds).toEqual(['expense', 'income'])
  })
  it('does not confuse incomplete gross income conversion with expense-only budget usage', () => {
    const result = report(
      dataset([tx('expense'), tx('foreign-income', { type: 'income', currency: 'USD' })])
    )
    expect(result).toMatchObject({
      complete: false,
      totals: { expenseCentavos: null, incomeCentavos: null },
      budgetUsage: {
        measure: 'expenseCentavos',
        complete: true,
        amountCentavos: 25000,
        knownAmountCentavos: 25000,
        issues: [],
      },
    })
  })
  it('selects split 60/40 once with duplicate filters/tags, source accounts and exact categories', () => {
    const data = dataset(
      [
        tx('split', {
          amount: 10000,
          category_id: 'parent-not-used',
          tags: '["Business",{"key":"business"},{"value":"Business"}]',
          transfer_to_account_id: 'card',
        }),
      ],
      {
        splits: [
          { id: 'a', transaction_id: 'split', amount: 6000, category_id: 'food' },
          { id: 'b', transaction_id: 'split', amount: 4000, category_id: 'rent' },
        ],
      }
    )
    const result = report(data, {
      accountIds: ['bank', 'bank'],
      categoryIds: ['food', 'food'],
      tags: ['business', 'BUSINESS'],
    })
    expect(result).toMatchObject({
      complete: true,
      totals: { expenseCentavos: 6000 },
      transactionIds: ['split'],
    })
    expect(result.allocations.map((row) => row.allocationId)).toEqual(['a'])
    expect(report(data, { accountIds: ['card'] }).totals.expenseCentavos).toBe(0)
    expect(
      report(data, { tags: ['business'], excludeTags: ['business'] }).totals.expenseCentavos
    ).toBe(0)
    expect(
      report(data, { categoryIds: ['food'], excludeCategoryIds: ['food'] }).totals.expenseCentavos
    ).toBe(0)
  })
  it('converts parent once then apportions ALL allocations using stable IDs before selection', () => {
    const data = dataset([tx('split', { amount: 3, currency: 'USD' })], {
      rates: [rate()],
      splits: [
        { id: 'b', transaction_id: 'split', amount: 2, category_id: 'rent' },
        { id: 'a', transaction_id: 'split', amount: 1, category_id: 'food' },
      ],
    })
    const food = report(data, { categoryIds: ['food'] })
    const rent = report(data, { categoryIds: ['rent'] })
    expect(food.totals.expenseCentavos).toBe(1)
    expect(rent.totals.expenseCentavos).toBe(1)
    expect(food.conversions).toMatchObject([
      { id: 'split', conversion: { amountCentavos: 2, asOfDate: '2026-01-10', rateId: 'rate' } },
    ])
    expect(food.nativeTotals[0]).toMatchObject({ currency: 'USD', known: { expenseCentavos: 1 } })
  })
  it('rejects inverse/future FX authority but retains native and known evidence', () => {
    const data = dataset([tx('native'), tx('foreign', { currency: 'USD', amount: 100 })], {
      rates: [
        rate({ id: 'future', effectiveFrom: '2026-01-11' }),
        rate({ id: 'inverse', fromCurrency: 'MXN', toCurrency: 'USD' }),
      ],
    })
    expect(report(data)).toMatchObject({
      complete: false,
      totals: { expenseCentavos: null },
      known: { expenseCentavos: 25000 },
      issues: [{ code: 'fx', id: 'foreign' }],
    })
  })
  it('excludes all noncashflow rows and defaults to asOf, with explicit future opt-in', () => {
    const patches: Partial<ScopedReportTransaction>[] = [
      { type: 'transfer' },
      { status: 'pending' },
      { ledger_treatment: 'staged_no_balance_impact' },
      { reporting_treatment: 'exclude_from_cashflow' },
      { transaction_kind: 'reconciliation_bridge' },
      { transaction_kind: 'archived_transfer_mirror', is_archived: 1 },
    ]
    const data = dataset([
      ...patches.map((patch, index) => tx(`out-${index}`, patch)),
      tx('future', { date: '2026-01-21' }),
      tx('past'),
    ])
    expect(report(data).transactionIds).toEqual(['past'])
    expect(
      projectScopedReport({
        dataset: data,
        scope: {},
        basis: 'gross_cashflow',
        currency: 'MXN',
        window: resolveReportWindow({ asOf: '2026-01-20', through: 'period_end' }),
      }).transactionIds
    ).toEqual(['future', 'past'])
  })
  it('exposes invalid splits and unresolved scope instead of fabricated zero', () => {
    const data = dataset([tx('bad')], {
      splits: [{ id: 'bad-split', transaction_id: 'bad', amount: 1, category_id: 'food' }],
    })
    expect(report(data)).toMatchObject({
      complete: false,
      totals: { expenseCentavos: null },
      issues: [{ code: 'invalid_allocation' }],
    })
    expect(report(dataset(), { categoryIds: ['deleted'] })).toMatchObject({
      complete: false,
      totals: { expenseCentavos: null },
      issues: [{ code: 'missing_category' }],
    })
    expect(report(dataset(), 'broken JSON')).toMatchObject({
      complete: false,
      scope: null,
      totals: { expenseCentavos: null },
    })
  })
  it('recognizes NET refunds by purchase category on refund date, but uses refund source account and tags', () => {
    const data = dataset(
      [
        tx('purchase', { date: '2025-12-20', account_id: 'card', tags: ['purchase-tag'] }),
        tx('refund', { type: 'income', amount: 5000, category_id: 'rent', tags: ['refund-tag'] }),
      ],
      {
        classifications: [
          classification('purchase'),
          classification('refund', { role: 'refund', referenced_purchase_id: 'c-purchase' }),
        ],
      }
    )
    const result = report(
      data,
      { accountIds: ['bank'], categoryIds: ['food'], tags: ['refund-tag'] },
      'net_consumption'
    )
    expect(result).toMatchObject({
      complete: true,
      totals: { consumptionCentavos: -5000, earnedIncomeCentavos: 0 },
      transactionIds: ['refund'],
    })
    expect(result.allocations[0]).toMatchObject({
      categoryId: 'food',
      date: '2026-01-10',
      accountId: 'bank',
      classificationId: 'c-refund',
      referencedPurchaseId: 'c-purchase',
      nativeAmountCentavos: 5000,
    })
    expect(
      report(data, { tags: ['purchase-tag'] }, 'net_consumption').totals.consumptionCentavos
    ).toBe(0)
  })
  it('retains full out-of-window and out-of-scope refund capacity evidence', () => {
    const data = dataset(
      [
        tx('purchase', { date: '2025-12-20', amount: 100 }),
        tx('refund', { type: 'income', amount: 80 }),
        tx('other-refund', { type: 'income', amount: 30, date: '2026-02-01', account_id: 'card' }),
      ],
      {
        classifications: [
          classification('purchase'),
          classification('refund', { role: 'refund', referenced_purchase_id: 'c-purchase' }),
          classification('other-refund', { role: 'refund', referenced_purchase_id: 'c-purchase' }),
        ],
      }
    )
    expect(report(data, { accountIds: ['bank'] }, 'net_consumption')).toMatchObject({
      complete: false,
      unresolvedClassificationIds: ['refund'],
      totals: { consumptionCentavos: null },
    })
  })
  it('does not let unclassified allocations outside selected categories/accounts/tags poison NET', () => {
    const data = dataset(
      [
        tx('split', { amount: 10000, tags: ['business'] }),
        tx('other-account', { account_id: 'card' }),
        tx('other-tag', { tags: ['personal'] }),
        tx('pending', { status: 'pending', tags: ['business'] }),
      ],
      {
        splits: [
          { id: 'a', transaction_id: 'split', amount: 6000, category_id: 'food' },
          { id: 'b', transaction_id: 'split', amount: 4000, category_id: 'rent' },
        ],
        classifications: [classification('split', { split_id: 'a' })],
      }
    )
    expect(
      report(
        data,
        { accountIds: ['bank'], categoryIds: ['food'], tags: ['business'] },
        'net_consumption'
      )
    ).toMatchObject({
      complete: true,
      totals: { consumptionCentavos: 6000 },
      unresolvedClassificationIds: [],
    })
  })
  it('unknown income on selected source could refund any category, while valid earned income is separate', () => {
    const data = dataset(
      [
        tx('purchase'),
        tx('unknown', { type: 'income', category_id: 'rent' }),
        tx('earned', { type: 'income', amount: 1200 }),
      ],
      {
        classifications: [
          classification('purchase'),
          classification('earned', { role: 'earned_income' }),
        ],
      }
    )
    const result = report(data, { categoryIds: ['food'] }, 'net_consumption')
    expect(result).toMatchObject({
      complete: false,
      classificationComplete: false,
      unresolvedClassificationIds: ['unknown'],
      known: { consumptionCentavos: 25000, earnedIncomeCentavos: 1200 },
      totals: { consumptionCentavos: null, earnedIncomeCentavos: null },
    })
  })
  it('requires independent coverage only for selected transactional accounts and every source', () => {
    const data = dataset([tx('purchase')], {
      classifications: [classification('purchase')],
      coverage: [
        {
          account_id: 'bank',
          source_namespace: 'one',
          period_start: '2026-01-01',
          period_end: '2026-01-31',
          status: 'verified',
        },
      ],
    })
    expect(report(data, { accountIds: ['bank'] }, 'net_consumption').complete).toBe(true)
    expect(report(data, {}, 'net_consumption')).toMatchObject({
      complete: false,
      coverage: { uncoveredAccountIds: ['card'] },
      known: { consumptionCentavos: 25000 },
    })
    expect(
      report({ ...data, coverage: [] }, { accountIds: ['bank'] }, 'net_consumption').complete
    ).toBe(false)
    expect(
      report(
        {
          ...data,
          coverage: [
            ...data.coverage,
            {
              account_id: 'bank',
              source_namespace: 'two',
              period_start: '2025-01-01',
              period_end: '2025-01-31',
              status: 'verified',
            },
          ],
        },
        { accountIds: ['bank'] },
        'net_consumption'
      ).complete
    ).toBe(false)
  })
  it('preserves pinned custom type revisions and all five NET fields', () => {
    const roles = [
      'purchase',
      'earned_income',
      'other_income',
      'principal_recovery',
      'asset_acquisition',
    ] as const
    const data = dataset(
      roles.map((role) =>
        tx(role, {
          type: ['earned_income', 'other_income', 'principal_recovery'].includes(role)
            ? 'income'
            : 'expense',
          amount: 100,
        })
      ),
      {
        classifications: roles.map((role) =>
          classification(role, { role, type_revision_id: role === 'other_income' ? 'v1' : null })
        ),
        typeRevisions: [
          {
            id: 'v1',
            type_id: 'custom',
            version: 1,
            name: 'Other',
            financial_treatment: 'other_income',
            created_at: '2026-01-01',
          },
          {
            id: 'v2',
            type_id: 'custom',
            version: 2,
            name: 'Changed meaning',
            financial_treatment: 'earned_income',
            created_at: '2026-01-02',
          },
        ],
      }
    )
    expect(report(data, {}, 'net_consumption').totals).toMatchObject({
      consumptionCentavos: 100,
      earnedIncomeCentavos: 100,
      otherIncomeCentavos: 100,
      principalRecoveryCentavos: 100,
      assetAcquisitionCentavos: 100,
    })
    expect(
      report(data, {}, 'net_consumption').allocations.find(
        (row) => row.transactionId === 'other_income'
      )?.typeRevisionId
    ).toBe('v1')
  })
  it.each(['gross_cashflow', 'net_consumption'] as const)(
    'excludes full-parent ordinary repayments for %s, never inferring unlinked ones',
    (basis) => {
      const data = dataset(
        [
          tx('bank-payment'),
          tx('card-payment', { account_id: 'card', type: 'income' }),
          tx('transfer', { type: 'transfer', transfer_to_account_id: 'card' }),
          tx('purchase'),
        ],
        {
          classifications: [classification('purchase')],
          activePaymentLinks: [
            { id: 'l1', transaction_id: 'bank-payment', amount: 25000, cardAccountId: 'card' },
            { id: 'l2', transaction_id: 'card-payment', amount: 25000, cardAccountId: 'card' },
          ],
        }
      )
      const result = report(data, {}, basis)
      expect(result.complete).toBe(true)
      expect(result.transactionIds).toEqual(['purchase'])
      expect(result.repayments.map((row) => row.status)).toEqual([
        'excluded_full_parent',
        'excluded_full_parent',
      ])
      expect(
        report({ ...data, activePaymentLinks: [] }, {}, 'gross_cashflow').totals.expenseCentavos
      ).toBe(50000)
    }
  )
  it('marks partial, mixed and invalid linked repayments incomplete rather than counting payment as expense', () => {
    const data = dataset([tx('payment'), tx('known')], {
      activePaymentLinks: [
        { id: 'link', transaction_id: 'payment', amount: 10000, cardAccountId: 'card' },
      ],
    })
    expect(report(data)).toMatchObject({
      complete: false,
      known: { expenseCentavos: 25000 },
      totals: { expenseCentavos: null },
      repayments: [{ transactionId: 'payment', status: 'ambiguous' }],
    })
    const mixed = {
      ...data,
      splits: [
        { id: 'pay', transaction_id: 'payment', amount: 10000, category_id: 'food' },
        { id: 'spend', transaction_id: 'payment', amount: 15000, category_id: 'rent' },
      ],
      classifications: [classification('payment', { split_id: 'spend' })],
    }
    expect(report(mixed, { categoryIds: ['rent'] }).issues).toContainEqual(
      expect.objectContaining({ code: 'ambiguous_repayment' })
    )
    expect(
      report({ ...data, activePaymentLinks: [{ ...data.activePaymentLinks[0]!, amount: 30000 }] })
        .complete
    ).toBe(false)
  })
  it('groups by category/account/month/none with distinct parent lineage and never mutates inputs', () => {
    const data = dataset([tx('one'), tx('two', { account_id: 'card', category_id: 'rent' })])
    const before = JSON.stringify(data)
    for (const groupBy of ['category', 'account', 'month', 'none'] as const) {
      const result = projectScopedReport({
        dataset: data,
        scope: {},
        currency: 'MXN',
        window,
        basis: 'gross_cashflow',
        groupBy,
      })
      expect(sumScopedCentavos(result.groups.map((group) => group.known.expenseCentavos!))).toBe(
        50000
      )
    }
    expect(JSON.stringify(data)).toBe(before)
  })
  it('does not let out-of-category FX or invalid out-of-window metadata poison selected scope', () => {
    const data = dataset(
      [
        tx('selected'),
        tx('foreign', { currency: 'USD', category_id: 'rent' }),
        tx('old-invalid', { date: '2025-12-01', reporting_treatment: 'broken' }),
      ],
      {
        classifications: [
          classification('selected'),
          classification('foreign', { type_revision_id: 'missing-custom-revision' }),
        ],
      }
    )
    for (const basis of ['gross_cashflow', 'net_consumption'] as const) {
      const result = report(data, { categoryIds: ['food'] }, basis)
      expect(result.complete).toBe(true)
      expect(result.conversions.map((row) => row.id)).toEqual(['selected'])
    }
  })
  it('apportions the whole FX parent even when only one NET split is selected', () => {
    const data = dataset([tx('split', { amount: 3, currency: 'USD' })], {
      rates: [rate()],
      splits: [
        { id: 'a', transaction_id: 'split', amount: 1, category_id: 'food' },
        { id: 'b', transaction_id: 'split', amount: 2, category_id: 'rent' },
      ],
      classifications: [classification('split', { split_id: 'a' })],
    })
    const result = report(data, { categoryIds: ['food'] }, 'net_consumption')
    expect(result).toMatchObject({ complete: true, totals: { consumptionCentavos: 1 } })
    expect(result.allocations).toMatchObject([
      { allocationId: 'a', nativeAmountCentavos: 1, amountCentavos: 1 },
    ])
  })
  it('retains unresolved parent inspection and native evidence without pretending it is a selected allocation', () => {
    const result = report(
      dataset([tx('unknown', { type: 'income', category_id: 'rent' })]),
      { categoryIds: ['food'] },
      'net_consumption'
    )
    expect(result.transactionIds).toEqual(['unknown'])
    expect(result.allocations).toEqual([])
    expect(result.contributors).toMatchObject([
      {
        transactionId: 'unknown',
        nativeParentAmountCentavos: 25000,
        allocationIds: [],
        issues: [{ code: 'classification', id: 'unknown' }],
      },
    ])
  })
  it('selects uncategorized explicitly and never widens a category to descendants', () => {
    const data = dataset(
      [
        tx('uncategorized', { category_id: null }),
        tx('food'),
        tx('child', { category_id: 'food-child' }),
      ],
      { categories: [{ id: 'food' }, { id: 'food-child' }] }
    )
    expect(report(data, { categoryIds: [null] }).transactionIds).toEqual(['uncategorized'])
    expect(report(data, { categoryIds: ['food'] }).transactionIds).toEqual(['food'])
    expect(report(data, { excludeCategoryIds: [null] }).transactionIds).toEqual(['child', 'food'])
  })
  it('preserves huge centavos exactly and rejects aggregate overflow', () => {
    const amount = Number.MAX_SAFE_INTEGER - 1
    expect(report(dataset([tx('huge', { amount })])).totals.expenseCentavos).toBe(amount)
    expect(() => report(dataset([tx('huge', { amount }), tx('more')]))).toThrow('safe integer')
  })
})
