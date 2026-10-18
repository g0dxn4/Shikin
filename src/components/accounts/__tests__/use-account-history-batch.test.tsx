import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountHistoryBatch } from '../use-account-history-batch'

const mockQuery = vi.hoisted(() => vi.fn())

vi.mock('@/lib/database', () => ({
  query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
}))

describe('useAccountHistoryBatch', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('reads visible accounts once and ignores a stale response', async () => {
    let resolveFirst: (rows: unknown[]) => void = () => {}
    mockQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    mockQuery.mockResolvedValueOnce([
      { account_id: 'b', date: '2026-04-02', balance: 20 },
      { account_id: 'b', date: '2026-04-01', balance: 10 },
    ])

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useAccountHistoryBatch(ids),
      { initialProps: { ids: ['a'] } }
    )
    expect(result.current.status).toBe('loading')

    rerender({ ids: ['b'] })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.series.get('b')).toEqual([
      { date: '2026-04-01', balance: 10 },
      { date: '2026-04-02', balance: 20 },
    ])
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(String(mockQuery.mock.calls[1][0])).toContain('account_id IN ($1)')
    expect(mockQuery.mock.calls[1][1]?.[0]).toBe('b')

    await act(async () => {
      resolveFirst([{ account_id: 'a', date: '2020-01-01', balance: 999 }])
    })
    expect(result.current.series.has('a')).toBe(false)
    expect(result.current.series.get('b')?.[1].balance).toBe(20)
  })

  it('does not throw when the batch read fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('history read failed'))
    const { result } = renderHook(() => useAccountHistoryBatch(['acc-1']))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.series.size).toBe(0)
  })
})
