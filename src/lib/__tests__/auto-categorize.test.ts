import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01RULE000000000000000000000'),
}))

import { query, execute } from '@/lib/database'
import {
  suggestCategory,
  learnFromTransaction,
  normalizePattern,
} from '../auto-categorize'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('auto-categorize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('normalizePattern', () => {
    it('lowercases and trims', () => {
      expect(normalizePattern('  WHOLE FOODS  ')).toBe('whole foods')
    })

    it('collapses multiple spaces', () => {
      expect(normalizePattern('coffee   shop')).toBe('coffee shop')
    })

    it('returns empty for whitespace-only input', () => {
      expect(normalizePattern('   ')).toBe('')
    })
  })

  describe('suggestCategory', () => {
    it('returns null for empty description', async () => {
      const result = await suggestCategory('')
      expect(result).toBeNull()
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('returns confidence 1.0 for exact match', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'r1',
          pattern: 'whole foods',
          category_id: 'cat-food',
          subcategory_id: 'sub-grocery',
          confidence: 1.0,
          hit_count: 5,
          created_at: '',
          updated_at: '',
        },
      ])

      const result = await suggestCategory('Whole Foods')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(1.0)
      expect(result!.category_id).toBe('cat-food')
      expect(result!.subcategory_id).toBe('sub-grocery')
      expect(result!.rule_id).toBe('r1')
    })

    it('returns confidence 0.8 for partial match', async () => {
      // No exact match
      mockQuery.mockResolvedValueOnce([])
      // Partial match
      mockQuery.mockResolvedValueOnce([
        {
          id: 'r2',
          pattern: 'starbucks',
          category_id: 'cat-food',
          subcategory_id: null,
          confidence: 1.0,
          hit_count: 3,
          created_at: '',
          updated_at: '',
        },
      ])

      const result = await suggestCategory('Starbucks Coffee #1234')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(0.8)
      expect(result!.category_id).toBe('cat-food')
    })

    it('returns confidence 0.6 for historical match', async () => {
      // No exact match
      mockQuery.mockResolvedValueOnce([])
      // No partial match
      mockQuery.mockResolvedValueOnce([])
      // Historical match
      mockQuery.mockResolvedValueOnce([{ category_id: 'cat-transport', cnt: 10 }])

      const result = await suggestCategory('Uber Trip')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(0.6)
      expect(result!.category_id).toBe('cat-transport')
      expect(result!.subcategory_id).toBeNull()
    })

    it('returns null when no match found', async () => {
      mockQuery.mockResolvedValueOnce([])  // no exact
      mockQuery.mockResolvedValueOnce([])  // no partial
      mockQuery.mockResolvedValueOnce([])  // no historical

      const result = await suggestCategory('Random Unknown Merchant')
      expect(result).toBeNull()
    })
  })

  describe('learnFromTransaction', () => {
    it('creates new rule when none exists', async () => {
      // No existing rule
      mockQuery.mockResolvedValueOnce([])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })

      await learnFromTransaction('Whole Foods', 'cat-food', 'sub-grocery')

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO category_rules'),
        expect.arrayContaining([
          '01RULE000000000000000000000',
          'whole foods',
          'cat-food',
          'sub-grocery',
        ])
      )
    })

    it('increments hit_count when rule already exists', async () => {
      // Existing rule found
      mockQuery.mockResolvedValueOnce([
        {
          id: 'existing-rule',
          pattern: 'whole foods',
          category_id: 'cat-food',
          subcategory_id: null,
          confidence: 1.0,
          hit_count: 3,
          created_at: '',
          updated_at: '',
        },
      ])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })

      await learnFromTransaction('Whole Foods', 'cat-food')

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE category_rules'),
        expect.arrayContaining([null, 'existing-rule'])
      )
    })

    it('does nothing for empty description', async () => {
      await learnFromTransaction('', 'cat-food')
      expect(mockQuery).not.toHaveBeenCalled()
      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('does nothing for empty categoryId', async () => {
      await learnFromTransaction('Store', '')
      expect(mockQuery).not.toHaveBeenCalled()
      expect(mockExecute).not.toHaveBeenCalled()
    })
  })
})
