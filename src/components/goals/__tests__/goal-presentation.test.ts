import { describe, expect, it } from 'vitest'
import {
  LEGACY_GOAL_SWATCH,
  displayGoalAmount,
  formatGoalAmount,
  goalIdentityColor,
  goalStatus,
  orderGoalCollection,
  resolveSelectedGoal,
  selectFeaturedGoal,
  summarizeGoalAuthority,
  type GoalConversionSummary,
} from '../goal-presentation'

function conversion(
  complete: boolean,
  toCurrency: string,
  saved: number,
  target: number,
  preferredCurrency = toCurrency
): GoalConversionSummary {
  return {
    complete,
    toCurrency,
    saved: { complete, amountCentavos: saved, preferredCurrency },
    target: { complete, amountCentavos: target, preferredCurrency },
  }
}

describe('goal presentation', () => {
  it('uses a stored hex as identity and the legacy swatch only as a fallback', () => {
    expect(goalIdentityColor('  #22c55e ')).toBe('#22c55e')
    expect(goalIdentityColor('#abc')).toBe('#abc')
    expect(goalIdentityColor(null)).toBe(LEGACY_GOAL_SWATCH)
    expect(goalIdentityColor('')).toBe(LEGACY_GOAL_SWATCH)
    expect(goalIdentityColor('red')).toBe(LEGACY_GOAL_SWATCH)
    expect(goalIdentityColor('var(--color-primary)')).toBe(LEGACY_GOAL_SWATCH)
  })

  it('keeps due today, overdue, and no deadline distinct from completion', () => {
    expect(goalStatus({ progress: 100, daysRemaining: -3 }).key).toBe('completed')
    expect(goalStatus({ progress: 40, daysRemaining: 0 }).key).toBe('dueToday')
    expect(goalStatus({ progress: 40, daysRemaining: -2 }).key).toBe('overdue')
    expect(goalStatus({ progress: 40, daysRemaining: null }).key).toBe('noDeadline')
    expect(goalStatus({ progress: 40, daysRemaining: 12 }).key).toBe('daysLeft')
  })

  it('features the earliest incomplete deadline, independent of list order', () => {
    const goals = [
      { id: 'later', progress: 90, deadline: '2026-12-01' },
      { id: 'done', progress: 100, deadline: '2020-01-01' },
      { id: 'soon', progress: 10, deadline: '2026-01-15' },
      { id: 'undated', progress: 99, deadline: null },
    ]

    expect(selectFeaturedGoal(goals)?.id).toBe('soon')
    expect(selectFeaturedGoal([...goals].reverse())?.id).toBe('soon')
  })

  it('breaks equal deadlines by higher progress, then id', () => {
    expect(
      selectFeaturedGoal([
        { id: 'b', progress: 20, deadline: '2026-05-01' },
        { id: 'a', progress: 80, deadline: '2026-05-01' },
      ])?.id
    ).toBe('a')
    expect(
      selectFeaturedGoal([
        { id: 'b', progress: 40, deadline: '2026-05-01' },
        { id: 'a', progress: 40, deadline: '2026-05-01' },
      ])?.id
    ).toBe('a')
  })

  it('features the highest progress when no incomplete goal has a deadline', () => {
    expect(
      selectFeaturedGoal([
        { id: 'low', progress: 10, deadline: null },
        { id: 'high', progress: 70, deadline: '   ' },
        { id: 'done', progress: 100, deadline: '2024-01-01' },
      ])?.id
    ).toBe('high')
  })

  it('features the highest progress when every goal is complete, ignoring deadlines', () => {
    expect(
      selectFeaturedGoal([
        { id: 'a-lower', progress: 100, deadline: '2020-01-01' },
        { id: 'z-higher', progress: 140, deadline: '2030-06-01' },
      ])?.id
    ).toBe('z-higher')
    expect(
      selectFeaturedGoal([
        { id: 'm', progress: 100, deadline: '2030-01-01' },
        { id: 'a', progress: 100, deadline: '2020-01-01' },
      ])?.id
    ).toBe('a')
  })

  it('falls back after a missing, empty, or deleted selection', () => {
    const goals = [
      { id: 'soon', progress: 20, deadline: '2026-02-01' },
      { id: 'later', progress: 80, deadline: '2026-11-01' },
    ]

    expect(resolveSelectedGoal(goals, null)?.id).toBe('soon')
    expect(resolveSelectedGoal(goals, '')?.id).toBe('soon')
    expect(resolveSelectedGoal(goals, 'missing')?.id).toBe('soon')
    expect(resolveSelectedGoal(goals, 'later')?.id).toBe('later')
    expect(resolveSelectedGoal([], 'later')).toBeNull()
    expect(
      resolveSelectedGoal(
        goals.filter((goal) => goal.id !== 'later'),
        'later'
      )?.id
    ).toBe('soon')
  })

  it('orders the collection with incomplete goals before completed ones', () => {
    expect(
      orderGoalCollection([
        { id: 'done', progress: 100 },
        { id: 'low', progress: 10 },
        { id: 'high', progress: 80 },
      ]).map((goal) => goal.id)
    ).toEqual(['high', 'low', 'done'])
  })

  it('withholds mixed, partial, and wrong-authority summaries without summing zeros', () => {
    const matching = { mainConversion: conversion(true, 'USD', 4_000, 10_000) }
    const otherAuthority = { mainConversion: conversion(true, 'MXN', 5_000, 10_000) }
    const incomplete = {
      mainConversion: conversion(false, 'USD', 0, 0),
    }
    const preferredMismatch = {
      mainConversion: conversion(true, 'USD', 9_999, 10_000, 'EUR'),
    }

    expect(summarizeGoalAuthority([matching, otherAuthority], 'USD').complete).toBe(false)
    expect(summarizeGoalAuthority([matching, incomplete], 'USD').complete).toBe(false)
    expect(summarizeGoalAuthority([matching, preferredMismatch], 'USD').complete).toBe(false)
    expect(summarizeGoalAuthority([otherAuthority], 'USD').complete).toBe(false)
    expect(summarizeGoalAuthority([matching], null).complete).toBe(false)
    expect(summarizeGoalAuthority([matching], '   ').complete).toBe(false)
    expect(summarizeGoalAuthority([], 'USD').complete).toBe(false)
    expect(
      summarizeGoalAuthority(
        [
          { mainConversion: conversion(true, 'USD', Number.MAX_SAFE_INTEGER, 1) },
          { mainConversion: conversion(true, 'USD', 1, 1) },
        ],
        'USD'
      ).complete
    ).toBe(false)
  })

  it('sums only a fully authoritative conversion and ignores native stand-ins', () => {
    const summary = summarizeGoalAuthority(
      [
        { mainConversion: conversion(true, 'USD', 4_000, 10_000) },
        { mainConversion: conversion(true, 'USD', 3_500, 5_000) },
      ],
      'USD'
    )

    expect(summary).toEqual({
      complete: true,
      currency: 'USD',
      current: 7_500,
      target: 15_000,
      progress: 50,
    })
  })

  it('does not format a goal amount as USD when its currency is missing or invalid', () => {
    expect(formatGoalAmount(5_000, null)).toBeNull()
    expect(formatGoalAmount(5_000, '   ')).toBeNull()
    expect(formatGoalAmount(5_000, 'NOT_A_CURRENCY')).toBeNull()
    expect(formatGoalAmount(Number.NaN, 'USD')).toBeNull()
    expect(displayGoalAmount(5_000, undefined)).toBe('—')
    expect(formatGoalAmount(5_000, 'MXN')).toBe('MX$50.00')
  })
})
