import { assertFxDate } from './fx.js'

export type ReportPeriod = 'week' | 'month' | 'year' | 'custom'
export type ScopedBudgetPeriod = 'weekly' | 'monthly' | 'yearly'
export interface ReportWindowInput {
  period?: ReportPeriod
  asOf?: string
  start?: string
  end?: string
  through?: 'as_of' | 'period_end'
  weekStartsOn?: number
  timeZone?: string
  /** Optional captured instant, for deterministic callers; never shifts stored date-only values. */
  now?: Date
}
export interface ReportWindow {
  period: ReportPeriod
  start: string
  end: string
  periodStart: string
  periodEnd: string
  asOf: string
  through: 'as_of' | 'period_end'
  weekStartsOn: number
  timeZone: string
  requested: { start: string | null; end: string | null }
}
function date(value: string): Date {
  assertFxDate(value)
  return new Date(`${value}T00:00:00Z`)
}
function iso(value: Date): string {
  const result = value.toISOString().slice(0, 10)
  assertFxDate(result)
  return result
}
function bounds(period: Exclude<ReportPeriod, 'custom'>, asOf: string, weekStartsOn: number) {
  const start = date(asOf)
  const end = date(asOf)
  if (period === 'week') {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() - weekStartsOn + 7) % 7))
    end.setTime(start.getTime())
    end.setUTCDate(end.getUTCDate() + 6)
  } else if (period === 'month') {
    start.setUTCDate(1)
    end.setUTCMonth(end.getUTCMonth() + 1, 0)
  } else {
    start.setUTCMonth(0, 1)
    end.setUTCMonth(11, 31)
  }
  return { start: iso(start), end: iso(end) }
}
/** Strict inclusive calendar windows; locale never determines week start. */
export function resolveReportWindow(input: ReportWindowInput = {}): ReportWindow {
  const captured = input.now ?? new Date()
  if (input.timeZone?.startsWith('+') || input.timeZone?.startsWith('-'))
    throw new Error('timeZone must be an IANA zone, not an offset.')
  const timeZone = new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).resolvedOptions()
    .timeZone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(captured)
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  const asOf = input.asOf ?? `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`
  assertFxDate(asOf)
  const weekStartsOn = input.weekStartsOn ?? 0
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6)
    throw new Error('weekStartsOn must be 0 through 6.')
  const through = input.through ?? 'as_of'
  if (through !== 'as_of' && through !== 'period_end')
    throw new Error('Unsupported through policy.')
  const hasRange = input.start !== undefined || input.end !== undefined
  const period = input.period ?? (hasRange ? 'custom' : 'month')
  if (!['week', 'month', 'year', 'custom'].includes(period))
    throw new Error('Unsupported report period.')
  if (hasRange && (input.start === undefined || input.end === undefined))
    throw new Error('Explicit windows require both start and end.')
  if (period === 'custom' && !hasRange) throw new Error('Custom windows require start and end.')
  const calendar = hasRange
    ? { start: input.start!, end: input.end! }
    : bounds(period as Exclude<ReportPeriod, 'custom'>, asOf, weekStartsOn)
  assertFxDate(calendar.start)
  assertFxDate(calendar.end)
  if (calendar.start > calendar.end) throw new Error('Window start must not follow end.')
  const end = through === 'as_of' && calendar.end > asOf ? asOf : calendar.end
  if (calendar.start > end)
    throw new Error('Window starts after asOf; choose through=period_end to include future dates.')
  return {
    period: hasRange ? 'custom' : period,
    start: calendar.start,
    end,
    periodStart: calendar.start,
    periodEnd: calendar.end,
    asOf,
    through,
    weekStartsOn,
    timeZone,
    requested: { start: input.start ?? null, end: input.end ?? null },
  }
}

/** Current definition, not invented historical budget versions; partial same-period usage is comparable. */
export function budgetWindowComparability(window: ReportWindow, planPeriod: ScopedBudgetPeriod) {
  if (!['weekly', 'monthly', 'yearly'].includes(planPeriod))
    throw new Error('Unsupported budget period.')
  const reportPeriod =
    planPeriod === 'weekly' ? 'week' : planPeriod === 'monthly' ? 'month' : 'year'
  const plan = bounds(reportPeriod, window.start, window.weekStartsOn)
  // Compare the requested span too: an asOf cutoff must not disguise a cross-period custom range.
  const limitComparable = window.periodStart >= plan.start && window.periodEnd <= plan.end
  return {
    limitComparable,
    planPeriodStart: plan.start,
    planPeriodEnd: plan.end,
    definitionPolicy: 'current_definition_as_of' as const,
    reason: limitComparable ? null : ('cross_plan_period_window' as const),
  }
}
