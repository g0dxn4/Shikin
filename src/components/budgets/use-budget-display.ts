import type { BudgetWithStatus } from '@/stores/budget-store'

/** Progress is always in the persisted plan denomination, never a preference conversion. */
export type DisplayBudget = BudgetWithStatus
export function useBudgetDisplay(budgets: BudgetWithStatus[]) {
  return { budgets, error: null, complete: budgets.every((budget) => budget.complete) }
}
