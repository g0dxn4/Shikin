import { apportionConvertedAmount } from '@shikin/finance-core/fx'
import {
  CASH_FLOW_SQL,
  SQL_WHITESPACE,
  getCashFlowIntegrityFailure,
  type CashFlowIntegrityRow,
} from '@shikin/finance-core'
import { getCurrencySettings } from './fx-service.js'
import { readDatedAmounts, sumCentavos } from './dated-read.js'
import { query } from './database.js'

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
  const rows = query<CashFlowIntegrityRow>(
    `SELECT t.id, t.type, t.amount, t.currency,
       (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count,
       (SELECT SUM(s.amount) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_total,
       (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id
         AND (typeof(s.amount) != 'integer' OR s.amount <= 0)) AS invalid_splits
     FROM transactions t WHERE ${CASH_FLOW_SQL} AND t.date >= $1 AND t.date <= $2${accountFilter}`,
    params
  )
  const failure = getCashFlowIntegrityFailure(rows)
  if (!failure) return null
  return {
    success: false as const,
    complete: false as const,
    basis: 'gross_cashflow' as const,
    reason: failure.reason,
    transactionIds: [failure.transactionId],
    message: `Gross cash-flow report is incomplete: transaction ${failure.transactionId} has invalid currency, centavo totals or category allocations. No partial totals are reported.`,
  }
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
  currency: string
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
