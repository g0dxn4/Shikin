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
  isSafeNotebookPathInput,
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

export function unsupportedTransferMessage() {
  return (
    'Transfer transactions are not fully supported in the CLI yet. ' +
    'Record the withdrawal and deposit as separate entries with explicit account IDs.'
  )
}

export function resolveAccountId(accountId?: string) {
  if (accountId) {
    const accounts = query<{ id: string; currency: string }>(
      'SELECT id, currency FROM accounts WHERE id = $1 LIMIT 1',
      [accountId]
    )

    if (accounts.length === 0) {
      return { success: false as const, message: `Account ${accountId} not found.` }
    }

    return { success: true as const, id: accounts[0].id, currency: accounts[0].currency }
  }

  const accounts = query<{ id: string; name: string; currency: string }>(
    'SELECT id, name, currency FROM accounts ORDER BY name ASC, id ASC LIMIT 2'
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

export function isStrictIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false

  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
