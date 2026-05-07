/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { query, execute, transaction } from '../database.js'
import { generateId } from '../ulid.js'
import { toCentavos, fromCentavos } from '../money.js'
import { readNote, writeNote, appendNote, noteExists, listNotes } from '../notebook.js'
import { isSafeNotebookPathInput } from '../notebook-path.js'
import dayjs from 'dayjs'

export {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  readNote,
  writeNote,
  appendNote,
  noteExists,
  listNotes,
  dayjs,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string
  description: string
  schema: z.ZodObject<any>
  execute: (input: any) => Promise<any>
  cliUnavailableMessage?: string
  mcpUnavailableMessage?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function nextDateForDay(day: number): dayjs.Dayjs {
  const today = dayjs()
  const thisMonth = today.date(Math.min(day, today.daysInMonth()))
  if (thisMonth.isAfter(today) || thisMonth.isSame(today, 'day')) {
    return thisMonth
  }
  const nextMonth = today.add(1, 'month')
  return nextMonth.date(Math.min(day, nextMonth.daysInMonth()))
}

export function advanceDate(current: string, frequency: string): string {
  const d = dayjs(current)
  switch (frequency) {
    case 'daily':
      return d.add(1, 'day').format('YYYY-MM-DD')
    case 'weekly':
      return d.add(1, 'week').format('YYYY-MM-DD')
    case 'biweekly':
      return d.add(2, 'week').format('YYYY-MM-DD')
    case 'monthly':
      return d.add(1, 'month').format('YYYY-MM-DD')
    case 'quarterly':
      return d.add(3, 'month').format('YYYY-MM-DD')
    case 'yearly':
      return d.add(1, 'year').format('YYYY-MM-DD')
    default:
      return d.add(1, 'month').format('YYYY-MM-DD')
  }
}

const MAX_ABSOLUTE_AMOUNT = 1_000_000_000
const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/
const ASSET_CODE_PATTERN = /^[A-Z0-9]{2,10}$/
const ACCOUNT_ALIASES_SETTING_KEY = 'account_aliases'
const ACCOUNT_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const FINANCE_PROFILE_SETTING_KEY = 'finance_profile'

export function boundedText(label: string, description: string, maxLength = 255) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer`)
    .describe(description)
}

export function isoDate(description: string) {
  return z
    .string()
    .trim()
    .regex(ISO_DATE_PATTERN, 'Date must be in YYYY-MM-DD format')
    .refine(isStrictIsoDate, 'Date must be a real calendar date')
    .describe(description)
}

export function currencyCode(description: string) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .regex(CURRENCY_CODE_PATTERN, 'Currency code must be a 3-letter ISO code')
    .describe(description)
}

export function notebookPathSchema(description: string, options?: { allowEmpty?: boolean }) {
  return z
    .string()
    .trim()
    .refine(
      (value) => isSafeNotebookPathInput(value, options),
      'Path must stay within the notebook'
    )
    .describe(description)
}

export function assetCode(description: string) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .regex(ASSET_CODE_PATTERN, 'Code must be 2-10 uppercase letters or digits')
    .describe(description)
}

export function moneyAmount(
  description: string,
  { min = -MAX_ABSOLUTE_AMOUNT, max = MAX_ABSOLUTE_AMOUNT }: { min?: number; max?: number } = {}
): z.ZodNumber {
  return z.number().finite().min(min).max(max).describe(description)
}

export function positiveMoneyAmount(description: string, max = MAX_ABSOLUTE_AMOUNT): z.ZodNumber {
  return z.number().finite().positive().max(max).describe(description)
}

export function nonNegativeMoneyAmount(
  description: string,
  max = MAX_ABSOLUTE_AMOUNT
): z.ZodNumber {
  return moneyAmount(description, { min: 0, max })
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== 'string' || value.trim() === '') return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch (error) {
    throw new Error(
      `Could not serialize value as JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}

function normalizeSettingKey(key: string): string {
  const normalized = key.trim()
  if (!normalized) {
    throw new Error('Setting key is required.')
  }
  return normalized
}

export function getJsonSetting<T>(key: string, fallback: T): T {
  const settingKey = normalizeSettingKey(key)
  const row = query<{ value: string }>('SELECT value FROM settings WHERE key = $1 LIMIT 1', [
    settingKey,
  ])[0]

  return safeJsonParse(row?.value, fallback)
}

export function setJsonSetting(key: string, value: unknown): void {
  const settingKey = normalizeSettingKey(key)
  execute(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [settingKey, safeJsonStringify(value)]
  )
}

type AuditLogInput = {
  entity: string
  entityId?: string | null
  action: string
  before?: unknown
  after?: unknown
  source?: string | null
  note?: string | null
  createdAt?: string
}

