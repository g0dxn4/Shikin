import { describe, expect, it } from 'vitest'
import { budgetWindowComparability, resolveReportWindow } from './report-window.js'

describe('strict shared inclusive report windows', () => {
  it('uses Sunday by default across a year boundary, not host locale', () => {
    expect(
      resolveReportWindow({ period: 'week', asOf: '2026-01-01', timeZone: 'UTC' })
    ).toMatchObject({
      start: '2025-12-28',
      end: '2026-01-01',
      periodEnd: '2026-01-03',
      weekStartsOn: 0,
      timeZone: 'UTC',
    })
    expect(
      resolveReportWindow({
        period: 'week',
        asOf: '2026-01-01',
        weekStartsOn: 1,
        through: 'period_end',
      })
    ).toMatchObject({ start: '2025-12-29', end: '2026-01-04' })
  })
  it('captures an instant in the explicit zone while leaving supplied date-only values unchanged', () => {
    const now = new Date('2026-01-01T01:00:00Z')
    expect(resolveReportWindow({ now, timeZone: 'America/Mexico_City' })).toMatchObject({
      asOf: '2025-12-31',
      start: '2025-12-01',
      end: '2025-12-31',
    })
    expect(resolveReportWindow({ now, timeZone: 'Asia/Tokyo' }).asOf).toBe('2026-01-01')
    expect(
      resolveReportWindow({ now, timeZone: 'America/Mexico_City', asOf: '2026-01-01' }).asOf
    ).toBe('2026-01-01')
    expect(resolveReportWindow({ asOf: '2026-01-01' }).timeZone).toBeTruthy()
  })
  it('validates leap years, explicit order and custom future cutoff', () => {
    expect(resolveReportWindow({ asOf: '2024-02-29' })).toMatchObject({
      start: '2024-02-01',
      end: '2024-02-29',
    })
    expect(resolveReportWindow({ asOf: '2000-02-01', through: 'period_end' }).end).toBe(
      '2000-02-29'
    )
    expect(
      resolveReportWindow({ period: 'year', asOf: '2026-02-01', through: 'period_end' })
    ).toMatchObject({ start: '2026-01-01', end: '2026-12-31' })
    expect(
      resolveReportWindow({ asOf: '2026-01-10', start: '2026-01-01', end: '2026-03-01' })
    ).toMatchObject({ end: '2026-01-10', periodEnd: '2026-03-01' })
    expect(() => resolveReportWindow({ asOf: '1900-02-29' })).toThrow()
    expect(() =>
      resolveReportWindow({ asOf: '2026-01-10', start: '2026-02-01', end: '2026-02-28' })
    ).toThrow('starts after asOf')
    expect(
      resolveReportWindow({
        asOf: '2026-01-10',
        start: '2026-02-01',
        end: '2026-02-28',
        through: 'period_end',
      }).end
    ).toBe('2026-02-28')
    expect(() => resolveReportWindow({ start: '2026-02-28', end: '2026-02-01' })).toThrow(
      'start must not follow'
    )
    expect(() => resolveReportWindow({ start: '2026-01-01' })).toThrow('both')
    expect(() => resolveReportWindow({ period: 'custom' })).toThrow('require')
    expect(() => resolveReportWindow({ timeZone: 'not/a-zone' })).toThrow()
    expect(() => resolveReportWindow({ timeZone: '+01:00' })).toThrow('IANA')
    expect(() => resolveReportWindow({ weekStartsOn: 7 })).toThrow()
  })
  it('only compares current limits within the same requested plan period', () => {
    expect(
      budgetWindowComparability(resolveReportWindow({ asOf: '2026-01-10' }), 'monthly')
    ).toMatchObject({ limitComparable: true, definitionPolicy: 'current_definition_as_of' })
    expect(
      budgetWindowComparability(
        resolveReportWindow({ asOf: '2026-01-10', start: '2026-01-01', end: '2026-02-10' }),
        'monthly'
      )
    ).toMatchObject({ limitComparable: false, reason: 'cross_plan_period_window' })
    expect(
      budgetWindowComparability(
        resolveReportWindow({ asOf: '2026-03-10', start: '2026-01-01', end: '2026-01-31' }),
        'monthly'
      ).limitComparable
    ).toBe(true)
  })
})
