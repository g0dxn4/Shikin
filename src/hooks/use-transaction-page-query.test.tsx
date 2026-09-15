import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransactionPageQuery } from './use-transaction-page-query'
import { queryTransactionPage } from '@/lib/transaction-query'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'

vi.mock('@/lib/transaction-query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/transaction-query')
  return { ...actual, queryTransactionPage: vi.fn() }
})

const mockQueryTransactionPage = vi.mocked(queryTransactionPage)
const emptyResult = {
  rows: [],
  total: 0,
  currencies: [],
  reviewCounts: { all: 0, 'needs-category': 0, pending: 0, placeholder: 0, staged: 0 },
}

describe('useTransactionPageQuery', () => {
  beforeEach(() => {
    mockQueryTransactionPage.mockReset()
  })

  it('ignores stale async results when a newer page request finishes first', async () => {
    let resolveFirst!: (value: typeof emptyResult) => void
    mockQueryTransactionPage
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ ...emptyResult, total: 1, rows: [{ id: 'newer' }] as never })

    const { result, rerender } = renderHook(
      ({ page }) => useTransactionPageQuery({ page, pageSize: 25 }),
      { initialProps: { page: 1 } }
    )
    await waitFor(() => expect(mockQueryTransactionPage).toHaveBeenCalledTimes(1))
    rerender({ page: 2 })

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('newer'))
    await act(async () =>
      resolveFirst({ ...emptyResult, total: 99, rows: [{ id: 'stale' }] as never })
    )

    expect(result.current.rows[0]?.id).toBe('newer')
    expect(result.current.total).toBe(1)
  })

  it('refreshes rows, counts, review counts, and facets through the single invalidation event', async () => {
    mockQueryTransactionPage.mockResolvedValueOnce(emptyResult).mockResolvedValueOnce({
      ...emptyResult,
      total: 1,
      currencies: ['USD'],
      rows: [{ id: 'created' }] as never,
      reviewCounts: { ...emptyResult.reviewCounts, all: 1, pending: 1 },
    })

    const { result } = renderHook(() => useTransactionPageQuery({ page: 1, pageSize: 25 }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => invalidateTransactionPage('import'))

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('created'))
    expect(result.current.total).toBe(1)
    expect(result.current.currencies).toEqual(['USD'])
    expect(result.current.reviewCounts.pending).toBe(1)
  })
})
