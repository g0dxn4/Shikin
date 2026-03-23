import { create } from 'zustand'
import { calculateHealthScore, type HealthScore } from '@/lib/health-score-service'
import { load } from '@/lib/storage'

const STORE_KEY_HISTORY = 'health_score_history'

export interface HealthScoreSnapshot {
  date: string
  score: number
}

interface HealthState {
  score: HealthScore | null
  isLoading: boolean
  error: string | null
  history: HealthScoreSnapshot[]
  _historyLoaded: boolean
  calculateScore: () => Promise<void>
  getScoreHistory: () => HealthScoreSnapshot[]
}

async function loadHistory(): Promise<HealthScoreSnapshot[]> {
  try {
    const store = await load()
    const raw = await store.get(STORE_KEY_HISTORY)
    if (!raw) return []
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as HealthScoreSnapshot[])
  } catch {
    return []
  }
}

async function saveHistory(history: HealthScoreSnapshot[]): Promise<void> {
  const store = await load()
  await store.set(STORE_KEY_HISTORY, history)
}

export const useHealthStore = create<HealthState>((set, get) => ({
  score: null,
  isLoading: false,
  error: null,
  history: [],
  _historyLoaded: false,

  calculateScore: async () => {
    set({ isLoading: true, error: null })
    try {
      // Ensure history is loaded from store before first calculation
      if (!get()._historyLoaded) {
        const loaded = await loadHistory()
        set({ history: loaded, _historyLoaded: true })
      }

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
      await saveHistory(trimmed)
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
