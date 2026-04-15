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
})
