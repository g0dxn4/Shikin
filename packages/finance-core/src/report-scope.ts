/** Exact allocation categories; source accounts and recognition-transaction tags only. */
export interface ReportScope {
  accountIds?: readonly string[]
  excludeAccountIds?: readonly string[]
  categoryIds?: readonly (string | null)[]
  excludeCategoryIds?: readonly (string | null)[]
  tags?: readonly string[]
  excludeTags?: readonly string[]
}
export interface NormalizedReportScope {
  accountIds: string[]
  excludeAccountIds: string[]
  categoryIds: (string | null)[]
  excludeCategoryIds: (string | null)[]
  tags: string[]
  excludeTags: string[]
}
export interface ReportScopeIssue {
  code: 'malformed_scope' | 'missing_account' | 'missing_category'
  id: string | null
  message: string
}
const keys = [
  'accountIds',
  'excludeAccountIds',
  'categoryIds',
  'excludeCategoryIds',
  'tags',
  'excludeTags',
] as const
const compare = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1

/** Same trimmed, whitespace-collapsed, case-insensitive label/key policy as transaction tags. */
export function normalizeReportTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}
export function normalizeReportScope(value: unknown = {}): NormalizedReportScope {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Scope must be an object.')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !keys.includes(key as (typeof keys)[number])))
    throw new Error('Unsupported scope field.')
  const result = {} as NormalizedReportScope
  for (const key of keys) {
    const values = record[key] === undefined ? [] : record[key]
    if (!Array.isArray(values)) throw new Error(`${key} must be an array.`)
    const category = key === 'categoryIds' || key === 'excludeCategoryIds'
    const tags = key === 'tags' || key === 'excludeTags'
    const normalized = values.map((item: unknown) => {
      if (category && item === null) return null
      if (typeof item !== 'string' || !item.trim())
        throw new Error(`${key} requires non-empty strings${category ? ' or null' : ''}.`)
      return tags ? normalizeReportTag(item) : item.trim()
    })
    Object.assign(result, { [key]: [...new Set(normalized)].sort(compare) })
  }
  return result
}

/** Stored JSON is parsed by the loader; malformed JSON must not be replaced with {}. */
export function inspectReportScope(
  value: unknown,
  references: {
    accounts: readonly { id: string }[]
    categories: readonly { id: string }[]
  }
): { scope: NormalizedReportScope | null; issues: ReportScopeIssue[] } {
  let scope: NormalizedReportScope
  try {
    scope = normalizeReportScope(value)
  } catch (error) {
    return { scope: null, issues: [{ code: 'malformed_scope', id: null, message: String(error) }] }
  }
  const issues: ReportScopeIssue[] = []
  for (const id of new Set([...scope.accountIds, ...scope.excludeAccountIds])) {
    if (!references.accounts.some((row) => row.id === id))
      issues.push({ code: 'missing_account', id, message: `Scope account ${id} is missing.` })
  }
  for (const id of new Set([...scope.categoryIds, ...scope.excludeCategoryIds])) {
    if (id !== null && !references.categories.some((row) => row.id === id))
      issues.push({ code: 'missing_category', id, message: `Scope category ${id} is missing.` })
  }
  return { scope, issues }
}

/** Omitted scope preserves; supplied {} replaces. Missing legacy categoryIds uses the FK mirror. */
export function resolveBudgetScope(input: {
  storedScope?: unknown
  storedCategoryId?: string | null
  scope?: unknown
  categoryId?: string | null
}): { scope: NormalizedReportScope; categoryId: string | null } {
  const explicitScope = input.scope !== undefined
  const base = explicitScope
    ? input.scope
    : (input.storedScope ??
      (input.storedCategoryId ? { categoryIds: [input.storedCategoryId] } : {}))
  let scope = normalizeReportScope(base)
  if (
    !explicitScope &&
    input.storedCategoryId &&
    !Object.prototype.hasOwnProperty.call(base, 'categoryIds')
  ) {
    scope = normalizeReportScope({ ...scope, categoryIds: [input.storedCategoryId] })
  }
  if (input.categoryId !== undefined) {
    const categories = input.categoryId === null ? [] : [input.categoryId.trim()]
    if (input.categoryId !== null && !categories[0])
      throw new Error('categoryId must not be empty.')
    if (
      explicitScope &&
      Object.prototype.hasOwnProperty.call(input.scope, 'categoryIds') &&
      JSON.stringify(scope.categoryIds) !== JSON.stringify(categories)
    )
      throw new Error('categoryId conflicts with scope.categoryIds.')
    scope = { ...scope, categoryIds: categories }
  }
  return { scope, categoryId: scope.categoryIds.length === 1 ? scope.categoryIds[0]! : null }
}

/** JSON strings or parsed arrays, including legacy key/label/name/value objects. */
export function reportTagKeys(value: unknown): string[] {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim()))
    return []
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed)) throw new Error('Transaction tags must be an array.')
  return [
    ...new Set(
      parsed
        .flatMap((tag: unknown) => {
          if (typeof tag === 'string') return [normalizeReportTag(tag)]
          if (tag && typeof tag === 'object')
            return ['key', 'label', 'name', 'value'].flatMap((key) => {
              const text = (tag as Record<string, unknown>)[key]
              return typeof text === 'string' ? [normalizeReportTag(text)] : []
            })
          return []
        })
        .filter(Boolean)
    ),
  ].sort()
}
export function matchesReportAccount(
  scope: NormalizedReportScope,
  accountId: string | null
): boolean {
  return (
    (scope.accountIds.length === 0 ||
      (accountId !== null && scope.accountIds.includes(accountId))) &&
    (accountId === null || !scope.excludeAccountIds.includes(accountId))
  )
}
export function matchesReportCategory(
  scope: NormalizedReportScope,
  categoryId: string | null
): boolean {
  return (
    (scope.categoryIds.length === 0 || scope.categoryIds.includes(categoryId)) &&
    !scope.excludeCategoryIds.includes(categoryId)
  )
}
export function matchesReportTags(scope: NormalizedReportScope, tags: readonly string[]): boolean {
  return (
    (scope.tags.length === 0 || scope.tags.some((tag) => tags.includes(tag))) &&
    !scope.excludeTags.some((tag) => tags.includes(tag))
  )
}
