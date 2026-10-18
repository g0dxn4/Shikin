/** Ratio presentation for one plan. Never combine plans, periods, or currencies. */

export type BudgetUsageTone = 'success' | 'warning' | 'destructive' | 'unavailable'

export type BudgetUsageStatus = 'safe' | 'warning' | 'critical' | 'overBudget' | 'unavailable'

export interface BudgetUsageVisualInput {
  percentUsed?: number | null
  comparison?: { limitComparable?: boolean } | null
  result?: { complete?: boolean } | null
}

export interface BudgetUsageVisual {
  filled: boolean
  /** True percent when a ratio may be drawn; otherwise null so the UI shows an em dash. */
  percent: number | null
  /** Stroke length, capped at 100. Null when the ring must stay empty. */
  visualPercent: number | null
  tone: BudgetUsageTone
  status: BudgetUsageStatus
}

export interface BudgetUsageStatusCounts {
  total: number
  over: number
  tight: number
  unavailable: number
}

function finitePercent(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * A filled ring is allowed only for a comparable, complete result with a real percent.
 * Over-100 stays numeric; the stroke caps separately.
 */
export function budgetUsageVisual(input: BudgetUsageVisualInput): BudgetUsageVisual {
  const percentUsed = input.percentUsed
  const filled =
    input.comparison?.limitComparable === true &&
    input.result?.complete === true &&
    finitePercent(percentUsed)

  if (!filled || !finitePercent(percentUsed)) {
    return {
      filled: false,
      percent: null,
      visualPercent: null,
      tone: 'unavailable',
      status: 'unavailable',
    }
  }

  const visualPercent = Math.max(0, Math.min(percentUsed, 100))
  if (percentUsed > 100) {
    return {
      filled: true,
      percent: percentUsed,
      visualPercent,
      tone: 'destructive',
      status: 'overBudget',
    }
  }
  if (percentUsed > 80) {
    return {
      filled: true,
      percent: percentUsed,
      visualPercent,
      tone: 'destructive',
      status: 'critical',
    }
  }
  if (percentUsed > 60) {
    return {
      filled: true,
      percent: percentUsed,
      visualPercent,
      tone: 'warning',
      status: 'warning',
    }
  }
  return {
    filled: true,
    percent: percentUsed,
    visualPercent,
    tone: 'success',
    status: 'safe',
  }
}

/** Counts only. Amounts are intentionally absent so callers cannot present a combined total. */
export function budgetUsageStatusCounts(
  plans: readonly BudgetUsageVisualInput[]
): BudgetUsageStatusCounts {
  const counts: BudgetUsageStatusCounts = { total: plans.length, over: 0, tight: 0, unavailable: 0 }
  for (const plan of plans) {
    const visual = budgetUsageVisual(plan)
    if (visual.status === 'overBudget') counts.over += 1
    else if (visual.status === 'critical') counts.tight += 1
    else if (!visual.filled) counts.unavailable += 1
  }
  return counts
}
