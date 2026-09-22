import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBudgetDisplay } from '../use-budget-display'
import type { BudgetWithStatus } from '@/stores/budget-store'

function budget(overrides: Partial<BudgetWithStatus> = {}): BudgetWithStatus {
  const nativeSpending = {
    complete: true,
    currency: 'USD',
    totalCentavos: 10_000,
    knownTotalCentavos: 10_000,
    nativeTotals: [{ currency: 'USD', amountCentavos: 10_000 }],
    unresolvedIds: [],
    conversions: [],
  }
  return {
    id: 'budget',
    name: 'Food',
    category_id: 'cat',
    amount: 100_000,
    period: 'monthly',
    is_active: 1,
    currency: 'USD',
    created_at: '',
    updated_at: '',
    categoryName: 'Food',
    categoryColor: '#fff',
    spent: 10_000,
    knownSpent: 10_000,
    remaining: 90_000,
    percentUsed: 10,
    complete: true,
    nativeSpending,
    mainComparison: {
      complete: true,
      policy: 'current_plan_today_vs_transaction_date_spending',
      toCurrency: 'MXN',
      plan: {
        complete: true,
        preferredCurrency: 'MXN',
        amountCentavos: 1_800_000,
        missingCurrencies: [],
        conversion: {} as never,
      },
      spending: { ...nativeSpending, currency: 'MXN', totalCentavos: 170_000 },
      remainingCentavos: 1_630_000,
      reason: null,
    },
    ...overrides,
  }
}

describe('budget durable denomination display', () => {
  it('uses current plan valuation and dated realized spending for the main report', () => {
    const { result } = renderHook(() => useBudgetDisplay([budget()]))
    expect(result.current.complete).toBe(true)
    expect(result.current.budgets[0]).toMatchObject({
      amount: 1_800_000,
      spent: 170_000,
      remaining: 1_630_000,
      percentUsed: 9,
      currency: 'MXN',
      mainComplete: true,
    })
  })

  it('retains readable native values when main conversion is unavailable', () => {
    const fixture = budget()
    const { result } = renderHook(() =>
      useBudgetDisplay([
        budget({
          mainComparison: {
            ...fixture.mainComparison,
            complete: false,
            toCurrency: null,
            spending: null,
            remainingCentavos: null,
            reason: 'main_currency_unconfigured',
            plan: {
              complete: false,
              preferredCurrency: 'USD',
              missingCurrencies: ['USD'],
              reason: 'main_currency_unconfigured',
            },
          },
        }),
      ])
    )
    expect(result.current.complete).toBe(false)
    expect(result.current.budgets[0]).toMatchObject({
      amount: 100_000,
      spent: 10_000,
      currency: 'USD',
      complete: true,
      mainComplete: false,
    })
  })

  it('does not present known partial native spending as complete', () => {
    const fixture = budget()
    const { result } = renderHook(() =>
      useBudgetDisplay([
        budget({
          complete: false,
          nativeSpending: {
            ...fixture.nativeSpending,
            complete: false,
            totalCentavos: null,
            unresolvedIds: ['tx-missing'],
          },
          mainComparison: {
            ...fixture.mainComparison,
            complete: false,
            spending: {
              ...fixture.nativeSpending,
              complete: false,
              currency: 'MXN',
              totalCentavos: null,
              unresolvedIds: ['tx-missing'],
            },
            remainingCentavos: null,
            reason: 'missing_exchange_rates',
          },
        }),
      ])
    )
    expect(result.current.budgets[0]).toMatchObject({
      complete: false,
      spent: 10_000,
      remaining: 90_000,
      mainComplete: false,
    })
  })
})
