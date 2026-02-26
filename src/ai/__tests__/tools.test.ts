import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock database before importing tools
vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TEST000000000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { addTransaction } from '../tools/add-transaction'
import { getSpendingSummary } from '../tools/get-spending-summary'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('addTransaction tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct description', () => {
    expect(addTransaction.description).toContain('transaction')
  })

  it('creates a transaction when account exists', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: '01CAT0000000000000000000000' }]) // category lookup
      .mockResolvedValueOnce([{ id: '01ACC0000000000000000000000' }]) // account lookup
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await addTransaction.execute!(
      {
        amount: 25.5,
        type: 'expense',
        description: 'Lunch',
        category: 'Food',
        date: '2024-01-15',
      },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: true,
      transaction: {
        amount: 25.5,
        type: 'expense',
        description: 'Lunch',
      },
    })
    expect(mockExecute).toHaveBeenCalledTimes(2) // insert + balance update
  })

  it('returns error when no accounts exist', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // category lookup
      .mockResolvedValueOnce([]) // no accounts

    const result = (await addTransaction.execute!(
      {
        amount: 10,
        type: 'expense',
        description: 'Test',
      },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('No accounts found'),
    })
  })
})

describe('getSpendingSummary tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct description', () => {
    expect(getSpendingSummary.description).toContain('spending')
  })

  it('returns empty summary when no transactions', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // spending query
      .mockResolvedValueOnce([{ total: 0 }]) // income query

    const result = (await getSpendingSummary.execute!(
      { period: 'month' },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      totalExpenses: 0,
      totalIncome: 0,
      byCategory: [],
    })
  })

  it('calculates spending by category', async () => {
    mockQuery.mockReset()
    let callCount = 0
    mockQuery.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return [
          { category_name: 'Food', total: 5000, count: 3 },
          { category_name: 'Transport', total: 2000, count: 2 },
        ]
      }
      return [{ total: 10000 }]
    })

    const result = (await getSpendingSummary.execute!(
      { period: 'month' },
      { toolCallId: 'test', messages: [] }
    )) as { totalExpenses: number; totalIncome: number; byCategory: Array<Record<string, unknown>> }

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(result.totalExpenses).toBe(70) // 7000 centavos = $70
    expect(result.totalIncome).toBe(100) // 10000 centavos = $100
    expect(result.byCategory).toHaveLength(2)
    expect(result.byCategory[0]).toMatchObject({
      category: 'Food',
      amount: 50,
      percentage: 71,
    })
  })
})