function requireNonEmptyText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required.`)
  }
  return normalized
}

function optionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

export function writeAuditLog(input: AuditLogInput): { id: string; createdAt: string } {
  const id = generateId()
  const createdAt = input.createdAt ?? dayjs().toISOString()

  execute(
    `INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      requireNonEmptyText(input.entity, 'Audit entity'),
      optionalText(input.entityId),
      requireNonEmptyText(input.action, 'Audit action'),
      input.before === undefined ? null : safeJsonStringify(input.before),
      input.after === undefined ? null : safeJsonStringify(input.after),
      optionalText(input.source),
      optionalText(input.note),
      createdAt,
    ]
  )

  return { id, createdAt }
}

export function normalizeAccountAlias(value: string): string {
  return value.trim().toLowerCase()
}

export function validateAccountAlias(value: string): boolean {
  return ACCOUNT_ALIAS_PATTERN.test(normalizeAccountAlias(value))
}

export function getAccountAliases(): Record<string, string> {
  const parsed = getJsonSetting<unknown>(ACCOUNT_ALIASES_SETTING_KEY, {})
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(
      ([alias, accountId]) => validateAccountAlias(alias) && typeof accountId === 'string'
    )
  ) as Record<string, string>
}

export function setAccountAlias(accountId: string, alias: string) {
  const normalizedAlias = normalizeAccountAlias(alias)
  if (!validateAccountAlias(normalizedAlias)) {
    return {
      success: false as const,
      message:
        'Alias must start with a letter or number and use only lowercase letters, numbers, dots, underscores, or hyphens.',
    }
  }

  const aliases = getAccountAliases()
  const existingAccountId = aliases[normalizedAlias]
  if (existingAccountId && existingAccountId !== accountId) {
    return {
      success: false as const,
      reason: 'alias_conflict' as const,
      message: `Alias "${normalizedAlias}" already points to account ${existingAccountId}. Remove or choose a different alias before reassigning it.`,
    }
  }

  aliases[normalizedAlias] = accountId
  setJsonSetting(ACCOUNT_ALIASES_SETTING_KEY, aliases)

  return { success: true as const, alias: normalizedAlias, accountId }
}

export function removeAccountAliasesForAccount(accountId: string): string[] {
  const aliases = getAccountAliases()
  const removedAliases = Object.entries(aliases)
    .filter(([, aliasedAccountId]) => aliasedAccountId === accountId)
    .map(([alias]) => alias)
    .sort()

  if (removedAliases.length === 0) return []

  for (const alias of removedAliases) {
    delete aliases[alias]
  }
  setJsonSetting(ACCOUNT_ALIASES_SETTING_KEY, aliases)

  return removedAliases
}

type ResolvedAccountRow = { id: string; name?: string; currency: string; is_archived: number }

function archivedAccountFailure(account: string) {
  return {
    success: false as const,
    message: `Account ${account} is archived. Unarchive it before using it for new writes.`,
  }
}

function resolveAccountAlias(account: string) {
  const normalizedAlias = normalizeAccountAlias(account)
  const aliases = getAccountAliases()
  const aliasedAccountId = aliases[normalizedAlias]
  if (!aliasedAccountId) return null

  const accounts = query<ResolvedAccountRow>(
    'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
    [aliasedAccountId]
  )

  if (accounts.length === 0) {
    return {
      success: false as const,
      message: `Account alias "${normalizedAlias}" points to missing account ${aliasedAccountId}.`,
    }
  }

  if (accounts[0].is_archived === 1) {
    return archivedAccountFailure(`alias "${normalizedAlias}"`)
  }

  return { success: true as const, id: accounts[0].id, currency: accounts[0].currency }
}

function resolveAccountReference(account: string) {
  const aliasMatch = resolveAccountAlias(account)
  if (aliasMatch) return aliasMatch

  const accounts = query<ResolvedAccountRow>(
    `SELECT id, name, currency, is_archived
     FROM accounts
     WHERE id = $1 OR LOWER(name) = LOWER($2)
     ORDER BY name ASC, id ASC
     LIMIT 2`,
    [account, account]
  )

  const activeAccounts = accounts.filter((row) => row.is_archived !== 1)

  if (activeAccounts.length === 1) {
    return {
      success: true as const,
      id: activeAccounts[0].id,
      currency: activeAccounts[0].currency,
    }
  }

  if (activeAccounts.length > 1) {
    return {
      success: false as const,
      message: `Account "${account}" matches multiple accounts. Use accountId or define a unique alias.`,
    }
  }

  if (accounts.length > 0) {
    return archivedAccountFailure(`"${account}"`)
  }

  return {
    success: false as const,
    message: `Account alias, ID, or name "${account}" not found.`,
  }
}

