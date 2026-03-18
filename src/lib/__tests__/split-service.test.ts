import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01SPLIT00000000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { createSplits, getSplits, deleteSplits, isSplit } from '../split-service'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('split-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createSplits', () => {
    it('creates splits when amounts sum to total', async () => {
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

      await createSplits('tx1', [
        { categoryId: 'cat1', amount: 3000 },
        { categoryId: 'cat2', amount: 7000 },
      ], 10000)

      // First call: DELETE existing splits, then 2 INSERTs
      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM transaction_splits WHERE transaction_id = ?',
        ['tx1']
      )
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transaction_splits'),
        expect.arrayContaining(['01SPLIT00000000000000000000', 'tx1', 'cat1', null, 3000, null])
      )
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transaction_splits'),
        expect.arrayContaining(['01SPLIT00000000000000000000', 'tx1', 'cat2', null, 7000, null])
      )
    })

    it('throws when split amounts do not sum to total', async () => {
      await expect(
        createSplits('tx1', [
          { categoryId: 'cat1', amount: 3000 },
          { categoryId: 'cat2', amount: 5000 },
        ], 10000)
      ).rejects.toThrow('Split amounts (8000) must equal transaction total (10000)')
    })

    it('passes subcategoryId and notes when provided', async () => {
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

      await createSplits('tx1', [
        { categoryId: 'cat1', subcategoryId: 'sub1', amount: 5000, notes: 'Half' },
        { categoryId: 'cat2', amount: 5000 },
      ], 10000)

      const insertCalls = mockExecute.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT')
      )
      expect(insertCalls[0][1]).toContain('sub1')
      expect(insertCalls[0][1]).toContain('Half')
    })

    it('deletes existing splits before creating new ones', async () => {
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

      await createSplits('tx1', [
        { categoryId: 'cat1', amount: 10000 },
      ], 10000)

      // Delete should be called first
      expect(mockExecute.mock.calls[0][0]).toContain('DELETE FROM transaction_splits')
    })
  })

  describe('getSplits', () => {
    it('returns splits with joined category names', async () => {
      const mockSplits = [
        {
          id: 's1',
          transaction_id: 'tx1',
          category_id: 'cat1',
          subcategory_id: null,
          amount: 5000,
          notes: null,
          created_at: '',
          category_name: 'Food',
          category_color: '#f00',
          subcategory_name: null,
        },
      ]
      mockQuery.mockResolvedValueOnce(mockSplits)

      const result = await getSplits('tx1')
      expect(result).toEqual(mockSplits)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN categories'),
        ['tx1']
      )
    })

    it('returns empty array when no splits exist', async () => {
      mockQuery.mockResolvedValueOnce([])
      const result = await getSplits('tx-none')
      expect(result).toEqual([])
    })
  })

  describe('deleteSplits', () => {
    it('removes all splits for a transaction', async () => {
      mockExecute.mockResolvedValue({ rowsAffected: 2, lastInsertId: 0 })
      await deleteSplits('tx1')
      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM transaction_splits WHERE transaction_id = ?',
        ['tx1']
      )
    })
  })

  describe('isSplit', () => {
    it('returns true when splits exist', async () => {
      mockQuery.mockResolvedValueOnce([{ count: 3 }])
      const result = await isSplit('tx1')
      expect(result).toBe(true)
    })

    it('returns false when no splits exist', async () => {
      mockQuery.mockResolvedValueOnce([{ count: 0 }])
      const result = await isSplit('tx1')
      expect(result).toBe(false)
    })

    it('returns false when query returns empty', async () => {
      mockQuery.mockResolvedValueOnce([])
      const result = await isSplit('tx1')
      expect(result).toBe(false)
    })
  })
})
