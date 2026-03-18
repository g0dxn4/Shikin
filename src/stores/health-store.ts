import { create } from 'zustand'
import { calculateHealthScore, type HealthScore } from '@/lib/health-score-service'

const HISTORY_KEY = 'valute-health-score-history'

export interface HealthScoreSnapshot {
  date: string
  score: number
}

interface HealthState {
  score: HealthScore | null
  isLoading: boolean
  error: string | null
  history: HealthScoreSnapshot[]
  calculateScore: () => Promise<void>
  getScoreHistory: () => HealthScoreSnapshot[]
}

function loadHistory(): HealthScoreSnapshot[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(history: HealthScoreSnapshot[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

export const useHealthStore = create<HealthState>((set, get) => ({
  score: null,
  isLoading: false,
  error: null,
  history: loadHistory(),

  calculateScore: async () => {
    set({ isLoading: true, error: null })
    try {
      const score = await calculateHealthScore()
      set({ score })

      // Save monthly snapshot (one per month)
      const history = [...get().history]
      const monthKey = new Date().toISOString().slice(0, 7) // YYYY-MM

      const existingIdx = history.findIndex((h) => h.date.startsWith(monthKey))
      const snapshot: HealthScoreSnapshot = {
        date: new Date().toISOString(),
        score: score.overall,
      }

      if (existingIdx >= 0) {
        history[existingIdx] = snapshot
      } else {
        history.push(snapshot)
      }

      // Keep last 12 months
      const trimmed = history.slice(-12)
      saveHistory(trimmed)
      set({ history: trimmed })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  getScoreHistory: () => {
    return get().history
  },
}))
