import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TEST000000000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { updateTransaction } from '../tools/update-transaction'
import { deleteTransaction } from '../tools/delete-transaction'
import { queryTransactions } from '../tools/query-transactions'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)
const toolCtx = { toolCallId: 'test', messages: [] }

describe('updateTransaction tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reverses old balance, applies new, and returns updated transaction', async () => {
    // Fetch existing transaction
    mockQuery.mockResolvedValueOnce([
      {
        id: 'tx1',
        account_id: 'acc1',
        category_id: 'cat1',
        type: 'expense',
        amount: 2500, // $25.00
        description: 'Lunch',
        notes: null,
        date: '2024-01-15',
      },
    ])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await updateTransaction.execute!(
      { transactionId: 'tx1', amount: 30, description: 'Dinner' },
      toolCtx
    )) as Record<string, unknown>

    expect(result.success).toBe(true)
    expect(result.transaction).toMatchObject({
      id: 'tx1',
      amount: 30,
      type: 'expense',
      description: 'Dinner',
    })
    // 3 execute calls: reverse old balance, apply new balance, update tx
    expect(mockExecute).toHaveBeenCalledTimes(3)
  })

  it('returns error for nonexistent transaction', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = (await updateTransaction.execute!(
      { transactionId: 'nonexistent' },
      toolCtx
    )) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
  })

  it('resolves category by name when provided', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'tx1',
          account_id: 'acc1',
          category_id: 'cat1',
          type: 'expense',
          amount: 1000,
          description: 'Test',
          notes: null,
          date: '2024-01-15',
        },
      ])
      .mockResolvedValueOnce([{ id: 'cat-food' }]) // category lookup
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await updateTransaction.execute!(
      { transactionId: 'tx1', category: 'Food' },
      toolCtx
    )) as Record<string, unknown>

    expect(result.success).toBe(true)
    // Category query should have been called
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})

describe('deleteTransaction tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reverses balance, deletes, and returns success', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'tx1',
        account_id: 'acc1',
        type: 'expense',
        amount: 5000, // $50.00
        description: 'Groceries',
        date: '2024-01-15',
      },
    ])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await deleteTransaction.execute!(
      { transactionId: 'tx1' },
      toolCtx
    )) as Record<string, unknown>

    expect(result.success).toBe(true)
    expect(result.message).toContain('$50.00')
    expect(result.message).toContain('Groceries')
    // 2 execute calls: reverse balance + delete
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('returns error for nonexistent transaction', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = (await deleteTransaction.execute!(
      { transactionId: 'nonexistent' },
      toolCtx
    )) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
  })
})

describe('queryTransactions tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns recent transactions with no filters', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'tx1',
          description: 'Coffee',
          amount: 450,
          type: 'expense',
          category_name: 'Food',
          account_name: 'Checking',
          date: '2024-01-15',
          notes: null,
        },
      ])
      .mockResolvedValueOnce([{ count: 1 }])

    const result = (await queryTransactions.execute!(
      { limit: 20 },
      toolCtx
    )) as { transactions: Array<Record<string, unknown>>; count: number; totalMatched: number }

    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].amount).toBe(4.5) // fromCentavos
    expect(result.count).toBe(1)
    expect(result.totalMatched).toBe(1)
  })

  it('filters by type and date range', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])

    const result = (await queryTransactions.execute!(
      {
        type: 'income',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        limit: 20,
      },
      toolCtx
    )) as { transactions: Array<Record<string, unknown>>; message: string }

    expect(result.transactions).toHaveLength(0)
    expect(result.message).toContain('No transactions found')
    // Verify the query included type and date filters
    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[0]).toContain('t.type =')
    expect(queryCall[0]).toContain('t.date >=')
    expect(queryCall[0]).toContain('t.date <=')
  })

  it('searches by description LIKE', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'tx1',
          description: 'Morning Coffee',
          amount: 350,
          type: 'expense',
          category_name: 'Food',
          account_name: 'Checking',
          date: '2024-01-15',
          notes: null,
        },
      ])
      .mockResolvedValueOnce([{ count: 1 }])

    const result = (await queryTransactions.execute!(
      { search: 'Coffee', limit: 20 },
      toolCtx
    )) as { transactions: Array<Record<string, unknown>> }

    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].description).toBe('Morning Coffee')
    // Verify LIKE was used
    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[0]).toContain('LIKE')
    expect(queryCall[1]).toContain('%Coffee%')
  })
})
