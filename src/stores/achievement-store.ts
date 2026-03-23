import { create } from 'zustand'
import {
  checkAchievements,
  computeStreak,
  getAllAchievements,
  dismissAchievement as dismissAchievementService,
  type UnlockedAchievement,
  type AchievementId,
} from '@/lib/achievement-service'

interface AchievementState {
  achievements: UnlockedAchievement[]
  currentStreak: number
  longestStreak: number
  isLoading: boolean
  newlyUnlocked: UnlockedAchievement[]

  /** Load all achievements and streak from shared store + DB scan */
  checkForNew: () => Promise<void>

  /** Get all unlocked achievements */
  getAll: () => UnlockedAchievement[]

  /** Dismiss a new achievement notification */
  dismissNew: (id: AchievementId) => void
}

export const useAchievementStore = create<AchievementState>((set, get) => ({
  achievements: [],
  currentStreak: 0,
  longestStreak: 0,
  isLoading: false,
  newlyUnlocked: [],

  checkForNew: async () => {
    set({ isLoading: true })
    try {
      // Compute streak from DB
      const streak = await computeStreak()

      // Check for newly unlocked achievements
      const newlyUnlocked = await checkAchievements()

      // Load all achievements (including ones just unlocked)
      const achievements = await getAllAchievements()

      set({
        achievements,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        newlyUnlocked: [
          ...get().newlyUnlocked.filter((n) => !n.dismissed),
          ...newlyUnlocked,
        ],
      })
    } finally {
      set({ isLoading: false })
    }
  },

  getAll: () => {
    return get().achievements
  },

  dismissNew: (id: AchievementId) => {
    void dismissAchievementService(id)
    set((state) => ({
      newlyUnlocked: state.newlyUnlocked.filter((a) => a.id !== id),
      achievements: state.achievements.map((a) =>
        a.id === id ? { ...a, dismissed: true } : a
      ),
    }))
  },
}))
