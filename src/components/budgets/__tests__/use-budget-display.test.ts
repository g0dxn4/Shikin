import { describe, it, expect } from 'vitest'
import { useBudgetDisplay } from '../use-budget-display'
import { fixtureBudget } from '@/test/scoped-fixture'
describe('native budget display', () => {
  it('preserves the stored denomination and never substitutes known usage', () => {
    const budget = fixtureBudget()
    expect(useBudgetDisplay([budget]).budgets[0]).toMatchObject({
      currency: 'MXN',
      spent: 25000,
      remaining: 75000,
    })
    const incomplete = {
      ...budget,
      complete: false,
      spent: null,
      remaining: null,
      percentUsed: null,
      knownSpent: 25000,
    }
    expect(useBudgetDisplay([incomplete]).budgets[0]).toEqual(incomplete)
  })
})
