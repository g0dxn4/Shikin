import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query } from '@/lib/database'
import { getBalanceOverview } from '../tools/get-balance-overview'
import { analyzeSpendingTrends } from '../tools/analyze-spending-trends'

const mockQuery = vi.mocked(query)
const toolCtx = { toolCallId: 'test', messages: [] }

describe('getBalanceOverview tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes total balance, per-account breakdown, and monthly change', async () => {
    // Active accounts
    mockQuery.mockResolvedValueOnce([
      { id: 'acc1', name: 'Checking', type: 'checking', currency: 'USD', balance: 150000, is_archived: 0 },
      { id: 'acc2', name: 'Savings', type: 'savings', currency: 'USD', balance: 500000, is_archived: 0 },
    ])
    // Current month totals
    mockQuery.mockResolvedValueOnce([{ total_income: 300000, total_expenses: 200000 }])
    // Previous month totals
    mockQuery.mockResolvedValueOnce([{ total_income: 250000, total_expenses: 180000 }])

    const result = (await getBalanceOverview.execute!(
      {},
      toolCtx
    )) as {
      totalBalance: number
      accounts: Array<Record<string, unknown>>
      monthlyChange: { current: number; previous: number; trend: string }
      message: string
    }

    expect(result.totalBalance).toBe(6500) // (150000 + 500000) / 100
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0].balance).toBe(1500)
    expect(result.accounts[1].balance).toBe(5000)
    // Current net: 300000 - 200000 = 100000 = $1000
    // Previous net: 250000 - 180000 = 70000 = $700
    expect(result.monthlyChange.current).toBe(1000)
    expect(result.monthlyChange.previous).toBe(700)
    expect(result.monthlyChange.trend).toBe('up')
  })

  it('handles no accounts', async () => {
    mockQuery.mockResolvedValueOnce([]) // no accounts
    mockQuery.mockResolvedValueOnce([{ total_income: 0, total_expenses: 0 }])
    mockQuery.mockResolvedValueOnce([{ total_income: 0, total_expenses: 0 }])

    const result = (await getBalanceOverview.execute!(
      {},
      toolCtx
    )) as { totalBalance: number; accounts: Array<Record<string, unknown>>; message: string }

    expect(result.totalBalance).toBe(0)
    expect(result.accounts).toHaveLength(0)
    expect(result.message).toContain('No accounts found')
  })
})

describe('analyzeSpendingTrends tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes per-month breakdown with trends', async () => {
    // Per-month per-category breakdown
    mockQuery.mockResolvedValueOnce([
      { month: '2024-01', category_name: 'Food', total: 15000 },
      { month: '2024-01', category_name: 'Transport', total: 5000 },
      { month: '2024-02', category_name: 'Food', total: 20000 },
      { month: '2024-02', category_name: 'Transport', total: 3000 },
    ])
    // Per-month aggregates
    mockQuery.mockResolvedValueOnce([
      { month: '2024-01', total_expenses: 20000, total_income: 300000 },
      { month: '2024-02', total_expenses: 23000, total_income: 300000 },
    ])

    const result = (await analyzeSpendingTrends.execute!(
      { months: 3 },
      toolCtx
    )) as {
      months: Array<{ month: string; totalExpenses: number; totalIncome: number; topCategories: Array<Record<string, unknown>> }>
      trends: Array<{ category: string; direction: string; changePercent: number }>
      message: string
    }

    expect(result.months).toHaveLength(2)
    expect(result.months[0].totalExpenses).toBe(200) // 20000/100
    expect(result.months[0].totalIncome).toBe(3000)
    expect(result.months[0].topCategories).toHaveLength(2)

    // Food: 20000 vs 15000 = +33% (up)
    // Transport: 3000 vs 5000 = -40% (down)
    expect(result.trends.length).toBeGreaterThan(0)
    const foodTrend = result.trends.find((t) => t.category === 'Food')
    expect(foodTrend).toBeDefined()
    expect(foodTrend!.direction).toBe('up')
    expect(foodTrend!.changePercent).toBe(33)

    const transportTrend = result.trends.find((t) => t.category === 'Transport')
    expect(transportTrend).toBeDefined()
    expect(transportTrend!.direction).toBe('down')
    expect(transportTrend!.changePercent).toBe(40)
  })

  it('handles no data', async () => {
    mockQuery.mockResolvedValueOnce([]) // no breakdown
    mockQuery.mockResolvedValueOnce([]) // no aggregates

    const result = (await analyzeSpendingTrends.execute!(
      { months: 3 },
      toolCtx
    )) as { months: Array<Record<string, unknown>>; trends: Array<Record<string, unknown>>; message: string }

    expect(result.months).toHaveLength(0)
    expect(result.trends).toHaveLength(0)
    expect(result.message).toContain('No transaction data')
  })
})
