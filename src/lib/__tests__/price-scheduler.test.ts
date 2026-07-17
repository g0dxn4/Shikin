import { describe, it, expect, vi, afterEach } from 'vitest'
import { isInvestmentPriceStale } from '../price-scheduler'

describe('price-scheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
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
