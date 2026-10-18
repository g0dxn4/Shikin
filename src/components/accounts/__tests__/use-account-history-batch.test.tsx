import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountHistoryBatch } from '../use-account-history-batch'

const mockQuery = vi.hoisted(() => vi.fn())
const windowStartMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/database', () => ({
  query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
}))

vi.mock('@/components/accounts/account-history-batch', async () => {
  const actual = await vi.importActual('../account-history-batch')
  const start = (actual as { accountHistoryWindowStart: (now?: unknown) => string })
    .accountHistoryWindowStart
  return {
    ...actual,
    accountHistoryWindowStart: (now?: unknown) => {
      const override = windowStartMock()
      if (typeof override === 'string' && override.length > 0) return override
      return start(now)
    },
  }
})

describe('useAccountHistoryBatch', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    windowStartMock.mockReset()
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
    expect(result.current.windowStart).toBe(mockQuery.mock.calls[1][1]?.at(-1))
  })

  it('does not throw when the batch read fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('history read failed'))
    const { result } = renderHook(() => useAccountHistoryBatch(['acc-1']))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.series.size).toBe(0)
    expect(result.current.windowStart).toBeNull()
  })

  it('returns the queried window and hides a series when the window or currency changes', async () => {
    windowStartMock.mockReturnValue('2026-04-18')
    mockQuery.mockResolvedValueOnce([
      { account_id: 'a', date: '2026-05-01', balance: -158277 },
      { account_id: 'a', date: '2026-06-01', balance: -150000 },
    ])
    const { result, rerender } = renderHook(
      ({ scope, refresh }: { scope: string; refresh: string }) =>
        useAccountHistoryBatch(['a'], refresh, scope),
      { initialProps: { scope: 'a:EUR', refresh: '1' } }
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.windowStart).toBe('2026-04-18')
    expect(mockQuery.mock.calls[0][1]).toEqual(['a', '2026-04-18'])
    expect(String(mockQuery.mock.calls[0][0])).toContain('date >= $2')
    expect(String(mockQuery.mock.calls[0][0])).not.toMatch(/\bLIMIT\b/i)

    mockQuery.mockImplementationOnce(() => new Promise(() => {}))
    rerender({ scope: 'a:EUR', refresh: '2' })
    expect(result.current.status).toBe('loading')
    expect(result.current.windowStart).toBe('2026-04-18')
    expect(result.current.series.get('a')?.[0].balance).toBe(-158277)

    let resolveNext: (rows: unknown[]) => void = () => {}
    mockQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve
        })
    )
    windowStartMock.mockReturnValue('2026-05-18')
    rerender({ scope: 'a:EUR', refresh: '3' })
    expect(result.current.status).toBe('loading')
    expect(result.current.series.size).toBe(0)
    expect(result.current.windowStart).toBeNull()

    await act(async () => {
      resolveNext([{ account_id: 'a', date: '2026-06-02', balance: -140000 }])
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.windowStart).toBe('2026-05-18')
    expect(result.current.series.get('a')).toEqual([{ date: '2026-06-02', balance: -140000 }])

    mockQuery.mockImplementationOnce(() => new Promise(() => {}))
    rerender({ scope: 'a:USD', refresh: '3' })
    expect(result.current.status).toBe('loading')
    expect(result.current.series.size).toBe(0)
    expect(result.current.windowStart).toBeNull()
  })
})
