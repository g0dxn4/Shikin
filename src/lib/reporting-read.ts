import { query } from '@/lib/database'

// ECMAScript trim whitespace, matching finance-core posting-status normalization.
const SQL_WHITESPACE =
  'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)'

/** Fixed alias only; mirrors finance-core cash-flow eligibility, including legacy nulls. */
export const CASH_FLOW_SQL = `t.type IN ('income', 'expense')
  AND COALESCE(t.reporting_treatment, 'normal') = 'normal'
  AND COALESCE(t.ledger_treatment, 'normal') = 'normal'
  AND COALESCE(t.transaction_kind, 'standard') = 'standard'
  AND COALESCE(t.is_archived, 0) = 0
  AND COALESCE(NULLIF(LOWER(TRIM(t.status, ${SQL_WHITESPACE})), ''), 'posted') IN ('posted', 'cleared')`

/** Fixed SQL aliases only. Consumers apply canonical eligibility before using these rows.
 * Allocation integrity travels with every row so grouped reads can fail incomplete.
 */
export const CATEGORY_ALLOCATION_CTE = `WITH reporting_allocations AS (
  SELECT t.id AS transaction_id, t.type, t.status, t.ledger_treatment, t.reporting_treatment,
         t.transaction_kind, t.is_archived, t.currency, t.date,
         CASE WHEN s.id IS NULL THEN t.category_id ELSE s.category_id END AS category_id,
         COALESCE(s.amount, t.amount) AS amount,
         CASE WHEN EXISTS (SELECT 1 FROM transaction_splits v WHERE v.transaction_id = t.id)
           AND ((SELECT SUM(v.amount) FROM transaction_splits v WHERE v.transaction_id = t.id) != t.amount
             OR EXISTS (SELECT 1 FROM transaction_splits v WHERE v.transaction_id = t.id
                        AND (typeof(v.amount) != 'integer' OR v.amount <= 0)))
           THEN 1 ELSE 0 END AS invalid_allocations,
         CASE WHEN typeof(t.amount) != 'integer' OR t.amount < 0
           OR LENGTH(UPPER(TRIM(t.currency, ${SQL_WHITESPACE}))) != 3
           OR UPPER(TRIM(t.currency, ${SQL_WHITESPACE})) GLOB '*[^A-Z]*'
           THEN 1 ELSE 0 END AS invalid_reporting_data
  FROM transactions t LEFT JOIN transaction_splits s ON s.transaction_id = t.id
)`

export class ReportingReadError extends Error {
  readonly reason:
    | 'invalid_currency_data'
    | 'invalid_category_allocations'
    | 'unsafe_cashflow_total'
  readonly transactionIds: string[]

  constructor(reason: ReportingReadError['reason'], transactionId: string) {
    super(
      `Financial reporting is unavailable because transaction ${transactionId} contains invalid currency, centavo totals, or category allocations.`
    )
    this.transactionIds = [transactionId]
    this.name = 'ReportingReadError'
    this.reason = reason
  }
}

/** Validate eligible rows before a consumer publishes a complete aggregate. */
export async function assertReportingReadComplete(start?: string, end?: string): Promise<void> {
  const dateFilter = start && end ? ' AND t.date >= ? AND t.date <= ?' : ''
  const rows = await query<{
    id: string
    type: string
    amount: number
    currency: string | null
    split_count: number
    split_total: number | null
    invalid_splits: number
  }>(
    `SELECT t.id, t.type, t.amount, t.currency,
       (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count,
       (SELECT SUM(s.amount) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_total,
       (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id
         AND (typeof(s.amount) != 'integer' OR s.amount <= 0)) AS invalid_splits
     FROM transactions t WHERE ${CASH_FLOW_SQL}${dateFilter}`,
    start && end ? [start, end] : []
  )

  const totals = new Map<string, number>()
  for (const row of rows) {
    const currency = row.currency?.trim().toUpperCase()
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new ReportingReadError('invalid_currency_data', row.id)
    }
    if (
      !Number.isSafeInteger(row.amount) ||
      row.amount < 0 ||
      (row.split_count > 0 && (row.invalid_splits > 0 || row.split_total !== row.amount))
    ) {
      throw new ReportingReadError('invalid_category_allocations', row.id)
    }
    const key = `${currency}:${row.type}`
    const total = (totals.get(key) ?? 0) + row.amount
    if (!Number.isSafeInteger(total)) throw new ReportingReadError('unsafe_cashflow_total', row.id)
    totals.set(key, total)
  }
}
