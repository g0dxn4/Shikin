import { describe, it, expect, vi, beforeEach } from 'vitest'
import dayjs from 'dayjs'

const mockStore = vi.hoisted(() => ({
  get: vi.fn(async () => null),
  set: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue(mockStore),
}))

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/money', () => ({
  formatMoney: (c: number, currency: string) => `${currency} ${(c / 100).toFixed(2)}`,
}))

import { query } from '@/lib/database'
import { calculateHealthScore } from '../health-score-service'

const mockQuery = vi.mocked(query)

describe('health-score-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.get.mockResolvedValue(null)
  })

  /**
   * Because calculateHealthScore runs 5 sub-functions via Promise.all,
   * the query calls interleave unpredictably. We use mockImplementation
   * that responds based on the SQL content instead of call order.
   */
  function setupQueryMock(
    overrides: {
      income?: number
      expenses?: number
      budgets?: { id: string; amount: number; category_id: string; period: string }[]
      budgetSpent?: number
      ccDebt?: number
      savings?: number
      expenses3mo?: number
      monthlyExpenses?: number[]
    } = {}
  ) {
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

    mockQuery.mockImplementation(async (sql: string) => {
      const s = sql as string
      if (s.includes('AS split_count')) return []
      if (s.includes('FROM budgets')) return budgets
      if (s.includes("type IN ('credit_card', 'savings')")) {
        return [
          { type: 'credit_card', balance: -ccDebt, currency: 'USD' },
          { type: 'savings', balance: savings, currency: 'USD' },
        ]
      }
      if (s.includes('FROM reporting_allocations')) {
        const base = {
          status: 'posted',
          ledger_treatment: 'normal',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
          is_archived: 0,
          currency: 'USD',
          category_id: null as string | null,
          invalid_allocations: 0,
          invalid_reporting_data: 0,
        }
        const rows = monthlyExpenses.slice(0, 5).map((amount, index) => ({
          ...base,
          type: 'expense',
          amount,
          date: dayjs()
            .subtract(5 - index, 'month')
            .format('YYYY-MM-DD'),
        }))
        rows.push({ ...base, type: 'income', amount: income, date: dayjs().format('YYYY-MM-DD') })
        rows.push({
          ...base,
          type: 'expense',
          amount: expenses,
          date: dayjs().format('YYYY-MM-DD'),
        })
        if (budgets.length > 0 && budgetSpent > 0) {
          rows.push({
            ...base,
            type: 'expense',
            amount: budgetSpent,
            date: dayjs().format('YYYY-MM-DD'),
            category_id: budgets[0].category_id,
          })
        }
        void expenses3mo
        return rows
      }
      return []
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

  it('rejects incomplete reporting evidence instead of publishing a zero score', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('AS split_count')) {
        return [
          {
            id: 'tx-bad',
            type: 'expense',
            amount: 1000,
            currency: 'USD',
            split_count: 2,
            split_total: 900,
            invalid_splits: 0,
          },
        ]
      }
      return []
    })

    await expect(calculateHealthScore()).rejects.toThrow(/transaction tx-bad/)
    expect(mockStore.set).not.toHaveBeenCalled()
  })

  it('calculatedAt is a valid ISO string', async () => {
    setupQueryMock()
    const result = await calculateHealthScore()
    expect(result.calculatedAt).toBeTruthy()
    expect(new Date(result.calculatedAt).toISOString()).toBe(result.calculatedAt)
  })
})
