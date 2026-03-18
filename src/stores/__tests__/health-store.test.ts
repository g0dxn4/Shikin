import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCalculateHealthScore } = vi.hoisted(() => ({
  mockCalculateHealthScore: vi.fn(),
}))

vi.mock('@/lib/health-score-service', () => ({
  calculateHealthScore: mockCalculateHealthScore,
}))

import { useHealthStore } from '../health-store'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

const mockScore = {
  overall: 78,
  grade: 'B' as const,
  subscores: [
    { name: 'Savings', score: 80, weight: 0.3, description: 'Savings rate', tip: 'Save more' },
    { name: 'Spending', score: 70, weight: 0.25, description: 'Spending patterns', tip: 'Track spending' },
    { name: 'Debt', score: 90, weight: 0.2, description: 'Debt management', tip: 'Keep it up' },
    { name: 'Budget', score: 65, weight: 0.15, description: 'Budget adherence', tip: 'Stick to budget' },
    { name: 'Goals', score: 75, weight: 0.1, description: 'Goal progress', tip: 'Stay focused' },
  ],
  trend: 'improving' as const,
  tips: ['Save more', 'Track spending'],
  calculatedAt: '2026-03-17T00:00:00Z',
}

describe('health-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    useHealthStore.setState({ score: null, isLoading: false, history: [] })
  })

  describe('calculateScore', () => {
    it('sets score object with overall, grade, subscores, and tips', async () => {
      mockCalculateHealthScore.mockResolvedValueOnce(mockScore)

      await useHealthStore.getState().calculateScore()

      const state = useHealthStore.getState()
      expect(state.score).toEqual(mockScore)
      expect(state.score!.overall).toBe(78)
      expect(state.score!.grade).toBe('B')
      expect(state.score!.subscores).toHaveLength(5)
      expect(state.score!.tips).toContain('Save more')
    })

    it('saves monthly snapshot to history', async () => {
      mockCalculateHealthScore.mockResolvedValueOnce(mockScore)

      await useHealthStore.getState().calculateScore()

      const history = useHealthStore.getState().history
      expect(history).toHaveLength(1)
      expect(history[0].score).toBe(78)
      expect(history[0].date).toBeTruthy()
    })

    it('updates existing snapshot for same month', async () => {
      const existingHistory = [
        { date: new Date().toISOString(), score: 70 },
      ]
      useHealthStore.setState({ history: existingHistory })

      const updatedScore = { ...mockScore, overall: 82 }
      mockCalculateHealthScore.mockResolvedValueOnce(updatedScore)

      await useHealthStore.getState().calculateScore()

      const history = useHealthStore.getState().history
      expect(history).toHaveLength(1)
      expect(history[0].score).toBe(82)
    })

    it('persists history to localStorage', async () => {
      mockCalculateHealthScore.mockResolvedValueOnce(mockScore)

      await useHealthStore.getState().calculateScore()

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'valute-health-score-history',
        expect.any(String)
      )
    })

    it('keeps only last 12 months of history', async () => {
      const oldHistory = Array.from({ length: 15 }, (_, i) => ({
        date: `2025-${String(i + 1).padStart(2, '0')}-01T00:00:00Z`,
        score: 70 + i,
      }))
      useHealthStore.setState({ history: oldHistory })

      mockCalculateHealthScore.mockResolvedValueOnce(mockScore)

      await useHealthStore.getState().calculateScore()

      expect(useHealthStore.getState().history.length).toBeLessThanOrEqual(12)
    })

    it('sets isLoading during calculation', async () => {
      mockCalculateHealthScore.mockResolvedValueOnce(mockScore)

      const promise = useHealthStore.getState().calculateScore()
      expect(useHealthStore.getState().isLoading).toBe(true)
      await promise
      expect(useHealthStore.getState().isLoading).toBe(false)
    })

    it('resets isLoading on error', async () => {
      mockCalculateHealthScore.mockRejectedValueOnce(new Error('fail'))

      await expect(useHealthStore.getState().calculateScore()).rejects.toThrow('fail')
      expect(useHealthStore.getState().isLoading).toBe(false)
    })
  })

  describe('getScoreHistory', () => {
    it('returns current history', () => {
      const history = [
        { date: '2026-01-15T00:00:00Z', score: 72 },
        { date: '2026-02-15T00:00:00Z', score: 75 },
      ]
      useHealthStore.setState({ history })

      expect(useHealthStore.getState().getScoreHistory()).toEqual(history)
    })

    it('returns empty array when no history', () => {
      expect(useHealthStore.getState().getScoreHistory()).toEqual([])
    })
  })
})
