import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadOverviewAccountHistory,
  useOverviewAccountComparison,
} from '@/components/dashboard/use-overview-account-comparison'

const mockQuery = vi.fn()
vi.mock('@/lib/database', () => ({ query: (...args: unknown[]) => mockQuery(...args) }))

describe('overview account comparison history loading', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('uses parameterized account/date bounds and a distinct all-time query', async () => {
    mockQuery.mockResolvedValue([])

    await loadOverviewAccountHistory('account-a', '3m', '2026-04-18')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('account_id = ? AND date >= ? AND date <= ?'),
      ['account-a', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), '2026-04-18']
    )

    await loadOverviewAccountHistory('account-b', 'all', '2026-04-18')
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('account_id = ? AND date <= ?'),
      ['account-b', '2026-04-18']
    )
  })

  it('never publishes old account data after a fast selection switch', async () => {
    let resolveOldA: (value: unknown[]) => void = () => {}
    let resolveOldB: (value: unknown[]) => void = () => {}
    mockQuery.mockImplementation((_sql: string, params: unknown[]) => {
      const accountId = params[0]
      if (accountId === 'old-a') {
        return new Promise((resolve) => {
          resolveOldA = resolve
        })
      }
      if (accountId === 'old-b') {
        return new Promise((resolve) => {
          resolveOldB = resolve
        })
      }
      return Promise.resolve([{ date: '2026-04-01', balance: accountId === 'new-a' ? 10 : 20 }])
    })

    const { result, rerender } = renderHook(
      ({ first, second }) => useOverviewAccountComparison(first, second, '6m'),
      { initialProps: { first: 'old-a', second: 'old-b' } }
    )
    expect(result.current.isLoading).toBe(true)

    rerender({ first: 'new-a', second: 'new-b' })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.firstHistory).toEqual([{ date: '2026-04-01', balance: 10 }])
    expect(result.current.secondHistory).toEqual([{ date: '2026-04-01', balance: 20 }])

    await act(async () => {
      resolveOldA([{ date: '2020-01-01', balance: 999 }])
      resolveOldB([{ date: '2020-01-01', balance: 999 }])
    })
    expect(result.current.firstHistory).toEqual([{ date: '2026-04-01', balance: 10 }])
  })

  it('clears both histories when either read fails', async () => {
    mockQuery
      .mockResolvedValueOnce([{ date: '2026-04-01', balance: 10 }])
      .mockRejectedValueOnce(new Error('history unavailable'))

    const { result } = renderHook(() => useOverviewAccountComparison('a', 'b', '6m'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBe('history unavailable')
    expect(result.current.firstHistory).toEqual([])
    expect(result.current.secondHistory).toEqual([])
  })
})
