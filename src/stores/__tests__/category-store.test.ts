import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01NEWCAT000000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { useCategoryStore } from '../category-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

function mockOneCategoryDependency() {
  mockQuery.mockResolvedValueOnce([{ count: 1 }])
  for (let i = 0; i < 6; i += 1) {
    mockQuery.mockResolvedValueOnce([{ count: 0 }])
  }
}

describe('category-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCategoryStore.setState({ categories: [], isLoading: false, error: null, fetchError: null })
  })

  describe('fetch', () => {
    it('stores an error message when fetch fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'))

      await expect(useCategoryStore.getState().fetch()).rejects.toThrow('DB error')

      expect(useCategoryStore.getState().isLoading).toBe(false)
      expect(useCategoryStore.getState().fetchError).toBe('DB error')
    })

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

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC, id ASC'
      )
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

  describe('add', () => {
    it('inserts a new category and refreshes list', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
      mockQuery.mockResolvedValueOnce([])

      await useCategoryStore.getState().add({
        name: 'New Category',
        type: 'expense',
        color: '#ff0000',
        icon: 'tag',
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO categories'),
        expect.arrayContaining([
          '01NEWCAT000000000000000000',
          'New Category',
          'tag',
          '#ff0000',
          'expense',
        ])
      )
      expect(useCategoryStore.getState().isLoading).toBe(false)
    })

    it('surfaces error on insert failure', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Constraint violation'))

      await expect(
        useCategoryStore.getState().add({
          name: 'Bad',
          type: 'expense',
          color: '#000',
          icon: 'tag',
        })
      ).rejects.toThrow('Constraint violation')

      expect(useCategoryStore.getState().error).toBe('Constraint violation')
    })
  })

  describe('update', () => {
    it('updates an existing category and refreshes list', async () => {
      mockQuery.mockResolvedValueOnce([{ type: 'expense' }])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useCategoryStore.getState().update('01CAT001', {
        name: 'Updated',
        type: 'expense',
        color: '#00ff00',
        icon: 'banknote',
      })

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE categories'), [
        'Updated',
        'banknote',
        '#00ff00',
        'expense',
        '01CAT001',
      ])
    })

    it('throws when updating a missing category', async () => {
      mockQuery.mockResolvedValueOnce([])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 })

      await expect(
        useCategoryStore.getState().update('01MISSING', {
          name: 'Updated',
          type: 'income',
          color: '#00ff00',
          icon: 'banknote',
        })
      ).rejects.toThrow('Category not found.')
      expect(useCategoryStore.getState().error).toBe('Category not found.')
    })

    it('surfaces error on update failure', async () => {
      mockQuery.mockResolvedValueOnce([])
      mockExecute.mockRejectedValueOnce(new Error('Not found'))

      await expect(
        useCategoryStore.getState().update('01CAT001', {
          name: 'Updated',
          type: 'income',
          color: '#00ff00',
          icon: 'banknote',
        })
      ).rejects.toThrow('Not found')
    })

    it('blocks type changes when a category has linked data', async () => {
      mockQuery.mockResolvedValueOnce([{ type: 'expense' }])
      mockOneCategoryDependency()

      await expect(
        useCategoryStore.getState().update('01CAT001', {
          name: 'Updated',
          type: 'income',
          color: '#00ff00',
          icon: 'banknote',
        })
      ).rejects.toThrow('Category type cannot be changed while the category is in use.')
      expect(mockExecute).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('deletes a category and refreshes list', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useCategoryStore.getState().remove('01CAT001')

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM categories'), [
        '01CAT001',
        '01CAT001',
        '01CAT001',
        '01CAT001',
        '01CAT001',
        '01CAT001',
        '01CAT001',
        '01CAT001',
      ])
    })

    it('surfaces error on delete failure', async () => {
      mockExecute.mockRejectedValueOnce(new Error('FK constraint'))

      await expect(useCategoryStore.getState().remove('01CAT001')).rejects.toThrow('FK constraint')
    })

    it('blocks delete when a category has linked data', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([{ id: '01CAT001' }])

      await expect(useCategoryStore.getState().remove('01CAT001')).rejects.toThrow(
        'Category cannot be deleted while it is used by existing data.'
      )
      expect(mockExecute).toHaveBeenCalledOnce()
    })

    it('reports not found when deleting a missing category', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await expect(useCategoryStore.getState().remove('01MISSING')).rejects.toThrow(
        'Category not found.'
      )
      expect(useCategoryStore.getState().error).toBe('Category not found.')
    })
  })

  describe('getById', () => {
    it('returns the matching category', () => {
      useCategoryStore.setState({
        categories: [
          {
            id: '01CAT001',
            name: 'Food',
            type: 'expense',
            icon: null,
            color: null,
            sort_order: 1,
            created_at: '',
          },
        ],
      })

      expect(useCategoryStore.getState().getById('01CAT001')?.name).toBe('Food')
      expect(useCategoryStore.getState().getById('missing')).toBeUndefined()
    })
  })
})
