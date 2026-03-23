import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { mockDetectAnomalies } = vi.hoisted(() => ({
  mockDetectAnomalies: vi.fn(),
}))

vi.mock('@/lib/anomaly-service', () => ({
  detectAnomalies: mockDetectAnomalies,
}))

import { useAnomalyStore } from '../anomaly-store'

describe('anomaly-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore._clear()
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
      // Pre-set dismissed IDs in shared store
      mockStore._data['dismissed_anomalies'] = {
        ids: ['large_transaction:tx001'],
        expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }

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
    it('marks anomaly as dismissed and persists to shared store', async () => {
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

      // Wait for async persistence
      await vi.waitFor(() => {
        expect(mockStore.set).toHaveBeenCalledWith(
          'dismissed_anomalies',
          expect.objectContaining({ ids: expect.any(Array) })
        )
      })
    })

    it('does nothing for nonexistent anomaly id', () => {
      useAnomalyStore.setState({ anomalies: [] })

      useAnomalyStore.getState().dismissAnomaly('nonexistent')

      expect(mockStore.set).not.toHaveBeenCalled()
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
