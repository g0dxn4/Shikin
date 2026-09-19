import { beforeEach, describe, expect, it, vi } from 'vitest'
import { query } from '@/lib/database'
import {
  escapeLikeLiteral,
  getTransactionById,
  queryTransactionPage,
} from '@/lib/transaction-query'

vi.mock('@/lib/database', () => ({ query: vi.fn() }))

const mockQuery = vi.mocked(query)

function arrangePageResponses() {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('COUNT(*) AS total')) return [{ total: 87 }] as never
    if (sql.includes('SELECT DISTINCT t.currency'))
      return [{ currency: 'EUR' }, { currency: 'USD' }] as never
    if (sql.includes('needs_category_count'))
      return [
        {
          all_count: 11,
          needs_category_count: 5,
          pending_count: 4,
          placeholder_count: 1,
          staged_count: 2,
          unclassified_count: 3,
        },
      ] as never
    return [{ id: 'row-1', has_splits: 0 }] as never
  })
}

describe('transaction query boundary', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('escapes LIKE wildcard and escape characters as literals', () => {
    expect(escapeLikeLiteral(String.raw`50%_off\today`)).toBe(String.raw`50\%\_off\\today`)
  })

  it('applies parameterized filters before pagination with source/destination and split semantics', async () => {
    arrangePageResponses()

    const result = await queryTransactionPage({
      search: String.raw`50%_off\today`,
      type: 'expense',
      account: 'account-2',
      category: 'category-food',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-01',
      status: 'posted',
      currency: 'USD',
      page: 2,
      pageSize: 50,
      sort: 'description',
      direction: 'asc',
    })

    const [rowSql, rowParams] = mockQuery.mock.calls[0]
    expect(rowSql).toContain("LIKE ? ESCAPE '\\'")
    expect(rowSql).toContain('(t.account_id = ? OR t.transfer_to_account_id = ?)')
    expect(rowSql).toContain('category_split.transaction_id = t.id')
    expect(rowSql).toContain('NOT EXISTS(SELECT 1 FROM transaction_splits')
    expect(rowSql.indexOf('WHERE')).toBeLessThan(rowSql.indexOf('LIMIT ? OFFSET ?'))
    expect(rowSql).toContain('ORDER BY LOWER(t.description) ASC, t.id ASC')
    expect(rowParams).toContain(String.raw`%50\%\_off\\today%`)
    expect(rowParams?.slice(-2)).toEqual([50, 50])
    expect(result.total).toBe(87)
    expect(result.currencies).toEqual(['EUR', 'USD'])
    expect(result.reviewCounts.all).toBe(11)
    expect(result.reviewCounts.unclassified).toBe(3)
  })

  it('normalizes null, empty, and whitespace statuses in page filters and full review counts', async () => {
    arrangePageResponses()

    await queryTransactionPage({ status: 'posted', reviewReason: 'pending' })

    const pageSql = mockQuery.mock.calls[0][0]
    const reviewSql = mockQuery.mock.calls.find(([sql]) => sql.includes('pending_count'))?.[0]
    expect(pageSql).toContain("COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = ?")
    expect(pageSql).toContain("COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = 'pending'")
    expect(reviewSql).toContain("COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = 'pending'")
    expect(reviewSql).not.toContain('LIMIT')
  })

  it('uses all matching review rows for the all queue while keeping currency facets global', async () => {
    arrangePageResponses()

    await queryTransactionPage({ account: 'account-2', reviewReason: 'all' })

    const pageSql = mockQuery.mock.calls[0][0]
    expect(pageSql).toContain('staged_no_balance_impact')
    expect(pageSql).toContain('placeholder_status')
    const currencyCall = mockQuery.mock.calls.find(([sql]) => sql.includes('DISTINCT t.currency'))
    expect(currencyCall?.[0]).toContain('COALESCE(t.is_archived, 0) = 0')
    expect(currencyCall?.[0]).not.toContain('account_id = ?')
    expect(currencyCall?.[1]).toBeUndefined()
  })

  it('filters and counts unclassified allocations across the full result before pagination', async () => {
    arrangePageResponses()

    await queryTransactionPage({
      account: 'account-2',
      reviewReason: 'unclassified',
      page: 2,
      pageSize: 25,
    })

    const pageSql = mockQuery.mock.calls[0][0]
    const countSql = mockQuery.mock.calls.find(([sql]) => sql.includes('COUNT(*) AS total'))?.[0]
    const reviewSql = mockQuery.mock.calls.find(([sql]) => sql.includes('unclassified_count'))?.[0]
    expect(pageSql).toContain('transaction_consumption_classifications')
    expect(pageSql).toContain('consumption_split.id')
    expect(pageSql).toContain('consumption_receivable')
    expect(countSql).toContain('transaction_consumption_classifications')
    expect(reviewSql).toContain('unclassified_count')
    expect(reviewSql).not.toContain('LIMIT')
  })

  it('performs a bounded joined lookup by ID for safe edit mode', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'page-2-row', description: 'Correct row' }] as never)

    const result = await getTransactionById('page-2-row')

    expect(result?.description).toBe('Correct row')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE t.id = ?'), [
      'page-2-row',
    ])
    expect(mockQuery.mock.calls[0][0]).toContain('LIMIT 1')
    expect(mockQuery.mock.calls[0][0]).toContain('is_finalized_statement')
  })
})
