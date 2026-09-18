import { query } from './database.js'

// ECMAScript trim whitespace, matching normalizePostingStatus and currency validation.
const SQL_WHITESPACE =
  'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)'

/** Fixed alias only; mirrors finance-core getCashFlowEligibility, including legacy nulls. */
export const CASH_FLOW_SQL = `t.type IN ('income', 'expense')
  AND COALESCE(t.reporting_treatment, 'normal') = 'normal'
  AND COALESCE(t.ledger_treatment, 'normal') = 'normal'
  AND COALESCE(t.transaction_kind, 'standard') = 'standard'
  AND COALESCE(t.is_archived, 0) = 0
  AND COALESCE(NULLIF(LOWER(TRIM(t.status, ${SQL_WHITESPACE})), ''), 'posted') IN ('posted', 'cleared')`

/** Use only after reportingReadFailure has validated the same date window.
 * Splits inherit their parent's currency; parent category is used only without splits.
 */
export const REPORTING_CTE = `WITH cash_flow AS (
  SELECT t.id, t.type, t.amount, UPPER(TRIM(t.currency, ${SQL_WHITESPACE})) AS currency, t.date,
         t.category_id, t.description, t.account_id
  FROM transactions t WHERE ${CASH_FLOW_SQL}
), category_allocations AS (
  SELECT t.id, t.type, COALESCE(s.amount, t.amount) AS amount, t.currency, t.date,
         CASE WHEN s.id IS NULL THEN t.category_id ELSE s.category_id END AS category_id,
         t.description, t.account_id
  FROM cash_flow t LEFT JOIN transaction_splits s ON s.transaction_id = t.id
)`

export function reportingReadFailure(
  start: string,
  end: string,
  scope: { accountId?: string } = {}
) {
  const accountFilter = scope.accountId ? ' AND t.account_id = $3' : ''
  const params = scope.accountId ? [start, end, scope.accountId] : [start, end]
  const rows = query<{
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
     FROM transactions t WHERE ${CASH_FLOW_SQL} AND t.date >= $1 AND t.date <= $2${accountFilter}`,
    params
  )
  const totals = new Map<string, number>()
  for (const row of rows) {
    const currency = row.currency?.trim().toUpperCase()
    const key = `${currency}:${row.type}`
    const total = (totals.get(key) ?? 0) + row.amount
    totals.set(key, total)
    const reason =
      !currency || !/^[A-Z]{3}$/.test(currency)
        ? 'invalid_currency_data'
        : !Number.isSafeInteger(row.amount) ||
            row.amount < 0 ||
            (row.split_count > 0 && (row.invalid_splits > 0 || row.split_total !== row.amount))
          ? 'invalid_category_allocations'
          : !Number.isSafeInteger(total)
            ? 'unsafe_cashflow_total'
            : null
    if (reason)
      return {
        success: false as const,
        complete: false as const,
        basis: 'gross_cashflow' as const,
        reason,
        transactionIds: [row.id],
        message: `Gross cash-flow report is incomplete: transaction ${row.id} has invalid currency, centavo totals or category allocations. No partial totals are reported.`,
      }
  }
  return null
}

/** Budgets have no currency column. Existing plan amounts are USD; never sum other currencies. */
export function readBudgetSpending(categoryId: string | null, start: string, end: string) {
  const failure = reportingReadFailure(start, end)
  if (failure) return failure
  const rows = query<{ currency: string; total: number }>(
    `${REPORTING_CTE}
     SELECT t.currency, SUM(t.amount) AS total FROM category_allocations t
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
       AND ($3 IS NULL OR t.category_id = $4)
     GROUP BY t.currency`,
    [start, end, categoryId, categoryId]
  )
  if (rows.some((row) => row.currency !== 'USD'))
    return {
      success: false as const,
      complete: false as const,
      basis: 'gross_cashflow' as const,
      reason: 'budget_currency_conversion_required',
      message:
        'Budget amounts use USD. Spending in another currency requires FX conversion; no nominal-currency comparison is reported.',
    }
  return { success: true as const, currency: 'USD', total: rows[0]?.total ?? 0 }
}
