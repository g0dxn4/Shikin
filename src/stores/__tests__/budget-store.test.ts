import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query, execute } from '@/lib/database'
import { useBudgetStore } from '../budget-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('budget-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBudgetStore.setState({ budgets: [], isLoading: false, fetchError: null, error: null })
  })

  it('stores an error message when fetch fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))

    await expect(useBudgetStore.getState().fetch()).rejects.toThrow('DB error')

    expect(useBudgetStore.getState().isLoading).toBe(false)
    expect(useBudgetStore.getState().fetchError).toBe('DB error')
    expect(useBudgetStore.getState().error).toBeNull()
  })

  it('does not reject when fetch after add fails', async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockRejectedValueOnce(new Error('Refresh failed'))

    await expect(
      useBudgetStore.getState().add({
        name: 'Groceries',
        categoryId: 'cat-1',
        amount: 500,
        period: 'monthly',
      })
    ).resolves.toBeUndefined()

    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(useBudgetStore.getState().error).toBeNull()
  })

  it('calculates spent, remaining and percentUsed on successful fetch', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'budget-1',
          name: 'Groceries',
          category_id: 'cat-1',
          amount: 50000,
          period: 'monthly',
          is_active: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          category_name: 'Food',
          category_color: '#ff0000',
        },
      ])
      .mockResolvedValueOnce([{ total: 30000 }])

    await useBudgetStore.getState().fetch()

    const state = useBudgetStore.getState()
    expect(state.budgets).toHaveLength(1)
    expect(state.budgets[0].spent).toBe(30000)
    expect(state.budgets[0].remaining).toBe(20000)
    expect(state.budgets[0].percentUsed).toBe(60)
    expect(state.budgets[0].categoryName).toBe('Food')
    expect(state.fetchError).toBeNull()
  })
})
