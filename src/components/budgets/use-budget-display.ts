import { useMemo } from 'react'
import type { BudgetWithStatus } from '@/stores/budget-store'

export type DisplayBudget = Omit<
  BudgetWithStatus,
  'amount' | 'spent' | 'remaining' | 'percentUsed'
> & {
  amount: number
  spent: number
  remaining: number
  percentUsed: number
  complete: boolean
  mainComplete: boolean
  mainAmount: number | null
  mainSpent: number | null
  mainRemaining: number | null
  currency: string
}

/**
 * Main reporting compares today's converted plan with transaction-date spending.
 * If that comparison is unavailable, retain the durable native budget read for each row.
 */
export function useBudgetDisplay(budgets: BudgetWithStatus[]) {
  const display = useMemo(
    () =>
      budgets.map((budget): DisplayBudget => {
        const { mainComparison } = budget
        const mainSpending = mainComparison.spending
        if (
          mainComparison.complete &&
          mainComparison.toCurrency &&
          mainComparison.plan.complete &&
          mainSpending?.complete &&
          mainSpending.totalCentavos !== null
        ) {
          const amount = mainComparison.plan.amountCentavos
          const spent = mainSpending.totalCentavos
          return {
            ...budget,
            amount,
            spent,
            remaining: amount - spent,
            percentUsed: amount > 0 ? Math.round((spent / amount) * 100) : 0,
            complete: true,
            mainComplete: true,
            mainAmount: amount,
            mainSpent: spent,
            mainRemaining: amount - spent,
            currency: mainComparison.toCurrency,
          }
        }

        return {
          ...budget,
          amount: budget.amount,
          spent: budget.complete ? budget.spent : budget.knownSpent,
          remaining: budget.complete ? budget.remaining : budget.amount - budget.knownSpent,
          percentUsed:
            budget.complete && budget.amount > 0
              ? budget.percentUsed
              : budget.amount > 0
                ? Math.round((budget.knownSpent / budget.amount) * 100)
                : 0,
          complete: budget.complete,
          mainComplete: false,
          mainAmount: mainComparison.plan.complete ? mainComparison.plan.amountCentavos : null,
          mainSpent: mainComparison.spending?.totalCentavos ?? null,
          mainRemaining: mainComparison.remainingCentavos,
          currency: budget.currency,
        }
      }),
    [budgets]
  )
  return {
    budgets: display,
    error: null,
    complete: display.every((budget) => budget.mainComplete),
  }
}