export function resolveAccountId(accountId?: string, account?: string) {
  if (accountId) {
    const accounts = query<ResolvedAccountRow>(
      'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
      [accountId]
    )

    if (accounts.length === 0) {
      return { success: false as const, message: `Account ${accountId} not found.` }
    }

    if (accounts[0].is_archived === 1) {
      return archivedAccountFailure(accountId)
    }

    return { success: true as const, id: accounts[0].id, currency: accounts[0].currency }
  }

  if (account) {
    return resolveAccountReference(account)
  }

  const accounts = query<ResolvedAccountRow>(
    'SELECT id, name, currency, is_archived FROM accounts WHERE is_archived = 0 ORDER BY name ASC, id ASC LIMIT 2'
  )

  if (accounts.length === 0) {
    return {
      success: false as const,
      message: 'No accounts found. Please create an account first.',
    }
  }

  if (accounts.length > 1) {
    return {
      success: false as const,
      message:
        'Multiple accounts found. Provide accountId explicitly so Shikin does not guess the wrong account.',
    }
  }

  return { success: true as const, id: accounts[0].id, currency: accounts[0].currency }
}

export function recurringRulesHasCurrencyColumn() {
  return query<{ name: string }>('PRAGMA table_info(recurring_rules)').some(
    (column) => column.name === 'currency'
  )
}

export function crossCurrencyMoveMessage(
  kind: 'transaction' | 'recurring rule',
  from: string,
  to: string
) {
  return `Cannot move this ${kind} from ${from} to ${to}. Cross-currency moves are not supported because they would change amount semantics without FX conversion.`
}

export function unknownRecurringRuleCurrencyFailure(rule: {
  id: string
  description?: string | null
}) {
  const label = rule.description
    ? `Recurring rule "${rule.description}"`
    : `Recurring rule ${rule.id}`
  return {
    success: false as const,
    reason: 'unknown_rule_currency',
    message: `${label} has no stored currency. Repair or recreate the rule before moving or materializing it.`,
  }
}

export function unknownTransactionCurrencyFailure(tx: { id: string; description?: string | null }) {
  const label = tx.description ? `Transaction "${tx.description}"` : `Transaction ${tx.id}`
  return {
    success: false as const,
    reason: 'unknown_transaction_currency',
    message: `${label} has no stored currency. Repair or recreate the transaction before editing it.`,
  }
}

export function unavailableToolResult(message: string) {
  return {
    success: false as const,
    message,
    error: message,
    errorType: 'unavailable_error' as const,
  }
}

export function normalizeCurrencyCode(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function recurringRuleAccountCurrencyChangeBlockedMessage(ruleCount: number) {
  return `Cannot change this account currency while ${ruleCount} recurring rule(s) still point at the account. Repair, move, or recreate those recurring rules first so scheduled amounts do not silently change meaning.`
}

export function invalidAccountCurrencyMessage(accountId: string) {
  return `Account ${accountId} has no valid stored currency. Repair the account currency before creating or updating recurring rules.`
}

export function unsupportedRecurringTransferFailure() {
  return {
    success: false as const,
    reason: 'unsupported_recurring_transfer',
    message:
      'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.',
  }
}

export function getDistinctCurrencies(rows: Array<{ currency: string }>): string[] {
  return [...new Set(rows.map((row) => row.currency).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
}

export function getCategoryIdentity(categoryId: string | null, categoryName: string) {
  return {
    category:
      categoryId === null
        ? 'Uncategorized'
        : categoryName === 'Uncategorized'
          ? 'Uncategorized (category)'
          : categoryName,
    categoryKey: categoryId ?? '__uncategorized__',
  }
}

export function missingCurrencyRepairFailure(toolLabel: string) {
  return {
    success: false as const,
    reason: 'repair_needed_missing_currency',
    message: `${toolLabel} encountered rows with missing currency. Repair or recreate the affected data before using this summary.`,
  }
}

export function hasMissingCurrency(rows: Array<{ currency: string | null | undefined }>) {
  return rows.some((row) => !row.currency)
}

export function resolveCategoryId(category?: string) {
  if (!category) {
    return { success: true as const, id: null, name: null }
  }

  const exactMatches = query<{ id: string; name: string }>(
    'SELECT id, name FROM categories WHERE LOWER(name) = LOWER($1) ORDER BY name ASC LIMIT 2',
    [category]
  )

  if (exactMatches.length === 1) {
    return {
      success: true as const,
      id: exactMatches[0].id,
      name: exactMatches[0].name,
    }
  }

  if (exactMatches.length > 1) {
    return {
      success: false as const,
      message: `Category "${category}" is ambiguous. Use a more specific existing category name.`,
    }
  }

  const partialMatches = query<{ id: string; name: string }>(
    'SELECT id, name FROM categories WHERE LOWER(name) LIKE LOWER($1) ORDER BY name ASC LIMIT 3',
    [`%${category}%`]
  )

  if (partialMatches.length === 1) {
    return {
      success: true as const,
      id: partialMatches[0].id,
      name: partialMatches[0].name,
    }
  }

  if (partialMatches.length > 1) {
    return {
      success: false as const,
      message: `Category "${category}" matches multiple categories (${partialMatches
        .map((match) => match.name)
        .join(', ')}). Use a more specific existing category name.`,
    }
  }

  return {
    success: false as const,
    message: `Category "${category}" not found. Use list-categories to pick an existing category name.`,
  }
}

function isStrictIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false

  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
