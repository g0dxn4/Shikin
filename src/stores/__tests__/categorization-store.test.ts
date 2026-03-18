import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetRules, mockSuggest, mockLearn, mockDelete } = vi.hoisted(() => ({
  mockGetRules: vi.fn(),
  mockSuggest: vi.fn(),
  mockLearn: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('@/lib/auto-categorize', () => ({
  getAutoCategorizationRules: mockGetRules,
  suggestCategory: mockSuggest,
  learnFromTransaction: mockLearn,
  deleteRule: mockDelete,
}))

import { useCategorizationStore } from '../categorization-store'

describe('categorization-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCategorizationStore.setState({ rules: [], isLoading: false })
  })

  describe('loadRules', () => {
    it('fetches category rules from auto-categorize service', async () => {
      const mockRules = [
        {
          id: '01RULE001',
          pattern: 'netflix',
          category_id: '01CAT001',
          subcategory_id: null,
          confidence: 0.95,
          hit_count: 12,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          category_name: 'Entertainment',
          category_color: '#8b5cf6',
        },
      ]
      mockGetRules.mockResolvedValueOnce(mockRules)

      await useCategorizationStore.getState().loadRules()

      expect(mockGetRules).toHaveBeenCalledTimes(1)
      expect(useCategorizationStore.getState().rules).toEqual(mockRules)
    })

    it('sets isLoading during fetch', async () => {
      mockGetRules.mockResolvedValueOnce([])
      const promise = useCategorizationStore.getState().loadRules()
      expect(useCategorizationStore.getState().isLoading).toBe(true)
      await promise
      expect(useCategorizationStore.getState().isLoading).toBe(false)
    })

    it('resets isLoading on error', async () => {
      mockGetRules.mockRejectedValueOnce(new Error('DB error'))

      await expect(useCategorizationStore.getState().loadRules()).rejects.toThrow('DB error')
      expect(useCategorizationStore.getState().isLoading).toBe(false)
    })
  })

  describe('suggestCategory', () => {
    it('returns suggestion with confidence', async () => {
      const suggestion = {
        category_id: '01CAT001',
        subcategory_id: null,
        confidence: 0.95,
        rule_id: '01RULE001',
      }
      mockSuggest.mockResolvedValueOnce(suggestion)

      const result = await useCategorizationStore.getState().suggestCategory('netflix subscription')

      expect(mockSuggest).toHaveBeenCalledWith('netflix subscription')
      expect(result).toEqual(suggestion)
    })

    it('returns null when no match found', async () => {
      mockSuggest.mockResolvedValueOnce(null)

      const result = await useCategorizationStore.getState().suggestCategory('random thing')

      expect(result).toBeNull()
    })
  })

  describe('learnFromTransaction', () => {
    it('calls learn service and refreshes rules', async () => {
      mockLearn.mockResolvedValueOnce(undefined)
      mockGetRules.mockResolvedValueOnce([]) // background refresh

      await useCategorizationStore.getState().learnFromTransaction('netflix', '01CAT001', null)

      expect(mockLearn).toHaveBeenCalledWith('netflix', '01CAT001', null)
    })

    it('passes subcategory to learn service', async () => {
      mockLearn.mockResolvedValueOnce(undefined)
      mockGetRules.mockResolvedValueOnce([])

      await useCategorizationStore
        .getState()
        .learnFromTransaction('grocery store', '01CAT002', '01SUB001')

      expect(mockLearn).toHaveBeenCalledWith('grocery store', '01CAT002', '01SUB001')
    })
  })

  describe('deleteRule', () => {
    it('removes rule from state after deletion', async () => {
      useCategorizationStore.setState({
        rules: [
          {
            id: '01RULE001',
            pattern: 'netflix',
            category_id: '01CAT001',
            subcategory_id: null,
            confidence: 0.95,
            hit_count: 12,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: '01RULE002',
            pattern: 'spotify',
            category_id: '01CAT001',
            subcategory_id: null,
            confidence: 0.9,
            hit_count: 8,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      })

      mockDelete.mockResolvedValueOnce(undefined)

      await useCategorizationStore.getState().deleteRule('01RULE001')

      expect(mockDelete).toHaveBeenCalledWith('01RULE001')
      const rules = useCategorizationStore.getState().rules
      expect(rules).toHaveLength(1)
      expect(rules[0].id).toBe('01RULE002')
    })
  })
})
