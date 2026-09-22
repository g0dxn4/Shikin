import { describe, expect, it, vi } from 'vitest'
import {
  aggregateHeatmapSpending,
  fetchHeatmapLedgerRows,
  isHeatmapEligibleExpense,
  type HeatmapLedgerRow,
} from '../spending-heatmap'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
}))

import { query } from '@/lib/database'

const mockQuery = vi.mocked(query)

function row(overrides: Partial<HeatmapLedgerRow> = {}): HeatmapLedgerRow {
  return {
    id: 'tx-1',
    date: '2024-06-15',
    amount: 10000,
    currency: 'USD',
    type: 'expense',
    status: 'posted',
    reporting_treatment: 'normal',
    transaction_kind: 'standard',
    is_archived: 0,
    category_id: 'cat-food',
    category_name: 'Food',
    category_color: '#f97316',
    account_id: 'acc-1',
    description: 'Groceries',
    ...overrides,
  }
}

const usdContext = { mainCurrency: 'USD', manualRates: [], today: '2024-06-15' }
const eurContext = {
  ...usdContext,
  manualRates: [
    {
      id: 'EURUSD22000-01-01',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rateDecimal: '2',
      effectiveFrom: '2000-01-01',
      supersedesRateId: null,
      createdAt: '2000-01-01',
      sourceNote: null,
    },
  ],
}

describe('isHeatmapEligibleExpense', () => {
  it('keeps posted and cleared expenses and drops ineligible rows', () => {
    expect(isHeatmapEligibleExpense(row())).toBe(true)
    expect(isHeatmapEligibleExpense(row({ status: 'cleared' }))).toBe(true)
    expect(isHeatmapEligibleExpense(row({ status: 'pending' }))).toBe(false)
    expect(isHeatmapEligibleExpense(row({ ledger_treatment: 'staged_no_balance_impact' }))).toBe(
      false
    )
    expect(isHeatmapEligibleExpense(row({ type: 'income' }))).toBe(false)
    expect(isHeatmapEligibleExpense(row({ type: 'transfer' }))).toBe(false)
    expect(isHeatmapEligibleExpense(row({ is_archived: 1 }))).toBe(false)
    expect(isHeatmapEligibleExpense(row({ reporting_treatment: 'exclude_from_cashflow' }))).toBe(
      false
    )
    expect(isHeatmapEligibleExpense(row({ transaction_kind: 'reconciliation_bridge' }))).toBe(false)
    expect(isHeatmapEligibleExpense(row({ transaction_kind: 'archived_transfer_mirror' }))).toBe(
      false
    )
    expect(isHeatmapEligibleExpense(row({ status: 'unknown' }))).toBe(false)
  })
})

