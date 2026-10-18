import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import {
  accountHistoryWindowStart,
  buildAccountHistoryBatchQuery,
  canDrawHistory,
  groupAccountHistoryRows,
  historySparklineLayout,
} from '../account-history-batch'

describe('account history batch', () => {
  it('builds one read-only $1 query for every visible account in the six-month window', () => {
    const start = accountHistoryWindowStart(dayjs('2026-09-20'))
    expect(start).toBe(dayjs('2026-09-20').subtract(6, 'month').format('YYYY-MM-DD'))

    const built = buildAccountHistoryBatchQuery(['acc-b', 'acc-a', 'acc-b', '  '], start)
    expect(built).not.toBeNull()
    expect(built?.sql).toBe(
      'SELECT account_id, date, balance FROM account_balance_history WHERE account_id IN ($1, $2) AND date >= $3 ORDER BY account_id ASC, date ASC'
    )
    expect(built?.params).toEqual(['acc-a', 'acc-b', start])
    expect(built?.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i)
    expect(built?.sql).not.toContain('?')
    expect(buildAccountHistoryBatchQuery([], start)).toBeNull()
  })

  it('keeps recorded centavos and does not invent a line from fewer than two points', () => {
    const grouped = groupAccountHistoryRows([
      { account_id: 'acc-1', date: '2026-09-20', balance: 4084885 },
      { account_id: 'acc-1', date: '2026-03-23', balance: 2578212 },
      { account_id: 'acc-2', date: '2026-09-18', balance: -158277 },
      { account_id: 'acc-3', date: '2026-09-01', balance: 10.5 },
    ])

    expect(grouped.get('acc-1')).toEqual([
      { date: '2026-03-23', balance: 2578212 },
      { date: '2026-09-20', balance: 4084885 },
    ])
    expect(grouped.has('acc-3')).toBe(false)
    expect(canDrawHistory(grouped.get('acc-1'))).toBe(true)
    expect(canDrawHistory(grouped.get('acc-2'))).toBe(false)
    expect(historySparklineLayout(grouped.get('acc-2') ?? [])).toEqual([])

    const layout = historySparklineLayout(grouped.get('acc-1') ?? [])
    expect(layout).toHaveLength(2)
    expect(layout.map((point) => point.balance)).toEqual([2578212, 4084885])
    expect(layout.map((point) => point.date)).toEqual(['2026-03-23', '2026-09-20'])
    expect(layout[1].y).toBeLessThan(layout[0].y)
    expect(layout[1].x).toBeGreaterThan(layout[0].x)
  })
})
