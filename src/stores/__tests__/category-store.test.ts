import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
}))

import { query } from '@/lib/database'
import { useCategoryStore } from '../category-store'

const mockQuery = vi.mocked(query)

describe('category-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCategoryStore.setState({ categories: [], isLoading: false })
  })

  describe('fetch', () => {
    it('loads categories ordered by sort_order', async () => {
      const mockCategories = [
        {
          id: '01CAT001',
          name: 'Food & Dining',
          icon: 'utensils',
          color: '#f97316',
          type: 'expense',
          sort_order: 1,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: '01CAT002',
          name: 'Salary',
          icon: 'banknote',
          color: '#22c55e',
          type: 'income',
          sort_order: 11,
          created_at: '2024-01-01T00:00:00Z',
        },
      ]
      mockQuery.mockResolvedValueOnce(mockCategories)

      await useCategoryStore.getState().fetch()

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM categories ORDER BY sort_order ASC')
      expect(useCategoryStore.getState().categories).toEqual(mockCategories)
      expect(useCategoryStore.getState().isLoading).toBe(false)
    })

    it('sets isLoading during fetch', async () => {
      mockQuery.mockImplementation(
        () =>
          new Promise((resolve) => {
            expect(useCategoryStore.getState().isLoading).toBe(true)
            resolve([])
          })
      )

      await useCategoryStore.getState().fetch()
      expect(useCategoryStore.getState().isLoading).toBe(false)
    })
  })
})
