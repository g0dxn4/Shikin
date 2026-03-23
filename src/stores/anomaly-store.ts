import { create } from 'zustand'
import { detectAnomalies, type Anomaly, type AnomalyDetectionOptions } from '@/lib/anomaly-service'
import { load } from '@/lib/storage'

const STORE_KEY_DISMISSED = 'dismissed_anomalies'

async function getDismissedIds(): Promise<Set<string>> {
  try {
    const store = await load()
    const raw = await store.get(STORE_KEY_DISMISSED)
    if (!raw) return new Set()
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { ids: string[]; expiry: number }
    // Auto-expire dismissed list after 30 days
    if (Date.now() > parsed.expiry) {
      await store.set(STORE_KEY_DISMISSED, null)
      return new Set()
    }
    return new Set(parsed.ids)
  } catch {
    return new Set()
  }
}

async function saveDismissedIds(ids: Set<string>): Promise<void> {
  const payload = {
    ids: Array.from(ids),
    expiry: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  }
  const store = await load()
  await store.set(STORE_KEY_DISMISSED, payload)
}

/**
 * Deduplicate anomalies by matching on type + transaction_id (if present)
 * or type + title for non-transaction anomalies.
 */
function deduplicateKey(a: Anomaly): string {
  if (a.transaction_id) return `${a.type}:${a.transaction_id}`
  return `${a.type}:${a.title}`
}

interface AnomalyState {
  anomalies: Anomaly[]
  isLoading: boolean
  lastScanAt: string | null
  scanForAnomalies: (options?: AnomalyDetectionOptions) => Promise<void>
  dismissAnomaly: (id: string) => void
  getActiveAnomalies: () => Anomaly[]
}

export const useAnomalyStore = create<AnomalyState>((set, get) => ({
  anomalies: [],
  isLoading: false,
  lastScanAt: null,

  scanForAnomalies: async (options?: AnomalyDetectionOptions) => {
    set({ isLoading: true })
    try {
      const raw = await detectAnomalies(options)
      const dismissedIds = await getDismissedIds()

      // Deduplicate
      const seen = new Set<string>()
      const deduped: Anomaly[] = []
      for (const anomaly of raw) {
        const key = deduplicateKey(anomaly)
        if (seen.has(key)) continue
        seen.add(key)

        // Check if dismissed by matching key pattern
        if (dismissedIds.has(key)) {
          anomaly.dismissed = true
        }
        deduped.push(anomaly)
      }

      set({ anomalies: deduped, lastScanAt: new Date().toISOString() })
    } finally {
      set({ isLoading: false })
    }
  },

  dismissAnomaly: (id: string) => {
    const { anomalies } = get()
    const target = anomalies.find((a) => a.id === id)
    if (!target) return

    // Persist dismissal by key (not id, since ids regenerate on scan)
    void (async () => {
      const dismissedIds = await getDismissedIds()
      dismissedIds.add(deduplicateKey(target))
      await saveDismissedIds(dismissedIds)
    })()

    set({
      anomalies: anomalies.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    })
  },

  getActiveAnomalies: () => {
    const severityOrder = { high: 0, medium: 1, low: 2 }
    return get()
      .anomalies.filter((a) => !a.dismissed)
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
  },
}))
