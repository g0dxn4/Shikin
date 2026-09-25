import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { getTransactionDatePreset, transactionDateBounds } from './transaction-date-presets'

describe('transaction calendar date presets', () => {
  const today = dayjs('2026-03-18')
  it('ends every new window today, with inclusive month and year starts', () => {
    expect(transactionDateBounds('this-month', today)).toEqual({
      dateFrom: '2026-03-01',
      dateTo: '2026-03-18',
    })
    expect(transactionDateBounds('three-months', today)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-03-18',
    })
    expect(transactionDateBounds('six-months', today)).toEqual({
      dateFrom: '2025-10-01',
      dateTo: '2026-03-18',
    })
    expect(transactionDateBounds('this-year', today)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-03-18',
    })
    expect(transactionDateBounds('all', today)).toEqual({ dateFrom: '', dateTo: '' })
  })
  it('recognizes serialized legacy URLs without reinterpreting or rewriting their bounds', () => {
    for (const preset of ['month', '30-days', '90-days'] as const) {
      const bounds = transactionDateBounds(preset, today)
      expect(getTransactionDatePreset(bounds.dateFrom, bounds.dateTo, today)).toBe(preset)
    }
    expect(getTransactionDatePreset('2026-01-01', '2026-03-18', today)).toBe('three-months')
    expect(getTransactionDatePreset('2026-02-01', '2026-02-12', today)).toBe('custom')
    expect(getTransactionDatePreset('', '', today)).toBe('all')
  })
})
