import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { budgetActualRange } from '../budget-actual-range'

describe('budget actual date ranges', () => {
  it('uses calendar starts across year and leap-month boundaries, inclusive through local today', () => {
    const today = dayjs('2026-01-02')
    expect(budgetActualRange('this-month', today)).toEqual({
      start: '2026-01-01',
      end: '2026-01-02',
    })
    expect(budgetActualRange('3-months', today)).toEqual({ start: '2025-11-01', end: '2026-01-02' })
    expect(budgetActualRange('6-months', today)).toEqual({ start: '2025-08-01', end: '2026-01-02' })
    expect(budgetActualRange('this-year', today)).toEqual({
      start: '2026-01-01',
      end: '2026-01-02',
    })
    expect(budgetActualRange('all-time', today)).toEqual({ start: null, end: '2026-01-02' })
    expect(budgetActualRange('3-months', dayjs('2024-03-31')).start).toBe('2024-01-01')
    expect(budgetActualRange('6-months', dayjs('2024-02-29')).start).toBe('2023-09-01')
  })
})
