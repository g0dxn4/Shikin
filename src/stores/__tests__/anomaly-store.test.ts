import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDetectAnomalies } = vi.hoisted(() => ({
  mockDetectAnomalies: vi.fn(),
}))

vi.mock('@/lib/anomaly-service', () => ({
  detectAnomalies: mockDetectAnomalies,
}))

import { useAnomalyStore } from '../anomaly-store'

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

describe('anomaly-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    useAnomalyStore.setState({ anomalies: [], isLoading: false, lastScanAt: null })
  })

  describe('scanForAnomalies', () => {
    it('populates anomalies array from detector service', async () => {
      const mockAnomalies = [
        {
          id: 'anom1',
          type: 'large_transaction',
          severity: 'high',
          title: 'Large purchase detected',
          description: '$500 at Electronics Store',
          transaction_id: 'tx001',
          amount: 500,
          detected_at: '2026-03-17T00:00:00Z',
          dismissed: false,
        },
        {
          id: 'anom2',
          type: 'duplicate_charge',
          severity: 'medium',
          title: 'Possible duplicate',
          description: 'Two charges at Coffee Shop',
          transaction_id: 'tx002',
          amount: 5.5,
          detected_at: '2026-03-17T00:00:00Z',
          dismissed: false,
        },
      ]
      mockDetectAnomalies.mockResolvedValueOnce(mockAnomalies)

      await useAnomalyStore.getState().scanForAnomalies()

      expect(useAnomalyStore.getState().anomalies).toHaveLength(2)
      expect(useAnomalyStore.getState().lastScanAt).toBeTruthy()
    })

    it('deduplicates anomalies by type+transaction_id', async () => {
      mockDetectAnomalies.mockResolvedValueOnce([
        {
          id: 'anom1',
          type: 'large_transaction',
          severity: 'high',
          title: 'Large purchase',
          description: 'Desc 1',
          transaction_id: 'tx001',
          detected_at: '2026-03-17T00:00:00Z',
          dismissed: false,
        },
        {
          id: 'anom1-dup',
          type: 'large_transaction',
          severity: 'high',
          title: 'Large purchase',
          description: 'Desc 2',
          transaction_id: 'tx001',
          detected_at: '2026-03-17T00:00:00Z',
          dismissed: false,
        },
      ])

      await useAnomalyStore.getState().scanForAnomalies()

      expect(useAnomalyStore.getState().anomalies).toHaveLength(1)
    })

    it('marks previously dismissed anomalies', async () => {
      // Pre-set dismissed IDs in localStorage
      const payload = {
        ids: ['large_transaction:tx001'],
        expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }
      localStorageMock.setItem('valute:dismissed_anomalies', JSON.stringify(payload))

      mockDetectAnomalies.mockResolvedValueOnce([
        {
          id: 'anom1',
          type: 'large_transaction',
          severity: 'high',
          title: 'Large purchase',
          description: 'Desc',
          transaction_id: 'tx001',
          detected_at: '2026-03-17T00:00:00Z',
          dismissed: false,
        },
      ])

      await useAnomalyStore.getState().scanForAnomalies()

      expect(useAnomalyStore.getState().anomalies[0].dismissed).toBe(true)
    })

    it('sets isLoading during scan', async () => {
      mockDetectAnomalies.mockResolvedValueOnce([])
      const promise = useAnomalyStore.getState().scanForAnomalies()
      expect(useAnomalyStore.getState().isLoading).toBe(true)
      await promise
      expect(useAnomalyStore.getState().isLoading).toBe(false)
    })
  })

  describe('dismissAnomaly', () => {
    it('marks anomaly as dismissed and persists to localStorage', () => {
      useAnomalyStore.setState({
        anomalies: [
          {
            id: 'anom1',
            type: 'large_transaction',
            severity: 'high',
            title: 'Large purchase',
            description: 'Desc',
            transaction_id: 'tx001',
            detected_at: '2026-03-17T00:00:00Z',
            dismissed: false,
          },
        ],
      })

      useAnomalyStore.getState().dismissAnomaly('anom1')

      expect(useAnomalyStore.getState().anomalies[0].dismissed).toBe(true)
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'valute:dismissed_anomalies',
        expect.any(String)
      )
    })

    it('does nothing for nonexistent anomaly id', () => {
      useAnomalyStore.setState({ anomalies: [] })

      useAnomalyStore.getState().dismissAnomaly('nonexistent')

      expect(localStorageMock.setItem).not.toHaveBeenCalled()
    })
  })

  describe('getActiveAnomalies', () => {
    it('filters out dismissed anomalies and sorts by severity', () => {
      useAnomalyStore.setState({
        anomalies: [
          {
            id: 'a1',
            type: 'spending_spike',
            severity: 'low',
            title: 'Low',
            description: '',
            detected_at: '',
            dismissed: false,
          },
          {
            id: 'a2',
            type: 'large_transaction',
            severity: 'high',
            title: 'High',
            description: '',
            detected_at: '',
            dismissed: false,
          },
          {
            id: 'a3',
            type: 'duplicate_charge',
            severity: 'medium',
            title: 'Medium',
            description: '',
            detected_at: '',
            dismissed: true,
          },
        ],
      })

      const active = useAnomalyStore.getState().getActiveAnomalies()

      expect(active).toHaveLength(2)
      expect(active[0].severity).toBe('high')
      expect(active[1].severity).toBe('low')
    })

    it('returns empty array when all dismissed', () => {
      useAnomalyStore.setState({
        anomalies: [
          {
            id: 'a1',
            type: 'spending_spike',
            severity: 'low',
            title: 'Low',
            description: '',
            detected_at: '',
            dismissed: true,
          },
        ],
      })

      expect(useAnomalyStore.getState().getActiveAnomalies()).toHaveLength(0)
    })
  })
})
