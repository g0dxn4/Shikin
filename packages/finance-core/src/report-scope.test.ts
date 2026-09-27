import { describe, expect, it } from 'vitest'
import {
  inspectReportScope,
  matchesReportAccount,
  matchesReportCategory,
  matchesReportTags,
  normalizeReportScope,
  reportTagKeys,
  resolveBudgetScope,
} from './report-scope.js'

describe('report scope algebra', () => {
  it('normalizes only the six fields with stable sorting and EXISTS-like tag membership', () => {
    const scope = normalizeReportScope({
      accountIds: ['b', 'a', 'a'],
      excludeAccountIds: ['b'],
      categoryIds: ['food', null, 'food'],
      excludeCategoryIds: ['food'],
      tags: [' BUSINESS ', 'business', 'Travel   Fun'],
      excludeTags: ['private'],
    })
    expect(scope.accountIds).toEqual(['a', 'b'])
    expect(scope.categoryIds).toEqual([null, 'food'])
    expect(scope.tags).toEqual(['business', 'travel fun'])
    expect(matchesReportAccount(scope, 'a')).toBe(true)
    expect(matchesReportAccount(scope, 'b')).toBe(false)
    expect(matchesReportCategory(scope, null)).toBe(true)
    expect(matchesReportCategory(scope, 'food')).toBe(false)
    expect(matchesReportCategory(scope, 'food-child')).toBe(false)
    expect(
      matchesReportTags(
        scope,
        reportTagKeys(
          '[{"key":"business","label":"BUSINESS"},{"name":"Business"},{"value":"business"}]'
        )
      )
    ).toBe(true)
    expect(matchesReportTags(scope, ['business', 'private'])).toBe(false)
    expect(normalizeReportScope(scope)).toEqual(scope)
  })
  it('does not turn malformed or dangling scope into unrestricted/complete zero', () => {
    for (const value of [
      new Date(),
      new Map(),
      null,
      'broken JSON',
      [],
      { categoryIds: 'food' },
      { tags: [null] },
      { descendants: true },
      { categoryIds: [' '] },
    ]) {
      expect(inspectReportScope(value, { accounts: [], categories: [] })).toMatchObject({
        scope: null,
        issues: [{ code: 'malformed_scope' }],
      })
    }
    expect(
      inspectReportScope(
        { accountIds: ['lost'], excludeCategoryIds: ['deleted'] },
        { accounts: [], categories: [] }
      ).issues.map((issue) => issue.code)
    ).toEqual(['missing_account', 'missing_category'])
  })
  it('preserves omitted scopes, replaces explicit scopes and rejects conflicting category shorthand', () => {
    expect(resolveBudgetScope({ storedCategoryId: 'food' }).scope.categoryIds).toEqual(['food'])
    expect(
      resolveBudgetScope({ storedScope: {}, storedCategoryId: 'food' }).scope.categoryIds
    ).toEqual(['food'])
    expect(
      resolveBudgetScope({ storedScope: { tags: ['business'] }, storedCategoryId: 'food' }).scope
    ).toMatchObject({ categoryIds: ['food'], tags: ['business'] })
    expect(
      resolveBudgetScope({ storedScope: { categoryIds: [] }, storedCategoryId: 'food' }).scope
        .categoryIds
    ).toEqual([])
    expect(
      resolveBudgetScope({ storedScope: {}, storedCategoryId: 'food', scope: {} }).scope.categoryIds
    ).toEqual([])
    const storedScope = { accountIds: ['bank'], tags: ['business'], categoryIds: ['food'] }
    expect(resolveBudgetScope({ storedScope, categoryId: 'rent' }).scope).toMatchObject({
      categoryIds: ['rent'],
      accountIds: ['bank'],
      tags: ['business'],
    })
    expect(resolveBudgetScope({ storedScope, scope: {} }).scope).toEqual(normalizeReportScope({}))
    expect(
      resolveBudgetScope({ scope: { tags: ['business'] }, categoryId: 'food' }).categoryId
    ).toBe('food')
    expect(
      resolveBudgetScope({ scope: { categoryIds: ['food', 'food'] }, categoryId: 'food' })
        .categoryId
    ).toBe('food')
    expect(() =>
      resolveBudgetScope({ scope: { categoryIds: ['food', 'rent'] }, categoryId: 'food' })
    ).toThrow('conflicts')
    expect(resolveBudgetScope({ scope: { categoryIds: [null] } }).scope.categoryIds).toEqual([null])
    expect(resolveBudgetScope({ storedScope, categoryId: null }).scope.categoryIds).toEqual([])
    expect(() => resolveBudgetScope({ storedScope: '{invalid' })).toThrow()
  })
})
