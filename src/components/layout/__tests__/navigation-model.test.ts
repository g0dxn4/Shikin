import { describe, expect, it } from 'vitest'
import {
  NAVIGATION_GROUPS,
  NAVIGATION_ROUTES,
  getNavigationGroup,
  getNavigationRoute,
} from '../navigation-model'

const EXPECTED_ROUTES = [
  '/',
  '/transactions',
  '/categories',
  '/accounts',
  '/investments',
  '/receivables',
  '/budgets',
  '/goals',
  '/bills',
  '/bill-calendar',
  '/debt-payoff',
  '/forecast',
  '/insights',
  '/reports',
  '/net-worth',
  '/spending-insights',
  '/spending-heatmap',
  '/settings',
  '/extensions',
]

describe('navigation model', () => {
  it('contains six groups and every production route exactly once', () => {
    expect(NAVIGATION_GROUPS.map((group) => group.id)).toEqual([
      'overview',
      'transactions',
      'accounts',
      'planning',
      'insights',
      'settings',
    ])
    expect(NAVIGATION_ROUTES.map((route) => route.path)).toEqual(EXPECTED_ROUTES)
    expect(new Set(NAVIGATION_ROUTES.map((route) => route.path)).size).toBe(19)
  })

  it('resolves route titles and active groups', () => {
    expect(getNavigationRoute('/bill-calendar').fallbackLabel).toBe('Bill calendar')
    expect(getNavigationGroup('/bill-calendar').id).toBe('planning')
    expect(getNavigationGroup('/extensions').id).toBe('settings')
  })
})
