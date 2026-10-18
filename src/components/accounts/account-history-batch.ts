import dayjs, { type Dayjs } from 'dayjs'

/** Same six-month window as account-store `loadBalanceHistory` (months = 6). */
export const ACCOUNT_HISTORY_MONTHS = 6

export type AccountHistoryPoint = {
  date: string
  balance: number
}

export type AccountHistoryRow = {
  account_id: string
  date: string
  balance: number
}

export function accountHistoryWindowStart(now: Dayjs = dayjs()): string {
  return now.subtract(ACCOUNT_HISTORY_MONTHS, 'month').format('YYYY-MM-DD')
}

/**
 * One read-only SELECT for every visible account. Uses `$1` positional params.
 * Does not append the current balance or invent daily points.
 */
export function buildAccountHistoryBatchQuery(
  accountIds: readonly string[],
  startDate: string
): { sql: string; params: unknown[] } | null {
  const ids = [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))].sort()
  if (ids.length === 0 || !startDate) return null
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ')
  const datePlaceholder = `$${ids.length + 1}`
  return {
    sql: `SELECT account_id, date, balance FROM account_balance_history WHERE account_id IN (${placeholders}) AND date >= ${datePlaceholder} ORDER BY account_id ASC, date ASC`,
    params: [...ids, startDate],
  }
}

export function groupAccountHistoryRows(
  rows: readonly AccountHistoryRow[]
): Map<string, AccountHistoryPoint[]> {
  const grouped = new Map<string, AccountHistoryPoint[]>()
  for (const row of rows) {
    if (!row?.account_id || !row.date || !Number.isSafeInteger(row.balance)) continue
    const series = grouped.get(row.account_id) ?? []
    series.push({ date: row.date, balance: row.balance })
    grouped.set(row.account_id, series)
  }
  for (const series of grouped.values()) {
    series.sort((a, b) => a.date.localeCompare(b.date))
  }
  return grouped
}

/**
 * Date-tick budget for the account plot box, not the viewport.
 * A 320px phone plot is about 286px wide and must use 2 ticks so the last two
 * labels cannot overlap. A 375px phone plot is about 341px and uses 3.
 * Desktop plots use up to 5; the chart drops that if measured labels collide.
 */
export function accountHistoryMaxDateTicks(plotWidth: number): 2 | 3 | 5 {
  if (!Number.isFinite(plotWidth) || plotWidth < 310) return 2
  if (plotWidth < 420) return 3
  return 5
}
