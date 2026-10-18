import dayjs from 'dayjs'
import { formatMoney } from '@/lib/money'

/** Legacy goal swatch. Identity for a missing stored color only — never app text. */
export const LEGACY_GOAL_SWATCH = '#7C5CFF'

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function goalIdentityColor(color: string | null | undefined): string {
  const value = color?.trim() ?? ''
  return HEX_COLOR.test(value) ? value : LEGACY_GOAL_SWATCH
}

export type GoalStatusKey = 'completed' | 'overdue' | 'dueToday' | 'daysLeft' | 'noDeadline'
export type GoalStatusTone = 'success' | 'warning' | 'destructive' | 'neutral'

export interface GoalStatus {
  key: GoalStatusKey
  days: number | null
  tone: GoalStatusTone
}

export function goalStatus(goal: { progress: number; daysRemaining: number | null }): GoalStatus {
  if (goal.progress >= 100) {
    return { key: 'completed', days: goal.daysRemaining, tone: 'success' }
  }
  if (goal.daysRemaining === null) {
    return { key: 'noDeadline', days: null, tone: 'neutral' }
  }
  if (goal.daysRemaining > 0) {
    return { key: 'daysLeft', days: goal.daysRemaining, tone: 'neutral' }
  }
  if (goal.daysRemaining === 0) {
    return { key: 'dueToday', days: 0, tone: 'warning' }
  }
  return { key: 'overdue', days: goal.daysRemaining, tone: 'destructive' }
}

type GoalStatusTranslationKey =
  | 'card.daysLeft'
  | 'card.completed'
  | 'card.overdue'
  | 'card.dueToday'
  | 'card.noDeadline'

export function goalStatusLabel(
  status: GoalStatus,
  translate: (key: GoalStatusTranslationKey) => string
): string {
  if (status.key === 'daysLeft') return `${status.days ?? 0} ${translate('card.daysLeft')}`
  if (status.key === 'completed') return translate('card.completed')
  if (status.key === 'overdue') return translate('card.overdue')
  if (status.key === 'dueToday') return translate('card.dueToday')
  return translate('card.noDeadline')
}

export interface SelectableGoal {
  id: string
  progress: number
  deadline?: string | null
}

function deadlineValue(deadline: string | null | undefined): number | null {
  const value = deadline?.trim()
  if (!value) return null
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.valueOf() : null
}

function byProgressThenId(a: SelectableGoal, b: SelectableGoal): number {
  if (b.progress !== a.progress) return b.progress - a.progress
  return a.id.localeCompare(b.id)
}

/**
 * Initial feature: earliest deadline among incomplete goals.
 * If none of those have a deadline, the highest incomplete progress.
 * If every goal is complete, the highest progress. Ties break by id.
 */
export function selectFeaturedGoal<T extends SelectableGoal>(goals: readonly T[]): T | null {
  if (goals.length === 0) return null
  const incomplete = goals.filter((goal) => goal.progress < 100)
  if (incomplete.length > 0) {
    const dated = incomplete
      .map((goal) => ({ goal, deadline: deadlineValue(goal.deadline) }))
      .filter((item): item is { goal: T; deadline: number } => item.deadline !== null)
    if (dated.length > 0) {
      dated.sort((a, b) => a.deadline - b.deadline || byProgressThenId(a.goal, b.goal))
      return dated[0].goal
    }
    return [...incomplete].sort(byProgressThenId)[0] ?? null
  }
  return [...goals].sort(byProgressThenId)[0] ?? null
}

/** Keep an explicit selection when that goal still exists; otherwise use the featured goal. */
export function resolveSelectedGoal<T extends SelectableGoal>(
  goals: readonly T[],
  selectedId: string | null | undefined
): T | null {
  if (goals.length === 0) return null
  if (selectedId) {
    const selected = goals.find((goal) => goal.id === selectedId)
    if (selected) return selected
  }
  return selectFeaturedGoal(goals)
}

/** Incomplete goals first, then higher recorded progress. Equal keys keep incoming order. */
export function orderGoalCollection<T extends { progress: number }>(goals: readonly T[]): T[] {
  return [...goals].sort((a, b) => {
    const aComplete = a.progress >= 100
    const bComplete = b.progress >= 100
    if (aComplete !== bComplete) return aComplete ? 1 : -1
    return b.progress - a.progress
  })
}

interface ConversionSlice {
  complete: boolean
  amountCentavos?: number
  preferredCurrency?: string | null
}

export interface GoalConversionSummary {
  complete: boolean
  toCurrency: string | null
  saved?: ConversionSlice | null
  target?: ConversionSlice | null
}

export interface AuthoritativeGoalSummary {
  complete: true
  currency: string
  current: number
  target: number
  progress: number
}

export type GoalSummary = AuthoritativeGoalSummary | { complete: false }

function sliceAmount(
  slice: ConversionSlice | null | undefined,
  mainCurrency: string
): number | null {
  if (!slice?.complete) return null
  const preferred = slice.preferredCurrency?.trim()
  if (preferred && preferred !== mainCurrency) return null
  if (typeof slice.amountCentavos !== 'number' || !Number.isSafeInteger(slice.amountCentavos)) {
    return null
  }
  return slice.amountCentavos
}

/**
 * Converted totals are shown only when every goal converts completely into the main currency.
 * Partial, missing, or wrong-authority amounts are withheld — never treated as zero.
 */
export function summarizeGoalAuthority(
  goals: readonly { mainConversion?: GoalConversionSummary | null }[],
  mainCurrency: string | null | undefined
): GoalSummary {
  const authority = mainCurrency?.trim()
  if (!authority || goals.length === 0) return { complete: false }

  let current = 0
  let target = 0
  for (const goal of goals) {
    const conversion = goal.mainConversion
    if (!conversion?.complete || conversion.toCurrency?.trim() !== authority) {
      return { complete: false }
    }
    const saved = sliceAmount(conversion.saved, authority)
    const goalTarget = sliceAmount(conversion.target, authority)
    if (saved === null || goalTarget === null) return { complete: false }
    current += saved
    target += goalTarget
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(target)) {
      return { complete: false }
    }
  }

  return {
    complete: true,
    currency: authority,
    current,
    target,
    progress: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
  }
}

/** Format a stored centavo amount in its own currency. Never invent a USD fallback. */
export function formatGoalAmount(
  amount: number,
  currency: string | null | undefined
): string | null {
  if (!Number.isFinite(amount)) return null
  const code = currency?.trim()
  if (!code) return null
  try {
    return formatMoney(amount, code)
  } catch {
    return null
  }
}

export function displayGoalAmount(amount: number, currency: string | null | undefined): string {
  return formatGoalAmount(amount, currency) ?? '—'
}
