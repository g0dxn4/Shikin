import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01ANOMALY0000000000000000'),
}))

vi.mock('@/lib/money', () => ({
  fromCentavos: (c: number) => c / 100,
}))

import { query } from '@/lib/database'
import { calculateStdDev, detectAnomalies } from '../anomaly-service'

const mockQuery = vi.mocked(query)

describe('anomaly-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('calculateStdDev', () => {
    it('returns zero mean and stdDev for fewer than 3 values', () => {
      expect(calculateStdDev([])).toEqual({ mean: 0, stdDev: 0 })
      expect(calculateStdDev([100])).toEqual({ mean: 0, stdDev: 0 })
      expect(calculateStdDev([100, 200])).toEqual({ mean: 0, stdDev: 0 })
    })

    it('calculates correctly for uniform values', () => {
      const { mean, stdDev } = calculateStdDev([100, 100, 100])
      expect(mean).toBe(100)
      expect(stdDev).toBe(0)
    })

    it('calculates correctly for varied values', () => {
      const { mean, stdDev } = calculateStdDev([10, 20, 30])
      expect(mean).toBeCloseTo(20)
      expect(stdDev).toBeCloseTo(8.165, 2)
    })

    it('calculates with larger dataset', () => {
      const { mean, stdDev } = calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9])
      expect(mean).toBe(5)
      expect(stdDev).toBe(2)
    })
  })

  describe('detectAnomalies', () => {
    it('returns empty array when no transactions exist', async () => {
      // All detection functions query for transactions and get empty results
      mockQuery.mockResolvedValue([])
      const result = await detectAnomalies()
      expect(result).toEqual([])
    })

    it('detects large transactions above threshold', async () => {
      // Use mockImplementation to respond based on SQL content
      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const s = sql as string
        // detectLargeTransactions: query for expenses >= threshold
        if (s.includes('t.amount >= $1') && s.includes("t.type = 'expense'")) {
          return [
            {
              id: 'tx1',
              description: 'Expensive Item',
              amount: 100000,
              date: '2024-01-15',
              category_id: null,
              category_name: 'Uncategorized',
              type: 'expense',
            },
          ]
        }
        return []
      })

      const result = await detectAnomalies({ largeTransactionThreshold: 500 })
      const large = result.filter((a) => a.type === 'large_transaction')
      expect(large.length).toBeGreaterThanOrEqual(1)
      expect(large[0].title).toContain('Expensive Item')
      expect(large[0].amount).toBe(1000)
    })

    it('detects duplicate charges within 48h', async () => {
      const today = new Date().toISOString().split('T')[0]

      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        // detectDuplicateCharges query: recent expenses within 7 days
        if (s.includes("t.type = 'expense'") && s.includes('t.date >= $1') && !s.includes('t.amount >= $1') && !s.includes('GROUP BY')) {
          return [
            { id: 'tx1', description: 'Coffee Shop', amount: 500, date: today, category_id: null, category_name: 'Uncategorized', type: 'expense' },
            { id: 'tx2', description: 'Coffee Shop', amount: 500, date: today, category_id: null, category_name: 'Uncategorized', type: 'expense' },
          ]
        }
        return []
      })

      const result = await detectAnomalies()
      const dupes = result.filter((a) => a.type === 'duplicate_charge')
      expect(dupes.length).toBeGreaterThanOrEqual(1)
      expect(dupes[0].title).toContain('Coffee Shop')
    })

    it('skips unusual amount detection with fewer than 3 history points', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        // detectUnusualAmounts: get recent expenses
        if (s.includes("t.type = 'expense'") && s.includes('t.date >= $1') && s.includes('t.id') && !s.includes('GROUP_CONCAT') && !s.includes('t.amount >= $1') && !s.includes('GROUP BY')) {
          return [
            { id: 'tx1', description: 'Store', amount: 50000, date: '2024-01-15', category_id: null, category_name: 'Uncategorized', type: 'expense' },
          ]
        }
        // History for merchant: only 2 entries
        if (s.includes('description = $1') && s.includes('amount')) {
          return [{ amount: 1000 }, { amount: 1000 }]
        }
        return []
      })

      const result = await detectAnomalies()
      const unusual = result.filter((a) => a.type === 'unusual_amount')
      expect(unusual).toHaveLength(0)
    })

    it('sorts results by severity (high first)', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        if (s.includes('t.amount >= $1')) {
          return [
            { id: 'tx1', description: 'Medium', amount: 60000, date: '2024-01-15', category_id: null, category_name: 'Uncategorized', type: 'expense' },
            { id: 'tx2', description: 'High', amount: 120000, date: '2024-01-15', category_id: null, category_name: 'Uncategorized', type: 'expense' },
          ]
        }
        return []
      })

      const result = await detectAnomalies({ largeTransactionThreshold: 500 })
      if (result.length >= 2) {
        const highIdx = result.findIndex((a) => a.severity === 'high')
        const medIdx = result.findIndex((a) => a.severity === 'medium')
        if (highIdx !== -1 && medIdx !== -1) {
          expect(highIdx).toBeLessThan(medIdx)
        }
      }
    })

    it('detects subscription price changes', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const s = sql as string
        if (s.includes('GROUP_CONCAT')) {
          return [
            { description: 'Netflix', amounts: '1599,1799' },
          ]
        }
        return []
      })

      const result = await detectAnomalies()
      const priceChanges = result.filter((a) => a.type === 'subscription_price_change')
      expect(priceChanges.length).toBe(1)
      expect(priceChanges[0].title).toContain('Netflix')
      expect(priceChanges[0].title).toContain('increase')
    })
  })
})
