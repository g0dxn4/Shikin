import { describe, expect, it } from 'vitest'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'

describe('formatCompactChartMoney', () => {
  it('converts centavos before applying compact currency notation', () => {
    expect(formatCompactChartMoney(123_456, 'USD', 'en-US')).toBe('$1.2K')
    expect(formatCompactChartMoney(12_345, 'USD', 'en-US')).toBe('$123.5')
  })

  it('keeps signs and locale-specific currency placement', () => {
    const formatted = formatCompactChartMoney(-1_250_000, 'EUR', 'es-ES')

    expect(formatted).toContain('-12,5')
    expect(formatted).toContain('mil')
    expect(formatted).toContain('€')
  })

  it('does not round a centavo value as though it were a major-currency value', () => {
    expect(formatCompactChartMoney(100_000_000, 'USD', 'en-US')).toBe('$1M')
  })
})
