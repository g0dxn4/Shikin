import { describe, expect, it } from 'vitest'
import {
  advanceAnchoredRecurrence,
  advanceLegacyRecurrence,
  calculateRecurrenceAnchor,
  type AnchoredRecurrenceFrequency,
  type RecurrenceAnchor,
  type RecurrenceAnchorIntent,
} from './recurrence.js'

describe('anchored recurrence', () => {
  it('requires explicit fixed-day versus end-of-month intent for new rules', () => {
    expect(calculateRecurrenceAnchor('2025-04-30')).toEqual({
      status: 'unresolved',
      reason: 'missing_anchor_intent',
      initialDate: '2025-04-30',
    })
    expect(calculateRecurrenceAnchor('2025-04-30', 'fixed_day')).toMatchObject({
      status: 'resolved',
      anchor: { kind: 'day_of_month', day: 30 },
    })
    expect(calculateRecurrenceAnchor('2025-04-30', 'end_of_month')).toMatchObject({
      status: 'resolved',
      anchor: { kind: 'end_of_month' },
    })
  })

  it('preserves fixed month-end dates as fixed days when explicitly selected', () => {
    expect(
      advanceAnchoredRecurrence('2025-04-30', 'monthly', {
        kind: 'day_of_month',
        day: 30,
      }).date
    ).toBe('2025-05-30')
    expect(
      advanceAnchoredRecurrence('2025-02-28', 'monthly', {
        kind: 'day_of_month',
        day: 28,
      }).date
    ).toBe('2025-03-28')
  })

  it('advances explicitly selected end-of-month rules to month end', () => {
    expect(advanceAnchoredRecurrence('2024-01-31', 'monthly', { kind: 'end_of_month' }).date).toBe(
      '2024-02-29'
    )
    expect(advanceAnchoredRecurrence('2024-02-29', 'monthly', { kind: 'end_of_month' }).date).toBe(
      '2024-03-31'
    )
    expect(advanceAnchoredRecurrence('2024-02-29', 'yearly', { kind: 'end_of_month' }).date).toBe(
      '2025-02-28'
    )
  })

  it('does not guess anchors for ambiguous legacy days 28 through 31', () => {
    expect(advanceLegacyRecurrence('2025-02-28', 'monthly')).toEqual({
      status: 'unresolved',
      reason: 'ambiguous_legacy_day_28_to_31',
      currentDate: '2025-02-28',
      frequency: 'monthly',
      compatibility: 'requires_explicit_anchor',
    })
    expect(advanceLegacyRecurrence('2025-02-27', 'monthly')).toMatchObject({
      status: 'resolved',
      date: '2025-03-27',
      compatibility: 'legacy_unambiguous',
    })
  })

  it('throws precise errors for malformed runtime frequency, intent, and anchor kinds', () => {
    expect(() =>
      advanceAnchoredRecurrence('2025-01-15', 'weekly' as AnchoredRecurrenceFrequency, {
        kind: 'day_of_month',
        day: 15,
      })
    ).toThrowError(new TypeError('Unsupported recurrence frequency: weekly'))
    expect(() =>
      calculateRecurrenceAnchor('2025-01-31', 'calendar_day' as RecurrenceAnchorIntent)
    ).toThrowError(new TypeError('Unsupported recurrence anchor intent: calendar_day'))
    expect(() =>
      advanceAnchoredRecurrence('2025-01-31', 'monthly', {
        kind: 'calendar_day',
      } as unknown as RecurrenceAnchor)
    ).toThrowError(new TypeError('Unsupported recurrence anchor kind: calendar_day'))
  })
})
