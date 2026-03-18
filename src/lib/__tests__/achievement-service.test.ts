import { describe, it, expect, vi, beforeEach } from 'vitest'
import dayjs from 'dayjs'

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
    localStorage.clear()
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

    it('saves streak data to localStorage', async () => {
      mockQuery.mockResolvedValueOnce([])
      await computeStreak()
      const stored = localStorage.getItem('valute:streak')
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed).toHaveProperty('currentStreak')
      expect(parsed).toHaveProperty('longestStreak')
    })
  })

  describe('checkAchievements', () => {
    it('returns newly unlocked first_steps when >= 1 transaction', async () => {
      // checkAchievements iterates CHECKERS in order:
      // first_steps, week_warrior, budget_boss, savings_star, century_club, diversified, debt_destroyer, goal_getter
      // Each checker may call query multiple times
      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        // first_steps: count transactions
        if (s === 'SELECT COUNT(*) as cnt FROM transactions') {
          return [{ cnt: 5 }]
        }
        // week_warrior -> computeStreak: distinct dates
        if (s.includes('DISTINCT date(date)')) {
          return []
        }
        // budget_boss: budgets
        if (s.includes('FROM budgets')) {
          return []
        }
        // savings_star: income/expenses
        if (s.includes("type = 'income'")) {
          return [{ total: 0 }]
        }
        if (s.includes("type = 'expense'")) {
          return [{ total: 0 }]
        }
        // diversified: distinct categories
        if (s.includes('DISTINCT category_id')) {
          return [{ cnt: 0 }]
        }
        // debt_destroyer: credit cards
        if (s.includes("type = 'credit_card'")) {
          return [{ cnt: 0 }]
        }
        // goal_getter: savings accounts
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
      localStorage.setItem(
        'valute:achievements',
        JSON.stringify([
          { id: 'first_steps', unlockedAt: '2024-01-01T00:00:00Z', dismissed: false },
        ])
      )

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

    it('saves newly unlocked achievements to localStorage', async () => {
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
      const stored = JSON.parse(localStorage.getItem('valute:achievements') ?? '[]')
      expect(stored.length).toBeGreaterThan(0)
      expect(stored[0].id).toBe('first_steps')
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
    it('returns empty array when nothing unlocked', () => {
      const result = getAllAchievements()
      expect(result).toEqual([])
    })

    it('returns stored achievements', () => {
      localStorage.setItem(
        'valute:achievements',
        JSON.stringify([
          { id: 'first_steps', unlockedAt: '2024-01-01T00:00:00Z', dismissed: false },
        ])
      )
      const result = getAllAchievements()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('first_steps')
    })

    it('returns empty on invalid JSON', () => {
      localStorage.setItem('valute:achievements', 'invalid json')
      const result = getAllAchievements()
      expect(result).toEqual([])
    })
  })

  describe('dismissAchievement', () => {
    it('marks achievement as dismissed', () => {
      localStorage.setItem(
        'valute:achievements',
        JSON.stringify([
          { id: 'first_steps', unlockedAt: '2024-01-01T00:00:00Z', dismissed: false },
        ])
      )

      dismissAchievement('first_steps')

      const stored = JSON.parse(localStorage.getItem('valute:achievements')!)
      expect(stored[0].dismissed).toBe(true)
    })
  })
})
