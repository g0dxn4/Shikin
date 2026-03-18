import { create } from 'zustand'
import {
  generateWeeklyRecap,
  generateMonthlyRecap,
  loadRecapHistory,
  loadLatestRecap,
} from '@/lib/recap-service'
import type { Recap } from '@/lib/recap-service'

interface RecapState {
  currentRecap: Recap | null
  recapHistory: Recap[]
  isLoading: boolean
  error: string | null

  /** Generate a new weekly recap for the past 7 days */
  generateWeekly: () => Promise<void>

  /** Generate a new monthly recap (optional month as ISO date) */
  generateMonthly: (month?: string) => Promise<void>

  /** Load recap history from database */
  loadHistory: () => Promise<void>

  /** Load the latest weekly recap (if any) without generating a new one */
  loadLatestWeekly: () => Promise<void>
}

export const useRecapStore = create<RecapState>((set) => ({
  currentRecap: null,
  recapHistory: [],
  isLoading: false,
  error: null,

  generateWeekly: async () => {
    set({ isLoading: true, error: null })
    try {
      const recap = await generateWeeklyRecap()
      set((state) => ({
        currentRecap: recap,
        recapHistory: [recap, ...state.recapHistory],
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  generateMonthly: async (month?: string) => {
    set({ isLoading: true, error: null })
    try {
      const recap = await generateMonthlyRecap(month)
      set((state) => ({
        currentRecap: recap,
        recapHistory: [recap, ...state.recapHistory],
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  loadHistory: async () => {
    set({ isLoading: true, error: null })
    try {
      const history = await loadRecapHistory()
      set({ recapHistory: history })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  loadLatestWeekly: async () => {
    try {
      const recap = await loadLatestRecap('weekly')
      if (recap) {
        set({ currentRecap: recap })
      }
    } catch {
      // Silently fail — table may not exist yet
    }
  },
}))
