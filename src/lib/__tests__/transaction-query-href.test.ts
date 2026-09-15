import { describe, expect, it } from 'vitest'
import { buildTransactionsHref, isRealCategoryId } from '../transaction-query-href'

describe('buildTransactionsHref', () => {
  it('builds category and date drill-down URLs with the shared ledger keys', () => {
    expect(
      buildTransactionsHref({
        type: 'expense',
        categoryId: 'cat-food',
        dateFrom: '2024-06-01',
        dateTo: '2024-06-30',
      })
    ).toBe('/transactions?type=expense&category=cat-food&dateFrom=2024-06-01&dateTo=2024-06-30')
  })

  it('includes an account filter when one is provided', () => {
    expect(
      buildTransactionsHref({
        type: 'expense',
        categoryId: 'cat-food',
        dateFrom: '2024-06-01',
        dateTo: '2024-06-01',
        accountId: 'acc-1',
      })
    ).toBe(
      '/transactions?type=expense&category=cat-food&dateFrom=2024-06-01&dateTo=2024-06-01&account=acc-1'
    )
  })

  it('omits category for uncategorized and other buckets instead of inventing a match', () => {
    expect(
      buildTransactionsHref({
        type: 'expense',
        categoryId: 'uncategorized',
        dateFrom: '2024-06-01',
        dateTo: '2024-06-30',
      })
    ).toBe('/transactions?type=expense&dateFrom=2024-06-01&dateTo=2024-06-30')

    expect(
      buildTransactionsHref({
        type: 'expense',
        categoryId: null,
        dateFrom: '2024-06-15',
        dateTo: '2024-06-15',
      })
    ).toBe('/transactions?type=expense&dateFrom=2024-06-15&dateTo=2024-06-15')

    expect(
      buildTransactionsHref({
        type: 'expense',
        categoryId: 'other',
        dateFrom: '2024-06-01',
        dateTo: '2024-06-30',
      })
    ).toBe('/transactions?type=expense&dateFrom=2024-06-01&dateTo=2024-06-30')
  })

  it('returns the bare ledger path when no filters are set', () => {
    expect(buildTransactionsHref({})).toBe('/transactions')
  })
})

describe('isRealCategoryId', () => {
  it('rejects empty and synthetic category keys', () => {
    expect(isRealCategoryId('cat-food')).toBe(true)
    expect(isRealCategoryId('uncategorized')).toBe(false)
    expect(isRealCategoryId('other')).toBe(false)
    expect(isRealCategoryId(null)).toBe(false)
    expect(isRealCategoryId('  ')).toBe(false)
  })
})
