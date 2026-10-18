import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/budgets.json'
import es from '@/i18n/locales/es/budgets.json'
import {
  budgetUsageStatusCounts,
  budgetUsageVisual,
  type BudgetUsageVisualInput,
} from '@/components/budgets/budget-visual-model'

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix.slice(0, -1)]
  return Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
}

const comparable = {
  comparison: { limitComparable: true },
  result: { complete: true },
} satisfies BudgetUsageVisualInput

describe('budget usage visual', () => {
  it('keeps the existing thresholds and caps only the stroke', () => {
    expect(budgetUsageVisual({ ...comparable, percentUsed: 60 })).toMatchObject({
      filled: true,
      percent: 60,
      visualPercent: 60,
      tone: 'success',
      status: 'safe',
    })
    expect(budgetUsageVisual({ ...comparable, percentUsed: 61 })).toMatchObject({
      tone: 'warning',
      status: 'warning',
      visualPercent: 61,
    })
    expect(budgetUsageVisual({ ...comparable, percentUsed: 80 })).toMatchObject({
      tone: 'warning',
      status: 'warning',
    })
    expect(budgetUsageVisual({ ...comparable, percentUsed: 81 })).toMatchObject({
      tone: 'destructive',
      status: 'critical',
      visualPercent: 81,
    })
    expect(budgetUsageVisual({ ...comparable, percentUsed: 140 })).toEqual({
      filled: true,
      percent: 140,
      visualPercent: 100,
      tone: 'destructive',
      status: 'overBudget',
    })
    expect(budgetUsageVisual({ ...comparable, percentUsed: -5 })).toMatchObject({
      filled: true,
      percent: -5,
      visualPercent: 0,
      tone: 'success',
    })
    expect(budgetUsageVisual({ ...comparable, percentUsed: 0 })).toMatchObject({
      filled: true,
      percent: 0,
      visualPercent: 0,
    })
  })

  it('does not fill an incomparable, incomplete, or missing percent', () => {
    const empty = {
      filled: false,
      percent: null,
      visualPercent: null,
      tone: 'unavailable',
      status: 'unavailable',
    }
    expect(
      budgetUsageVisual({
        percentUsed: 90,
        comparison: { limitComparable: false },
        result: { complete: true },
      })
    ).toEqual(empty)
    expect(
      budgetUsageVisual({
        percentUsed: 90,
        comparison: { limitComparable: true },
        result: { complete: false },
      })
    ).toEqual(empty)
    expect(budgetUsageVisual({ ...comparable, percentUsed: null })).toEqual(empty)
    expect(budgetUsageVisual({ percentUsed: 40 })).toEqual(empty)
    expect(budgetUsageVisual({ ...comparable, percentUsed: Number.NaN })).toEqual(empty)
  })

  it('counts plans without exposing a combined amount', () => {
    const counts = budgetUsageStatusCounts([
      { ...comparable, percentUsed: 140 },
      { ...comparable, percentUsed: 81 },
      { ...comparable, percentUsed: 20 },
      { percentUsed: 50, comparison: { limitComparable: false }, result: { complete: true } },
    ])
    expect(counts).toEqual({ total: 4, over: 1, tight: 1, unavailable: 1 })
    expect(counts).not.toHaveProperty('spent')
    expect(counts).not.toHaveProperty('limit')
    expect(counts).not.toHaveProperty('remaining')
  })

  it('has Spanish copy for every budgets string', () => {
    const english = keys(en)
    const spanish = new Set(keys(es))
    expect(english.filter((key) => !spanish.has(key))).toEqual([])
    expect(es.visual.title).toBe('Uso de los planes')
    expect(es.visual.unfilledLabel).toContain('uso no disponible')
    expect(en.visual.capped).toContain('100%')
  })
})
