import { describe, expect, it, vi } from 'vitest'
import {
  aggregateHeatmapSpending,
  fetchHeatmapLedgerRows,
  isHeatmapEligibleExpense,
  type ConvertToPreferredFn,
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

const convertUsdOnly: ConvertToPreferredFn = (amountCentavos, currency) => {
  if (currency === 'USD') {
    return { complete: true, amountCentavos, missingCurrencies: [] }
  }
  return {
    complete: false,
    missingCurrencies: [currency],
    reason: 'missing_exchange_rates',
  }
}

describe('isHeatmapEligibleExpense', () => {
  it('keeps posted and cleared expenses and drops ineligible rows', () => {
    expect(isHeatmapEligibleExpense(row())).toBe(true)
    expect(isHeatmapEligibleExpense(row({ status: 'cleared' }))).toBe(true)
    expect(isHeatmapEligibleExpense(row({ status: 'pending' }))).toBe(false)
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
  it('converts mixed currencies before summing daily and category totals', () => {
    const convert: ConvertToPreferredFn = (amountCentavos, currency) => ({
      complete: true,
      amountCentavos: currency === 'EUR' ? amountCentavos * 2 : amountCentavos,
      missingCurrencies: [],
    })

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
      'USD',
      convert
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
      'USD',
      convertUsdOnly
    )

    expect(result.complete).toBe(false)
    expect(result.reason).toBe('missing_exchange_rates')
    expect(result.missingCurrencies).toEqual(['EUR'])
    expect(result.totalSpent).toBe(0)
    expect(result.dailyTotals.size).toBe(0)
    expect(result.categoryTotals).toEqual([])
    expect(result.eligibleTransactions).toEqual([])
  })

  it('labels invalid currency data without inventing a complete total', () => {
    const convert: ConvertToPreferredFn = (_amount, currency) => {
      if (currency === 'US D') {
        return {
          complete: false,
          missingCurrencies: [],
          reason: 'invalid_currency_data',
        }
      }
      return { complete: true, amountCentavos: _amount, missingCurrencies: [] }
    }

    const result = aggregateHeatmapSpending(
      [row({ currency: 'US D', amount: 5000 })],
      'USD',
      convert
    )

    expect(result.complete).toBe(false)
    expect(result.reason).toBe('invalid_currency_data')
    expect(result.missingCurrencies).toContain('US D')
    expect(result.totalSpent).toBe(0)
  })

  it('keeps zero and negative converted amounts without raw-summing other currencies', () => {
    const convert: ConvertToPreferredFn = (amountCentavos, currency) => {
      if (currency !== 'USD') {
        return {
          complete: false,
          missingCurrencies: [currency],
          reason: 'missing_exchange_rates',
        }
      }
      return { complete: true, amountCentavos, missingCurrencies: [] }
    }

    const zeroOnly = aggregateHeatmapSpending(
      [row({ id: 'zero', amount: 0, currency: 'USD' })],
      'USD',
      convert
    )
    expect(zeroOnly.complete).toBe(true)
    expect(zeroOnly.totalSpent).toBe(0)
    expect(zeroOnly.dailyTotals.get('2024-06-15')).toBe(0)

    const negative = aggregateHeatmapSpending(
      [row({ id: 'refund-shaped', amount: -2500, currency: 'USD' })],
      'USD',
      convert
    )
    expect(negative.complete).toBe(true)
    expect(negative.totalSpent).toBe(-2500)

    const mixedMissing = aggregateHeatmapSpending(
      [
        row({ id: 'neg', amount: -2500, currency: 'USD' }),
        row({ id: 'mxn', amount: 1000, currency: 'MXN' }),
      ],
      'USD',
      convert
    )
    expect(mixedMissing.complete).toBe(false)
    expect(mixedMissing.totalSpent).toBe(0)
    expect(mixedMissing.missingCurrencies).toEqual(['MXN'])
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
      'USD',
      convertUsdOnly
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
      'USD',
      convertUsdOnly
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
