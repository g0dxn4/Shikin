import { describe, it, expect, vi, beforeEach } from 'vitest'
import dayjs from 'dayjs'

const mockStore = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
    set: vi.fn(async (key: string, value: unknown) => { data[key] = value }),
    save: vi.fn(async () => {}),
    _data: data,
    _clear: () => { Object.keys(data).forEach((k) => delete data[k]) },
  }
})

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue(mockStore),
}))

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query } from '@/lib/database'
import {
  ACHIEVEMENTS,
  computeStreak,
  checkAchievements,
  getAllAchievements,
  dismissAchievement,
} from '../achievement-service'

const mockQuery = vi.mocked(query)

describe('achievement-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore._clear()
  })

  describe('ACHIEVEMENTS', () => {
    it('has all 8 achievement definitions', () => {
      const ids = Object.keys(ACHIEVEMENTS)
      expect(ids).toHaveLength(8)
      expect(ids).toContain('first_steps')
      expect(ids).toContain('week_warrior')
      expect(ids).toContain('budget_boss')
      expect(ids).toContain('savings_star')
      expect(ids).toContain('century_club')
      expect(ids).toContain('diversified')
      expect(ids).toContain('debt_destroyer')
      expect(ids).toContain('goal_getter')
    })

    it('each achievement has required fields', () => {
      for (const def of Object.values(ACHIEVEMENTS)) {
        expect(def).toHaveProperty('id')
        expect(def).toHaveProperty('icon')
        expect(def).toHaveProperty('tier')
        expect(['bronze', 'silver', 'gold']).toContain(def.tier)
      }
    })
  })

  describe('computeStreak', () => {
    it('returns zero streak when no transactions exist', async () => {
      mockQuery.mockResolvedValueOnce([])
      const streak = await computeStreak()
      expect(streak.currentStreak).toBe(0)
      expect(streak.longestStreak).toBe(0)
      expect(streak.lastLoggedDate).toBeNull()
    })

    it('calculates consecutive day streak', async () => {
      const today = dayjs().format('YYYY-MM-DD')
      const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      const twoDaysAgo = dayjs().subtract(2, 'day').format('YYYY-MM-DD')

      mockQuery.mockResolvedValueOnce([
        { d: today },
        { d: yesterday },
        { d: twoDaysAgo },
      ])

      const streak = await computeStreak()
      expect(streak.currentStreak).toBe(3)
      expect(streak.longestStreak).toBe(3)
      expect(streak.lastLoggedDate).toBe(today)
    })

    it('streak is active if yesterday was last day', async () => {
      const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      const twoDaysAgo = dayjs().subtract(2, 'day').format('YYYY-MM-DD')

      mockQuery.mockResolvedValueOnce([
        { d: yesterday },
        { d: twoDaysAgo },
      ])

      const streak = await computeStreak()
      expect(streak.currentStreak).toBe(2)
    })

    it('breaks streak on gap', async () => {
      const today = dayjs().format('YYYY-MM-DD')
      const threeDaysAgo = dayjs().subtract(3, 'day').format('YYYY-MM-DD')
      const fourDaysAgo = dayjs().subtract(4, 'day').format('YYYY-MM-DD')

      mockQuery.mockResolvedValueOnce([
        { d: today },
        { d: threeDaysAgo },
        { d: fourDaysAgo },
      ])

      const streak = await computeStreak()
      expect(streak.currentStreak).toBe(1) // only today
      expect(streak.longestStreak).toBe(2) // threeDaysAgo + fourDaysAgo
    })

    it('saves streak data to shared store', async () => {
      mockQuery.mockResolvedValueOnce([])
      await computeStreak()
      expect(mockStore.set).toHaveBeenCalledWith(
        'streak',
        expect.objectContaining({ currentStreak: 0, longestStreak: 0 })
      )
    })
  })

  describe('checkAchievements', () => {
    it('returns newly unlocked first_steps when >= 1 transaction', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        if (s === 'SELECT COUNT(*) as cnt FROM transactions') {
          return [{ cnt: 5 }]
        }
        if (s.includes('DISTINCT date(date)')) {
          return []
        }
        if (s.includes('FROM budgets')) {
          return []
        }
        if (s.includes("type = 'income'")) {
          return [{ total: 0 }]
        }
        if (s.includes("type = 'expense'")) {
          return [{ total: 0 }]
        }
        if (s.includes('DISTINCT category_id')) {
          return [{ cnt: 0 }]
        }
        if (s.includes("type = 'credit_card'")) {
          return [{ cnt: 0 }]
        }
        if (s.includes("type = 'savings'")) {
          return [{ cnt: 0 }]
        }
        return [{ cnt: 0, total: 0 }]
      })

      const result = await checkAchievements()
      const ids = result.map((a) => a.id)
      expect(ids).toContain('first_steps')
    })

    it('skips already unlocked achievements', async () => {
      mockStore._data['achievements'] = [
        { id: 'first_steps', unlockedAt: '2024-01-01T00:00:00Z', dismissed: false },
      ]

      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        if (s === 'SELECT COUNT(*) as cnt FROM transactions') {
          return [{ cnt: 5 }]
        }
        if (s.includes('DISTINCT date(date)')) {
          return []
        }
        if (s.includes('FROM budgets')) {
          return []
        }
        return [{ cnt: 0, total: 0 }]
      })

      const result = await checkAchievements()
      const ids = result.map((a) => a.id)
      expect(ids).not.toContain('first_steps')
    })

    it('saves newly unlocked achievements to shared store', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        if (s === 'SELECT COUNT(*) as cnt FROM transactions') {
          return [{ cnt: 1 }]
        }
        if (s.includes('DISTINCT date(date)')) {
          return []
        }
        if (s.includes('FROM budgets')) {
          return []
        }
        return [{ cnt: 0, total: 0 }]
      })

      await checkAchievements()
      const stored = mockStore._data['achievements'] as unknown[]
      expect(stored).toBeDefined()
      expect(stored.length).toBeGreaterThan(0)
      expect((stored[0] as { id: string }).id).toBe('first_steps')
    })

    it('newly unlocked achievements have correct shape', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        if (s === 'SELECT COUNT(*) as cnt FROM transactions') {
          return [{ cnt: 100 }] // unlocks first_steps and century_club
        }
        if (s.includes('DISTINCT date(date)')) {
          return []
        }
        if (s.includes('FROM budgets')) {
          return []
        }
        return [{ cnt: 0, total: 0 }]
      })

      const result = await checkAchievements()
      for (const a of result) {
        expect(a).toHaveProperty('id')
        expect(a).toHaveProperty('unlockedAt')
        expect(a).toHaveProperty('dismissed')
        expect(a.dismissed).toBe(false)
      }
    })
  })

  describe('getAllAchievements', () => {
    it('returns empty array when nothing unlocked', async () => {
      const result = await getAllAchievements()
      expect(result).toEqual([])
    })

    it('returns stored achievements', async () => {
      mockStore._data['achievements'] = [
        { id: 'first_steps', unlockedAt: '2024-01-01T00:00:00Z', dismissed: false },
      ]
      const result = await getAllAchievements()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('first_steps')
    })

    it('returns empty on invalid JSON', async () => {
      mockStore._data['achievements'] = 'invalid json'
      const result = await getAllAchievements()
      expect(result).toEqual([])
    })
  })

  describe('dismissAchievement', () => {
    it('marks achievement as dismissed', async () => {
      mockStore._data['achievements'] = [
        { id: 'first_steps', unlockedAt: '2024-01-01T00:00:00Z', dismissed: false },
      ]

      await dismissAchievement('first_steps')

      const stored = mockStore._data['achievements'] as { id: string; dismissed: boolean }[]
      expect(stored[0].dismissed).toBe(true)
    })
  })
})
