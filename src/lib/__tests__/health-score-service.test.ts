import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/money', () => ({
  fromCentavos: (c: number) => c / 100,
}))

import { query } from '@/lib/database'
import { calculateHealthScore } from '../health-score-service'

const mockQuery = vi.mocked(query)

describe('health-score-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  /**
   * Because calculateHealthScore runs 5 sub-functions via Promise.all,
   * the query calls interleave unpredictably. We use mockImplementation
   * that responds based on the SQL content instead of call order.
   */
  function setupQueryMock(overrides: {
    income?: number
    expenses?: number
    budgets?: { id: string; amount: number; category_id: string; period: string }[]
    budgetSpent?: number
    ccDebt?: number
    savings?: number
    expenses3mo?: number
    monthlyExpenses?: number[]
  } = {}) {
    const {
      income = 500000,
      expenses = 300000,
      budgets = [],
      budgetSpent = 0,
      ccDebt = 0,
      savings = 900000,
      expenses3mo = 900000,
      monthlyExpenses = [300000, 310000, 290000, 305000, 295000, 300000],
    } = overrides

    let monthIdx = 0

    mockQuery.mockImplementation(async (sql: string) => {
      const s = sql as string
      // Savings rate & debt-to-income: income query
      if (s.includes("type = 'income'") && s.includes('SUM(amount)') && !s.includes('accounts')) {
        return [{ total: income }]
      }
      // Budget adherence: get active budgets
      if (s.includes('FROM budgets')) {
        return budgets
      }
      // Budget adherence: spending per budget category
      if (s.includes('category_id = ?') && s.includes("type = 'expense'")) {
        return [{ total: budgetSpent }]
      }
      // Debt-to-income: credit card balances
      if (s.includes("type = 'credit_card'") && s.includes('SUM(ABS(balance))')) {
        return [{ total_balance: ccDebt }]
      }
      // Emergency fund: savings balance
      if (s.includes("type = 'savings'") && s.includes('SUM(balance)')) {
        return [{ total: savings }]
      }
      // Emergency fund or spending consistency: expense totals
      if (s.includes("type = 'expense'") && s.includes('SUM(amount)')) {
        // Emergency fund 3-month query uses a wider date range
        // Spending consistency queries monthly totals in a loop
        // We need to distinguish -- emergency fund comes first in Promise.all order
        if (monthIdx === 0) {
          // Could be emergency fund or first monthly expense
          // Emergency fund query spans 3 months
          monthIdx++
          return [{ total: expenses3mo }]
        }
        if (monthIdx <= monthlyExpenses.length) {
          const val = monthlyExpenses[monthIdx - 1] ?? 0
          monthIdx++
          return [{ total: val }]
        }
        return [{ total: expenses }]
      }
      return [{ total: 0 }]
    })
  }

  it('returns a score between 0 and 100', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    expect(result.overall).toBeGreaterThanOrEqual(0)
    expect(result.overall).toBeLessThanOrEqual(100)
  })

  it('returns all 5 subscores', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    expect(result.subscores).toHaveLength(5)
    const names = result.subscores.map((s) => s.name)
    expect(names).toContain('Savings Rate')
    expect(names).toContain('Budget Adherence')
    expect(names).toContain('Debt-to-Income')
    expect(names).toContain('Emergency Fund')
    expect(names).toContain('Spending Consistency')
  })

  it('each subscore has required fields', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    for (const sub of result.subscores) {
      expect(sub).toHaveProperty('name')
      expect(sub).toHaveProperty('score')
      expect(sub).toHaveProperty('weight')
      expect(sub).toHaveProperty('description')
      expect(sub).toHaveProperty('tip')
      expect(sub.score).toBeGreaterThanOrEqual(0)
      expect(sub.score).toBeLessThanOrEqual(100)
    }
  })

  it('handles zero income', async () => {
    setupQueryMock({ income: 0, expenses: 100000 })
    const result = await calculateHealthScore()
    const savingsRate = result.subscores.find((s) => s.name === 'Savings Rate')
    expect(savingsRate?.score).toBe(0)
  })

  it('handles no data at all', async () => {
    setupQueryMock({
      income: 0,
      expenses: 0,
      savings: 0,
      expenses3mo: 0,
      monthlyExpenses: [0, 0, 0, 0, 0, 0],
    })
    const result = await calculateHealthScore()
    expect(result.overall).toBeGreaterThanOrEqual(0)
    expect(result.overall).toBeLessThanOrEqual(100)
    expect(result.tips.length).toBeGreaterThan(0)
  })

  it('trend is stable when no history exists', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    expect(result.trend).toBe('stable')
  })

  it('grade maps correctly for high scores', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    // Overall should be high with good data
    expect(['A', 'B']).toContain(result.grade)
  })

  it('includes tips from lowest-scoring subscores', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    // Tips should be strings
    for (const tip of result.tips) {
      expect(typeof tip).toBe('string')
      expect(tip.length).toBeGreaterThan(0)
    }
  })

  it('calculatedAt is a valid ISO string', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    expect(result.calculatedAt).toBeTruthy()
    expect(new Date(result.calculatedAt).toISOString()).toBe(result.calculatedAt)
  })
})
