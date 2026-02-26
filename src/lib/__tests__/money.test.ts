import { describe, it, expect } from 'vitest'
import { toCentavos, fromCentavos, formatMoney, addMoney, subtractMoney } from '../money'

describe('money utilities', () => {
  describe('toCentavos', () => {
    it('converts whole numbers', () => {
      expect(toCentavos(10)).toBe(1000)
    })

    it('converts decimals', () => {
      expect(toCentavos(12.5)).toBe(1250)
    })

    it('rounds to nearest centavo', () => {
      expect(toCentavos(10.999)).toBe(1100)
    })

    it('handles zero', () => {
      expect(toCentavos(0)).toBe(0)
    })

    it('handles negative amounts', () => {
      expect(toCentavos(-5.5)).toBe(-550)
    })
  })

  describe('fromCentavos', () => {
    it('converts to decimal', () => {
      expect(fromCentavos(1250)).toBe(12.5)
    })

    it('handles zero', () => {
      expect(fromCentavos(0)).toBe(0)
    })

    it('handles negative', () => {
      expect(fromCentavos(-550)).toBe(-5.5)
    })
  })

  describe('formatMoney', () => {
    it('formats USD', () => {
      expect(formatMoney(1250, 'USD', 'en-US')).toBe('$12.50')
    })

    it('formats negative amounts', () => {
      expect(formatMoney(-1250, 'USD', 'en-US')).toBe('-$12.50')
    })

    it('formats zero', () => {
      expect(formatMoney(0, 'USD', 'en-US')).toBe('$0.00')
    })

    it('formats EUR', () => {
      const result = formatMoney(1250, 'EUR', 'en-US')
      expect(result).toContain('12.50')
    })
  })

  describe('addMoney', () => {
    it('adds two amounts', () => {
      expect(addMoney(1000, 250)).toBe(1250)
    })
  })

  describe('subtractMoney', () => {
    it('subtracts two amounts', () => {
      expect(subtractMoney(1250, 250)).toBe(1000)
    })
  })
})
