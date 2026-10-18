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

export function canDrawHistory(points: readonly AccountHistoryPoint[] | undefined): boolean {
  return (points?.length ?? 0) >= 2
}

export type SparklinePoint = AccountHistoryPoint & {
  x: number
  y: number
}

/** Plot recorded centavo balances only. Length matches the input; no today/zero point. */
export function historySparklineLayout(
  points: readonly AccountHistoryPoint[],
  width = 100,
  height = 48
): SparklinePoint[] {
  if (points.length < 2 || width <= 0 || height <= 0) return []
  const balances = points.map((point) => point.balance)
  const min = Math.min(...balances)
  const max = Math.max(...balances)
  const span = max - min
  const times = points.map((point) => Date.parse(`${point.date}T00:00:00`))
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const tSpan = tMax - tMin
  const pad = 2
  const innerW = Math.max(1, width - pad * 2)
  const innerH = Math.max(1, height - pad * 2)

  return points.map((point, index) => {
    const x =
      tSpan === 0 || Number.isNaN(tSpan)
        ? pad + (index / (points.length - 1)) * innerW
        : pad + ((Date.parse(`${point.date}T00:00:00`) - tMin) / tSpan) * innerW
    const y = span === 0 ? pad + innerH / 2 : pad + innerH - ((point.balance - min) / span) * innerH
    return { date: point.date, balance: point.balance, x, y }
  })
}
