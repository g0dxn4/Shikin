import { describe, expect, it } from 'vitest'
import { accountHistoryMaxDateTicks } from '@/components/accounts/account-history-batch'
import {
  overviewChartLocale,
  overviewDateTickBudget,
} from '@/components/dashboard/overview-chart-policy'

describe('overviewDateTickBudget', () => {
  it('uses two labels at 320, three at 375, and five on desktop', () => {
    expect(overviewDateTickBudget(286)).toBe(2)
    expect(overviewDateTickBudget(320)).toBe(2)
    expect(overviewDateTickBudget(329)).toBe(2)
    expect(overviewDateTickBudget(341)).toBe(3)
    expect(overviewDateTickBudget(375)).toBe(3)
    expect(overviewDateTickBudget(767)).toBe(3)
    expect(overviewDateTickBudget(768)).toBe(5)
    expect(overviewDateTickBudget(1600)).toBe(5)
    expect(overviewDateTickBudget(0)).toBe(5)
    expect(overviewDateTickBudget(Number.NaN)).toBe(5)
  })

  it('preserves nonfinite, signed-zero, and exact breakpoint budgets', () => {
    expect(
      [Number.NaN, Infinity, -Infinity, -1, -0, 0, 1, 329.999, 330, 767.999, 768, 1600].map(
        overviewDateTickBudget
      )
    ).toEqual([5, 5, 5, 5, 5, 5, 2, 2, 3, 3, 5, 5])
  })

  it('keeps the distinct account-history plot thresholds', () => {
    expect([Number.NaN, 320, 500].map(overviewDateTickBudget)).toEqual([5, 2, 3])
    expect([Number.NaN, 320, 500].map(accountHistoryMaxDateTicks)).toEqual([2, 3, 5])
  })
})

describe('overviewChartLocale', () => {
  it.each([
    [undefined, 'en'],
    ['', 'en'],
    ['  ', 'en'],
    ['\t\n', 'en'],
    ['en', 'en'],
    [' es-MX ', 'es-MX'],
    ['invalid!', 'invalid!'],
  ])('keeps locale %s as %s without validating the tag', (language, expected) => {
    expect(overviewChartLocale(language)).toBe(expected)
  })
})
