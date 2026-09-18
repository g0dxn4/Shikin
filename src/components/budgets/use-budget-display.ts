import { CATEGORY_ALLOCATION_CTE } from '@/lib/reporting-read'
import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { isCashFlowEligible } from '@shikin/finance-core'
import { query } from '@/lib/database'
import { useCurrencyStore } from '@/stores/currency-store'
import type { BudgetWithStatus } from '@/stores/budget-store'
import type { Transaction } from '@/types/database'

type SpendingRow = Pick<
  Transaction,
  | 'type'
  | 'status'
  | 'currency'
  | 'ledger_treatment'
  | 'reporting_treatment'
  | 'transaction_kind'
  | 'is_archived'
> & { budget_id: string; amount: number; invalid_allocations?: number }
export type DisplayBudget = BudgetWithStatus & { complete: boolean; currency: string }

export function useBudgetDisplay(budgets: BudgetWithStatus[]) {
  const { preferredCurrency, convertToPreferred, rates, invalidRates } = useCurrencyStore()
  const [read, setRead] = useState<{ budgets: BudgetWithStatus[]; rows: SpendingRow[] } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!budgets.length) return
    let active = true
    const now = dayjs()
    const params = ['week', 'month', 'year'].flatMap((period) => [
      now.startOf(period as 'week' | 'month' | 'year').format('YYYY-MM-DD'),
      now.format('YYYY-MM-DD'),
    ])
    query<SpendingRow>(
      `${CATEGORY_ALLOCATION_CTE}
      SELECT b.id AS budget_id, t.currency, t.type, t.status, t.ledger_treatment, t.reporting_treatment,
      t.transaction_kind, t.is_archived, SUM(t.amount) AS amount, MAX(t.invalid_allocations) AS invalid_allocations
      FROM budgets b JOIN reporting_allocations t
        ON b.category_id IS NULL OR t.category_id = b.category_id OR t.invalid_allocations = 1
      WHERE b.is_active = 1 AND (
        (b.period = 'weekly' AND t.date >= ? AND t.date <= ?) OR
        (b.period = 'monthly' AND t.date >= ? AND t.date <= ?) OR
        (b.period = 'yearly' AND t.date >= ? AND t.date <= ?))
      GROUP BY b.id, t.currency, t.type, t.status, t.ledger_treatment, t.reporting_treatment, t.transaction_kind, t.is_archived`,
      params
    )
      .then((rows) => {
        if (active) {
          setRead({ budgets, rows })
          setError(null)
        }
      })
      .catch((error) => {
        if (active) setError(String(error))
      })
    return () => {
      active = false
    }
  }, [budgets])
  const display = useMemo(
    () =>
      budgets.map((budget) => {
        // Budget/goal schemas have no currency field; existing forms store USD plan amounts.
        const planned = convertToPreferred(budget.amount, 'USD')
        let complete = planned.complete && read?.budgets === budgets && !error
        let spent = 0
        for (const row of read?.budgets === budgets ? read.rows : []) {
          if (
            row.budget_id !== budget.id ||
            row.type !== 'expense' ||
            !isCashFlowEligible({
              type: row.type,
              status: row.status,
              ledgerTreatment: row.ledger_treatment,
              reportingTreatment: row.reporting_treatment,
              transactionKind: row.transaction_kind,
              isArchived: row.is_archived,
            })
          )
            continue
          if (row.invalid_allocations) {
            complete = false
            continue
          }
          const converted = convertToPreferred(row.amount, row.currency)
          if (!converted.complete) complete = false
          else spent += converted.amountCentavos
        }
        const amount = planned.complete ? planned.amountCentavos : 0
        return {
          ...budget,
          amount,
          spent,
          remaining: amount - spent,
          percentUsed: amount > 0 ? Math.round((spent / amount) * 100) : 0,
          complete: Boolean(complete),
          currency: preferredCurrency,
        }
      }),
    // Rates are read by the stable store converter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgets, read, error, preferredCurrency, convertToPreferred, rates, invalidRates]
  )
  return { budgets: display, error, complete: display.every((budget) => budget.complete) }
}
