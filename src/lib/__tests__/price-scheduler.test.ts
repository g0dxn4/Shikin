import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/database', () => ({ query: vi.fn() }))
vi.mock('@/lib/price-service', () => ({
  fetchAllCurrentPrices: vi.fn(async () => ({ quotes: new Map(), failures: [] })),
  savePricesToDB: vi.fn(),
}))
vi.mock('@/stores/investment-store', () => ({
  useInvestmentStore: {
    getState: vi.fn(() => ({
      setRefreshFailures: vi.fn(),
      setLastPriceFetch: vi.fn(),
      fetch: vi.fn(),
    })),
  },
}))

import { query } from '@/lib/database'
import { fetchAllCurrentPrices } from '../price-service'
import { initPriceScheduler, isInvestmentPriceStale, stopPriceScheduler } from '../price-scheduler'

describe('price-scheduler', () => {
  afterEach(() => {
    stopPriceScheduler()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('uses retrieval time for refresh cadence while retaining the older source quote date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-10T12:00:00Z'))
    vi.mocked(query).mockResolvedValue([
      {
        id: 'inv-1',
        type: 'stock',
        quote_date: '2024-01-05',
        price_retrieved_at: '2024-01-10T11:00:00.000Z',
      },
    ])

    await initPriceScheduler()

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ip.created_at AS price_retrieved_at')
    )
    expect(fetchAllCurrentPrices).not.toHaveBeenCalled()
  })

  describe('isInvestmentPriceStale', () => {
    it('returns true when lastDate is null', () => {
      expect(isInvestmentPriceStale(null, 'stock')).toBe(true)
      expect(isInvestmentPriceStale(null, 'crypto')).toBe(true)
    })

    it('considers crypto stale after >6 hours', () => {
      const now = new Date('2024-01-10T12:00:00Z')
      vi.setSystemTime(now)

      const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString()
      const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString()

      expect(isInvestmentPriceStale(fiveHoursAgo, 'crypto')).toBe(false)
      expect(isInvestmentPriceStale(sevenHoursAgo, 'crypto')).toBe(true)
    })

    it('considers stocks stale after >1.5 days on weekdays', () => {
      const now = new Date('2024-01-10T12:00:00Z') // Wednesday
      vi.setSystemTime(now)

      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()

      expect(isInvestmentPriceStale(oneDayAgo, 'stock')).toBe(false)
      expect(isInvestmentPriceStale(twoDaysAgo, 'stock')).toBe(true)
    })

    it('extends stock staleness across weekends', () => {
      const mondayMorning = new Date('2024-01-08T10:00:00Z')
      vi.setSystemTime(mondayMorning)

      const friday = new Date('2024-01-05T12:00:00Z')
      expect(isInvestmentPriceStale(friday.toISOString(), 'stock')).toBe(false)

      const mondayEvening = new Date('2024-01-08T20:00:00Z')
      vi.setSystemTime(mondayEvening)
      expect(isInvestmentPriceStale(friday.toISOString(), 'stock')).toBe(true)
    })
  })
})