describe('aggregateHeatmapSpending', () => {
  it('uses validated allocations for categories but counts the parent once per day', () => {
    const splits_json = JSON.stringify([
      { id: 'food', amount: 401, category_id: 'food', category_name: 'Food' },
      { id: 'other', amount: 600, category_id: 'other', category_name: 'Other Expenses' },
    ])
    const result = aggregateHeatmapSpending([row({ amount: 1001, splits_json })], usdContext)
    expect(result.complete).toBe(true)
    expect(result.totalSpent).toBe(1001)
    expect(result.eligibleTransactions).toHaveLength(1)
    expect(result.categoryTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryId: 'food', total: 401 }),
        expect.objectContaining({ categoryId: 'other', total: 600 }),
      ])
    )
  })

  it('withholds malformed split categories rather than falling back to the parent', () => {
    const result = aggregateHeatmapSpending(
      [row({ splits_json: JSON.stringify([{ amount: 1, category_id: 'food' }]) })],
      usdContext
    )
    expect(result).toMatchObject({
      complete: false,
      reason: 'invalid_category_allocations',
      categoryTotals: [],
      eligibleTransactions: [],
      totalSpent: null,
    })
  })

  it('converts mixed currencies before summing daily and category totals', () => {
    const result = aggregateHeatmapSpending(
      [
        row({ id: 'usd', amount: 10000, currency: 'USD', date: '2024-06-10' }),
        row({
          id: 'eur',
          amount: 10000,
          currency: 'EUR',
          date: '2024-06-10',
          category_id: 'cat-transport',
          category_name: 'Transport',
          category_color: '#38bdf8',
        }),
        row({ id: 'usd-2', amount: 5000, currency: 'USD', date: '2024-06-11' }),
      ],
      eurContext
    )

    expect(result.complete).toBe(true)
    expect(result.totalSpent).toBe(35000)
    expect(result.dailyTotals.get('2024-06-10')).toBe(30000)
    expect(result.dailyTotals.get('2024-06-11')).toBe(5000)
    expect(result.categoryTotals).toEqual([
      {
        categoryId: 'cat-transport',
        name: 'Transport',
        color: '#38bdf8',
        total: 20000,
      },
      {
        categoryId: 'cat-food',
        name: 'Food',
        color: '#f97316',
        total: 15000,
      },
    ])
  })

  it('omits totals when any required exchange rate is missing', () => {
    const result = aggregateHeatmapSpending(
      [
        row({ id: 'usd', amount: 10000, currency: 'USD' }),
        row({ id: 'eur', amount: 8000, currency: 'EUR' }),
      ],
      usdContext
    )

    expect(result.complete).toBe(false)
    expect(result.reason).toBe('missing_exchange_rates')
    expect(result.missingCurrencies).toEqual(['EUR'])
    expect(result.evidence.totalCentavos).toBeNull()
    expect(result.evidence.knownTotalCentavos).toBe(10000)
    expect(result.dailyTotals.size).toBe(0)
    expect(result.categoryTotals).toEqual([])
    expect(result.eligibleTransactions).toEqual([])
  })

  it('labels invalid currency data without inventing a complete total', () => {
    const result = aggregateHeatmapSpending([row({ currency: 'US D', amount: 5000 })], usdContext)

    expect(result.complete).toBe(false)
    expect(result.reason).toBe('invalid_currency_data')
    expect(result.missingCurrencies).toContain('US D')
    expect(result.totalSpent).toBeNull()
  })

  it('keeps zero amounts but withholds negative or unsafe parent amounts', () => {
    const zeroOnly = aggregateHeatmapSpending(
      [row({ id: 'zero', amount: 0, currency: 'USD' })],
      usdContext
    )
    expect(zeroOnly.complete).toBe(true)
    expect(zeroOnly.totalSpent).toBe(0)
    expect(zeroOnly.dailyTotals.get('2024-06-15')).toBe(0)

    for (const amount of [-2500, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed = aggregateHeatmapSpending(
        [row({ id: 'malformed', amount, currency: 'USD' })],
        usdContext
      )
      expect(malformed).toMatchObject({
        complete: false,
        reason: 'invalid_category_allocations',
        totalSpent: null,
        eligibleTransactions: [],
      })
    }
  })

  it('withholds null and blank parent currencies before conversion', () => {
    for (const currency of ['', null as unknown as string]) {
      const result = aggregateHeatmapSpending([row({ currency })], usdContext)
      expect(result).toMatchObject({
        complete: false,
        reason: 'invalid_currency_data',
        totalSpent: null,
        eligibleTransactions: [],
      })
    }
  })

  it('does not let staged malformed rows poison eligible heatmap totals', () => {
    const result = aggregateHeatmapSpending(
      [
        row({ id: 'ordinary', amount: 10000 }),
        row({
          id: 'staged',
          amount: Number.MAX_SAFE_INTEGER + 1,
          currency: null as unknown as string,
          ledger_treatment: 'staged_no_balance_impact',
        }),
      ],
      usdContext
    )
    expect(result.complete).toBe(true)
    expect(result.totalSpent).toBe(10000)
  })

  it('excludes ineligible rows from every aggregate', () => {
    const result = aggregateHeatmapSpending(
      [
        row({ id: 'posted', amount: 20000 }),
        row({ id: 'pending', amount: 901000, status: 'pending' }),
        row({
          id: 'bridge',
          amount: 902000,
          reporting_treatment: 'exclude_from_cashflow',
          transaction_kind: 'reconciliation_bridge',
        }),
        row({ id: 'archived', amount: 903000, is_archived: 1 }),
        row({ id: 'transfer', amount: 904000, type: 'transfer' }),
      ],
      usdContext
    )

    expect(result.complete).toBe(true)
    expect(result.totalSpent).toBe(20000)
    expect(result.eligibleTransactions).toHaveLength(1)
    expect(result.categoryTotals).toEqual([
      { categoryId: 'cat-food', name: 'Food', color: '#f97316', total: 20000 },
    ])
  })

  it('preserves uncategorized rows without inventing a category id', () => {
    const result = aggregateHeatmapSpending(
      [
        row({
          category_id: null,
          category_name: null,
          category_color: null,
          amount: 4200,
        }),
      ],
      usdContext
    )

    expect(result.categoryTotals).toEqual([
      { categoryId: null, name: 'Uncategorized', color: '#6b7280', total: 4200 },
    ])
  })
})

describe('fetchHeatmapLedgerRows', () => {
  it('reads unaggregated ledger rows for the requested period', async () => {
    mockQuery.mockResolvedValueOnce([row()])

    const rows = await fetchHeatmapLedgerRows('2024-06-01', '2024-06-30')

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM transactions t'), [
      '2024-06-01',
      '2024-06-30',
    ])
    expect(mockQuery.mock.calls[0]?.[0]).not.toMatch(/SUM\(/i)
    expect(rows).toEqual([row()])
  })
})
