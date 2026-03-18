import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query } from '@/lib/database'
import { generateCashFlowForecast } from '../forecast-service'

const mockQuery = vi.mocked(query)

describe('forecast-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupMocks(
    balance: number,
    dailyAverages: { type: string; avg_daily: number }[],
    subscriptions: { amount: number; billing_cycle: string; is_active: number }[] = []
  ) {
    mockQuery
      .mockResolvedValueOnce([{ total: balance }])      // account balance
      .mockResolvedValueOnce(dailyAverages)              // daily income/expense averages
      .mockResolvedValueOnce(subscriptions)              // subscriptions
  }

  it('returns correct number of forecast points (days + 1 for today)', async () => {
    setupMocks(100000, [])
    const result = await generateCashFlowForecast(30)
    expect(result.points).toHaveLength(31) // day 0 (today) through day 30
  })

  it('returns current balance as first point', async () => {
    setupMocks(500000, [])
    const result = await generateCashFlowForecast(7)
    expect(result.currentBalance).toBe(500000)
    expect(result.points[0].projected).toBe(500000)
    expect(result.points[0].optimistic).toBe(500000)
    expect(result.points[0].pessimistic).toBe(500000)
  })

  it('optimistic uses 80% of expenses', async () => {
    // $100/day income, $80/day expense => net = $20/day
    // optimistic: income - expense*0.8 = 100 - 64 = 36/day
    setupMocks(0, [
      { type: 'income', avg_daily: 10000 },
      { type: 'expense', avg_daily: 8000 },
    ])
    const result = await generateCashFlowForecast(1)
    // Day 1: optimistic = 0 + (10000 - 8000*0.8) = 0 + 3600 = 3600
    expect(result.points[1].optimistic).toBe(3600)
  })

  it('pessimistic uses 120% of expenses', async () => {
    setupMocks(0, [
      { type: 'income', avg_daily: 10000 },
      { type: 'expense', avg_daily: 8000 },
    ])
    const result = await generateCashFlowForecast(1)
    // Day 1: pessimistic = 0 + (10000 - 8000*1.2) = 0 + 400 = 400
    expect(result.points[1].pessimistic).toBe(400)
  })

  it('calculates danger dates when projected balance goes below threshold', async () => {
    // Start with $100, spend $50/day, no income
    setupMocks(10000, [
      { type: 'expense', avg_daily: 5000 },
    ])
    const result = await generateCashFlowForecast(5, 0) // danger when balance < 0
    // Day 0: 10000, Day 1: 5000, Day 2: 0, Day 3: -5000
    expect(result.dangerDates.length).toBeGreaterThan(0)
  })

  it('works with empty transaction history', async () => {
    setupMocks(50000, [])
    const result = await generateCashFlowForecast(10)
    // No income or expenses => balance stays flat
    expect(result.dailyBurnRate).toBe(0)
    expect(result.dailyIncome).toBe(0)
    for (const point of result.points) {
      expect(point.projected).toBe(50000)
    }
  })

  it('tracks minimum balance across forecast', async () => {
    // Balance goes down then stays
    setupMocks(20000, [
      { type: 'expense', avg_daily: 5000 },
    ])
    const result = await generateCashFlowForecast(10)
    // Balance decreases each day, min should be at last day
    expect(result.minBalance.amount).toBeLessThan(20000)
  })

  it('factors in subscriptions for daily expense', async () => {
    setupMocks(
      100000,
      [], // no transaction history
      [
        { amount: 30000, billing_cycle: 'monthly', is_active: 1 }, // $300/mo = $10/day
      ]
    )
    const result = await generateCashFlowForecast(1)
    // Daily subscription cost = 30000/30 = 1000 centavos/day
    expect(result.dailyBurnRate).toBe(1000)
  })

  it('returns integer values for projected amounts', async () => {
    setupMocks(100050, [
      { type: 'income', avg_daily: 3333 },
      { type: 'expense', avg_daily: 2777 },
    ])
    const result = await generateCashFlowForecast(5)
    for (const point of result.points) {
      expect(Number.isInteger(point.projected)).toBe(true)
      expect(Number.isInteger(point.optimistic)).toBe(true)
      expect(Number.isInteger(point.pessimistic)).toBe(true)
    }
  })
})
