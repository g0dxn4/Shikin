import { apportionConvertedAmount } from '@shikin/finance-core/fx'
import { getCurrencySettings } from './fx-service.js'
import { readDatedAmounts, sumCentavos } from './dated-read.js'
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
  SELECT t.id, COALESCE(s.id, t.id) AS allocation_id, t.type, COALESCE(s.amount, t.amount) AS amount, t.currency, t.date,
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

type CashFlowParent = {
  id: string
  type: 'income' | 'expense'
  amount: number
  currency: string
  date: string
}
type CashFlowAllocation = CashFlowParent & {
  allocation_id: string
  category_id: string | null
}

/** Eligible parent/date conversion followed by one stable-ID split apportionment. */
export function readConvertedCashFlow(
  start: string,
  end: string,
  targetCurrency: string | null = getCurrencySettings().mainCurrency,
  scope: { activeAccountsOnly?: boolean; categoryId?: string | null; expensesOnly?: boolean } = {}
) {
  const failure = reportingReadFailure(start, end)
  if (failure) return failure
  const accountFilter = scope.activeAccountsOnly
    ? ' AND t.account_id IN (SELECT id FROM accounts WHERE is_archived = 0)'
    : ''
  const parents = query<CashFlowParent>(
    `${REPORTING_CTE} SELECT * FROM cash_flow t WHERE date >= $1 AND date <= $2${accountFilter} ORDER BY date, id`,
    [start, end]
  )
  const allocations = query<CashFlowAllocation>(
    `${REPORTING_CTE} SELECT * FROM category_allocations t WHERE date >= $1 AND date <= $2${accountFilter} ORDER BY id, allocation_id`,
    [start, end]
  )
  const eligible = parents.filter(
    (parent) =>
      (!scope.expensesOnly || parent.type === 'expense') &&
      (scope.categoryId === null ||
        scope.categoryId === undefined ||
        allocations.some((row) => row.id === parent.id && row.category_id === scope.categoryId))
  )
  const conversion = readDatedAmounts(
    eligible.map((row) => ({
      id: row.id,
      amountCentavos: row.amount,
      currency: row.currency,
      date: row.date,
    })),
    targetCurrency
  )
  const convertedById = new Map(conversion.converted.map((row) => [row.id, row]))
  const convertedAllocations = eligible.flatMap((parent) => {
    const owned = allocations.filter((row) => row.id === parent.id)
    const converted = convertedById.get(parent.id)
    const apportioned = converted?.complete
      ? parent.amount === 0
        ? owned.map((row) => ({ id: row.allocation_id, amountCentavos: 0 }))
        : apportionConvertedAmount(
            converted.amountCentavos,
            owned.map((row) => ({
              id: row.allocation_id,
              amountCentavos: row.amount,
            })),
            parent.amount
          )
      : []
    return owned
      .filter(
        (row) =>
          scope.categoryId === null ||
          scope.categoryId === undefined ||
          row.category_id === scope.categoryId
      )
      .map((row) => ({
        transactionId: row.id,
        allocationId: row.allocation_id,
        categoryId: row.category_id,
        type: row.type,
        date: row.date,
        currency: row.currency,
        nativeAmountCentavos: row.amount,
        amountCentavos:
          apportioned.find((item) => item.id === row.allocation_id)?.amountCentavos ?? null,
      }))
  })
  const summarize = (rows: typeof convertedAllocations) => {
    const complete = targetCurrency !== null && rows.every((row) => row.amountCentavos !== null)
    const income = sumCentavos(
      rows.filter((row) => row.type === 'income').map((row) => row.amountCentavos ?? 0)
    )
    const expense = sumCentavos(
      rows.filter((row) => row.type === 'expense').map((row) => row.amountCentavos ?? 0)
    )
    return {
      complete,
      incomeCentavos: complete ? income : null,
      expenseCentavos: complete ? expense : null,
      netCentavos: complete ? sumCentavos([income, -expense]) : null,
      knownIncomeCentavos: targetCurrency === null ? null : income,
      knownExpenseCentavos: targetCurrency === null ? null : expense,
    }
  }
  return {
    success: true as const,
    basis: 'gross_cashflow' as const,
    policy: 'transaction_date_parent_then_allocation' as const,
    period: { start, end },
    toCurrency: targetCurrency,
    reason: conversion.reason,
    ...summarize(convertedAllocations),
    conversion,
    allocations: convertedAllocations,
    months: [...new Set(convertedAllocations.map((row) => row.date.slice(0, 7)))]
      .sort()
      .map((month) => ({
        month,
        ...summarize(convertedAllocations.filter((row) => row.date.startsWith(month))),
      })),
    categories: [...new Set(convertedAllocations.map((row) => row.categoryId))].map(
      (categoryId) => ({
        categoryId,
        ...summarize(convertedAllocations.filter((row) => row.categoryId === categoryId)),
      })
    ),
  }
}

/** Spending is compared in the plan's durable denomination, at each transaction date. */
export function readBudgetSpending(
  categoryId: string | null,
  start: string,
  end: string,
  currency = 'USD'
) {
  const report = readConvertedCashFlow(start, end, currency, { categoryId, expensesOnly: true })
  if (!report.success) return report
  if (!report.complete)
    return {
      success: false as const,
      complete: false as const,
      basis: 'gross_cashflow' as const,
      reason: 'budget_currency_conversion_required',
      currency,
      report,
      message:
        'Budget spending is incomplete: direct dated rates into the original plan currency are required.',
    }
  return { success: true as const, currency, total: report.expenseCentavos!, report }
}
