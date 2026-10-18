import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import {
  accountHistoryMaxDateTicks,
  accountHistoryWindowStart,
  buildAccountHistoryBatchQuery,
  groupAccountHistoryRows,
} from '../account-history-batch'

describe('account history batch', () => {
  it('builds one read-only $1 query for every visible account in the six-month window', () => {
    const start = accountHistoryWindowStart(dayjs('2026-09-20'))
    expect(start).toBe('2026-03-20')
    expect(start).toBe(dayjs('2026-09-20').subtract(6, 'month').format('YYYY-MM-DD'))

    const built = buildAccountHistoryBatchQuery(['acc-b', 'acc-a', 'acc-b', '  '], start)
    expect(built).not.toBeNull()
    expect(built?.sql).toBe(
      'SELECT account_id, date, balance FROM account_balance_history WHERE account_id IN ($1, $2) AND date >= $3 ORDER BY account_id ASC, date ASC'
    )
    expect(built?.params).toEqual(['acc-a', 'acc-b', start])
    expect(built?.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|LIMIT|MAX)\b/i)
    expect(built?.sql).not.toMatch(/date\s*(<=|<)/i)
    expect(built?.sql).not.toContain('?')
    expect(buildAccountHistoryBatchQuery([], start)).toBeNull()
    expect(buildAccountHistoryBatchQuery(['acc-a'], '')).toBeNull()
  })

  it('keeps recorded centavos, including a single or flat row, and drops non-integers', () => {
    const grouped = groupAccountHistoryRows([
      { account_id: 'acc-1', date: '2026-09-20', balance: 4084885 },
      { account_id: 'acc-1', date: '2026-03-23', balance: 2578212 },
      { account_id: 'acc-2', date: '2026-09-18', balance: -158277 },
      { account_id: 'acc-3', date: '2026-09-01', balance: 10.5 },
      { account_id: 'acc-4', date: '2026-04-30', balance: 0 },
      { account_id: 'acc-4', date: '2026-05-31', balance: 0 },
    ])

    expect(grouped.get('acc-1')).toEqual([
      { date: '2026-03-23', balance: 2578212 },
      { date: '2026-09-20', balance: 4084885 },
    ])
    expect(grouped.has('acc-3')).toBe(false)
    expect(grouped.get('acc-2')).toEqual([{ date: '2026-09-18', balance: -158277 }])
    expect(grouped.get('acc-4')?.map((point) => point.balance)).toEqual([0, 0])
  })

  it('uses two date ticks on a 320 phone plot, three at 375, and five on desktop', () => {
    expect(accountHistoryMaxDateTicks(286)).toBe(2)
    expect(accountHistoryMaxDateTicks(320)).toBe(3)
    expect(accountHistoryMaxDateTicks(341)).toBe(3)
    expect(accountHistoryMaxDateTicks(375)).toBe(3)
    expect(accountHistoryMaxDateTicks(419)).toBe(3)
    expect(accountHistoryMaxDateTicks(480)).toBe(5)
    expect(accountHistoryMaxDateTicks(0)).toBe(2)
    expect(accountHistoryMaxDateTicks(Number.NaN)).toBe(2)
  })
})
