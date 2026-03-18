import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCheckAchievements, mockComputeStreak, mockGetAllAchievements, mockDismissAchievement } = vi.hoisted(() => ({
  mockCheckAchievements: vi.fn(),
  mockComputeStreak: vi.fn(),
  mockGetAllAchievements: vi.fn(),
  mockDismissAchievement: vi.fn(),
}))

vi.mock('@/lib/achievement-service', () => ({
  checkAchievements: mockCheckAchievements,
  computeStreak: mockComputeStreak,
  getAllAchievements: mockGetAllAchievements,
  dismissAchievement: mockDismissAchievement,
}))

import { useAchievementStore } from '../achievement-store'

describe('achievement-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAchievementStore.setState({
      achievements: [],
      currentStreak: 0,
      longestStreak: 0,
      isLoading: false,
      newlyUnlocked: [],
    })
  })

  describe('checkForNew', () => {
    it('detects newly unlocked achievements and updates streak', async () => {
      mockComputeStreak.mockResolvedValueOnce({
        currentStreak: 7,
        longestStreak: 14,
        lastLoggedDate: '2026-03-17',
      })
      mockCheckAchievements.mockResolvedValueOnce([
        { id: 'week_warrior', unlockedAt: '2026-03-17T00:00:00Z', dismissed: false },
      ])
      mockGetAllAchievements.mockReturnValueOnce([
        { id: 'first_steps', unlockedAt: '2026-03-10T00:00:00Z', dismissed: false },
        { id: 'week_warrior', unlockedAt: '2026-03-17T00:00:00Z', dismissed: false },
      ])

      await useAchievementStore.getState().checkForNew()

      const state = useAchievementStore.getState()
      expect(state.currentStreak).toBe(7)
      expect(state.longestStreak).toBe(14)
      expect(state.achievements).toHaveLength(2)
      expect(state.newlyUnlocked).toHaveLength(1)
      expect(state.newlyUnlocked[0].id).toBe('week_warrior')
    })

    it('preserves existing undismissed newlyUnlocked entries', async () => {
      useAchievementStore.setState({
        newlyUnlocked: [
          { id: 'first_steps', unlockedAt: '2026-03-10T00:00:00Z', dismissed: false },
        ],
      })

      mockComputeStreak.mockResolvedValueOnce({ currentStreak: 3, longestStreak: 3, lastLoggedDate: null })
      mockCheckAchievements.mockResolvedValueOnce([
        { id: 'savings_star', unlockedAt: '2026-03-17T00:00:00Z', dismissed: false },
      ])
      mockGetAllAchievements.mockReturnValueOnce([])

      await useAchievementStore.getState().checkForNew()

      const newly = useAchievementStore.getState().newlyUnlocked
      expect(newly).toHaveLength(2)
      expect(newly.map((n) => n.id)).toContain('first_steps')
      expect(newly.map((n) => n.id)).toContain('savings_star')
    })

    it('filters out dismissed entries from preserved newlyUnlocked', async () => {
      useAchievementStore.setState({
        newlyUnlocked: [
          { id: 'first_steps', unlockedAt: '2026-03-10T00:00:00Z', dismissed: true },
        ],
      })

      mockComputeStreak.mockResolvedValueOnce({ currentStreak: 1, longestStreak: 1, lastLoggedDate: null })
      mockCheckAchievements.mockResolvedValueOnce([])
      mockGetAllAchievements.mockReturnValueOnce([])

      await useAchievementStore.getState().checkForNew()

      expect(useAchievementStore.getState().newlyUnlocked).toHaveLength(0)
    })

    it('sets isLoading during check', async () => {
      mockComputeStreak.mockResolvedValueOnce({ currentStreak: 0, longestStreak: 0, lastLoggedDate: null })
      mockCheckAchievements.mockResolvedValueOnce([])
      mockGetAllAchievements.mockReturnValueOnce([])

      const promise = useAchievementStore.getState().checkForNew()
      expect(useAchievementStore.getState().isLoading).toBe(true)
      await promise
      expect(useAchievementStore.getState().isLoading).toBe(false)
    })

    it('resets isLoading on error', async () => {
      mockComputeStreak.mockRejectedValueOnce(new Error('DB error'))

      await expect(useAchievementStore.getState().checkForNew()).rejects.toThrow('DB error')
      expect(useAchievementStore.getState().isLoading).toBe(false)
    })
  })

  describe('getAll', () => {
    it('returns all achievements from state', () => {
      const achievements = [
        { id: 'first_steps' as const, unlockedAt: '2026-03-10T00:00:00Z', dismissed: false },
        { id: 'week_warrior' as const, unlockedAt: '2026-03-17T00:00:00Z', dismissed: false },
      ]
      useAchievementStore.setState({ achievements })

      expect(useAchievementStore.getState().getAll()).toEqual(achievements)
    })

    it('returns empty array when none', () => {
      expect(useAchievementStore.getState().getAll()).toEqual([])
    })
  })

  describe('dismissNew', () => {
    it('removes from newlyUnlocked and marks dismissed', () => {
      useAchievementStore.setState({
        achievements: [
          { id: 'first_steps', unlockedAt: '2026-03-10T00:00:00Z', dismissed: false },
          { id: 'week_warrior', unlockedAt: '2026-03-17T00:00:00Z', dismissed: false },
        ],
        newlyUnlocked: [
          { id: 'week_warrior', unlockedAt: '2026-03-17T00:00:00Z', dismissed: false },
        ],
      })

      useAchievementStore.getState().dismissNew('week_warrior')

      expect(mockDismissAchievement).toHaveBeenCalledWith('week_warrior')
      const state = useAchievementStore.getState()
      expect(state.newlyUnlocked).toHaveLength(0)
      const warrior = state.achievements.find((a) => a.id === 'week_warrior')
      expect(warrior!.dismissed).toBe(true)
      // Other achievements remain unchanged
      const firstSteps = state.achievements.find((a) => a.id === 'first_steps')
      expect(firstSteps!.dismissed).toBe(false)
    })
  })
})
