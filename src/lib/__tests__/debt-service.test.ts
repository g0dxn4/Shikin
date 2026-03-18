import { describe, it, expect } from 'vitest'
import { calculatePayoffPlan, compareStrategies } from '../debt-service'
import type { Debt } from '../debt-service'

describe('debt-service', () => {
  describe('calculatePayoffPlan', () => {
    it('returns empty plan for zero debts', () => {
      const plan = calculatePayoffPlan([], 'snowball')
      expect(plan.months).toBe(0)
      expect(plan.totalInterestPaid).toBe(0)
      expect(plan.totalPaid).toBe(0)
      expect(plan.schedule).toEqual([])
      expect(plan.debtPayoffOrder).toEqual([])
      expect(plan.strategy).toBe('snowball')
    })

    it('pays off a single debt correctly', () => {
      const debts: Debt[] = [
        { id: 'd1', name: 'Card A', balance: 100000, apr: 0, minPayment: 50000 },
      ]
      const plan = calculatePayoffPlan(debts, 'snowball')
      expect(plan.months).toBe(2)
      expect(plan.totalPaid).toBe(100000)
      expect(plan.totalInterestPaid).toBe(0)
      expect(plan.debtPayoffOrder).toHaveLength(1)
      expect(plan.debtPayoffOrder[0].id).toBe('d1')
    })

    it('snowball targets smallest balance first', () => {
      const debts: Debt[] = [
        { id: 'big', name: 'Big Debt', balance: 500000, apr: 10, minPayment: 10000 },
        { id: 'small', name: 'Small Debt', balance: 50000, apr: 5, minPayment: 5000 },
      ]
      const plan = calculatePayoffPlan(debts, 'snowball', 20000)
      // Small debt should be paid off first
      expect(plan.debtPayoffOrder[0].id).toBe('small')
    })

    it('avalanche targets highest APR first', () => {
      // Both debts have equal balance so payoff order depends purely on strategy
      const debts: Debt[] = [
        { id: 'low', name: 'Low APR', balance: 200000, apr: 5, minPayment: 5000 },
        { id: 'high', name: 'High APR', balance: 200000, apr: 24, minPayment: 5000 },
      ]
      const plan = calculatePayoffPlan(debts, 'avalanche', 10000)
      // High APR debt should be targeted first for extra payments and paid off first
      expect(plan.debtPayoffOrder[0].id).toBe('high')
    })

    it('extra payments cascade to next debt after payoff', () => {
      const debts: Debt[] = [
        { id: 'd1', name: 'Debt 1', balance: 10000, apr: 0, minPayment: 5000 },
        { id: 'd2', name: 'Debt 2', balance: 20000, apr: 0, minPayment: 5000 },
      ]
      // Extra 10000 + min 5000 = 15000/month on target, min 5000 on other
      const plan = calculatePayoffPlan(debts, 'snowball', 10000)
      // d1 should be paid off in month 1 (10000 balance, 5000 min + 10000 extra = 15000 available)
      expect(plan.debtPayoffOrder[0].id).toBe('d1')
      expect(plan.debtPayoffOrder[0].paidOffMonth).toBe(1)
    })

    it('all amounts stay in centavos (integers)', () => {
      const debts: Debt[] = [
        { id: 'd1', name: 'Card', balance: 150050, apr: 18.99, minPayment: 5000 },
      ]
      const plan = calculatePayoffPlan(debts, 'avalanche', 10000)
      for (const snapshot of plan.schedule) {
        expect(Number.isInteger(snapshot.totalBalance)).toBe(true)
        for (const interest of Object.values(snapshot.interestCharged)) {
          expect(Number.isInteger(interest)).toBe(true)
        }
      }
      expect(Number.isInteger(plan.totalInterestPaid)).toBe(true)
    })

    it('charges monthly interest correctly', () => {
      const debts: Debt[] = [
        { id: 'd1', name: 'Card', balance: 120000, apr: 12, minPayment: 120000 },
      ]
      // APR 12% => monthly rate 1%, on 120000 => 1200 interest first month
      const plan = calculatePayoffPlan(debts, 'snowball')
      expect(plan.schedule[0].interestCharged['d1']).toBe(1200)
      // Balance after interest = 121200, min payment covers 120000, remaining = 1200
      expect(plan.schedule[0].balances['d1']).toBe(1200)
    })
  })

  describe('compareStrategies', () => {
    it('returns both strategies and their differences', () => {
      const debts: Debt[] = [
        { id: 'd1', name: 'Low', balance: 50000, apr: 5, minPayment: 5000 },
        { id: 'd2', name: 'High', balance: 200000, apr: 25, minPayment: 10000 },
      ]
      const comparison = compareStrategies(debts, 5000)
      expect(comparison.snowball.strategy).toBe('snowball')
      expect(comparison.avalanche.strategy).toBe('avalanche')
      // Avalanche saves interest over snowball (or equal)
      expect(comparison.interestSaved).toBeGreaterThanOrEqual(0)
      expect(typeof comparison.monthsDifference).toBe('number')
    })

    it('returns zero differences for empty debts', () => {
      const comparison = compareStrategies([])
      expect(comparison.interestSaved).toBe(0)
      expect(comparison.monthsDifference).toBe(0)
    })

    it('avalanche saves on interest when APRs differ', () => {
      const debts: Debt[] = [
        { id: 'small-high', name: 'Small High APR', balance: 30000, apr: 30, minPayment: 3000 },
        { id: 'big-low', name: 'Big Low APR', balance: 300000, apr: 5, minPayment: 10000 },
      ]
      const comparison = compareStrategies(debts, 5000)
      // Avalanche targets 30% APR first, so it saves interest
      expect(comparison.avalanche.totalInterestPaid).toBeLessThanOrEqual(
        comparison.snowball.totalInterestPaid
      )
    })
  })
})
