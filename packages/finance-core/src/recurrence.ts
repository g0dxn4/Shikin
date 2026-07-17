export type AnchoredRecurrenceFrequency = 'monthly' | 'quarterly' | 'yearly'
export type RecurrenceAnchorIntent = 'fixed_day' | 'end_of_month'

export type RecurrenceAnchor = { kind: 'day_of_month'; day: number } | { kind: 'end_of_month' }

export interface AnchoredRecurrenceResult {
  status: 'resolved'
  date: string
  anchor: RecurrenceAnchor
}

export type RecurrenceAnchorCalculationResult =
  | {
      status: 'resolved'
      initialDate: string
      intent: RecurrenceAnchorIntent
      anchor: RecurrenceAnchor
    }
  | {
      status: 'unresolved'
      reason: 'missing_anchor_intent'
      initialDate: string
    }

export type LegacyRecurrenceResult =
  | (AnchoredRecurrenceResult & { compatibility: 'legacy_unambiguous' })
  | {
      status: 'unresolved'
      reason: 'ambiguous_legacy_day_28_to_31'
      currentDate: string
      frequency: AnchoredRecurrenceFrequency
      compatibility: 'requires_explicit_anchor'
    }

/** Capture explicit fixed-day versus end-of-month intent for a newly-created rule. */
export function calculateRecurrenceAnchor(
  initialDate: string,
  intent?: RecurrenceAnchorIntent | null
): RecurrenceAnchorCalculationResult {
  const date = parseIsoDate(initialDate)
  if (intent === undefined || intent === null) {
    return { status: 'unresolved', reason: 'missing_anchor_intent', initialDate }
  }
  assertAnchorIntent(intent)
  return {
    status: 'resolved',
    initialDate,
    intent,
    anchor:
      intent === 'end_of_month'
        ? { kind: 'end_of_month' }
        : { kind: 'day_of_month', day: date.day },
  }
}

export function advanceAnchoredRecurrence(
  currentDate: string,
  frequency: AnchoredRecurrenceFrequency,
  anchor: RecurrenceAnchor
): AnchoredRecurrenceResult {
  assertFrequency(frequency)
  assertAnchor(anchor)
  const current = parseIsoDate(currentDate)
  const monthsByFrequency: Record<AnchoredRecurrenceFrequency, number> = {
    monthly: 1,
    quarterly: 3,
    yearly: 12,
  }
  const absoluteMonth = current.year * 12 + (current.month - 1) + monthsByFrequency[frequency]
  const year = Math.floor(absoluteMonth / 12)
  const month = (absoluteMonth % 12) + 1
  const targetLastDay = daysInMonth(year, month)
  const day = anchor.kind === 'end_of_month' ? targetLastDay : Math.min(anchor.day, targetLastDay)

  return {
    status: 'resolved',
    date: formatIsoDate(year, month, day),
    anchor,
  }
}

/**
 * Legacy rules did not persist an anchor. Days 28–31 are ambiguous because a
 * clamped date can mean either a fixed day or an end-of-month rule.
 */
export function advanceLegacyRecurrence(
  currentDate: string,
  frequency: AnchoredRecurrenceFrequency
): LegacyRecurrenceResult {
  assertFrequency(frequency)
  const current = parseIsoDate(currentDate)
  if (current.day >= 28) {
    return {
      status: 'unresolved',
      reason: 'ambiguous_legacy_day_28_to_31',
      currentDate,
      frequency,
      compatibility: 'requires_explicit_anchor',
    }
  }

  return {
    ...advanceAnchoredRecurrence(currentDate, frequency, {
      kind: 'day_of_month',
      day: current.day,
    }),
    compatibility: 'legacy_unambiguous',
  }
}

function assertAnchorIntent(value: unknown): asserts value is RecurrenceAnchorIntent {
  if (value !== 'fixed_day' && value !== 'end_of_month') {
    throw new TypeError(`Unsupported recurrence anchor intent: ${String(value)}`)
  }
}

function assertFrequency(value: unknown): asserts value is AnchoredRecurrenceFrequency {
  if (value !== 'monthly' && value !== 'quarterly' && value !== 'yearly') {
    throw new TypeError(`Unsupported recurrence frequency: ${String(value)}`)
  }
}

function assertAnchor(anchor: RecurrenceAnchor): void {
  if (!anchor || typeof anchor !== 'object') {
    throw new TypeError('recurrence anchor must be an object')
  }
  if (anchor.kind === 'end_of_month') return
  if (anchor.kind !== 'day_of_month') {
    throw new TypeError(
      `Unsupported recurrence anchor kind: ${String((anchor as { kind?: unknown }).kind)}`
    )
  }
  if (!Number.isInteger(anchor.day) || anchor.day < 1 || anchor.day > 31) {
    throw new RangeError('day-of-month recurrence anchor must be an integer from 1 through 31')
  }
}

function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new TypeError('date must use YYYY-MM-DD format')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`date is not a real calendar date: ${value}`)
  }
  return { year, month, day }
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}
