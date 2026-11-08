import { query } from './tools/shared.js'
import { REDACTED_VALUE, isPlainObject } from './audit-read.js'

/*
Automation context source inventory (kept here so future maintainers can audit each section):
- setup: direct `setup-status` tool execute from `cli/src/tools/setup-status.ts` (no CLI shell), which reads counts from accounts/categories/transactions/budgets/recurring_rules/subscriptions, goal/debt/investment support surfaces, credit-card billing-date gaps, account_aliases/finance_profile/database_backups settings, and account_balance_history freshness.
- accounts: SQL `SELECT id, name, type, currency, balance, is_archived, is_primary, credit_limit, statement_closing_day, payment_due_day FROM accounts WHERE is_archived = 0 ORDER BY is_primary DESC, name ASC, id ASC` plus `getAccountAliases()` from settings key `account_aliases`.
- financeProfile: `getJsonSetting(FINANCE_PROFILE_SETTING_KEY)` from settings key `finance_profile`.
- budgets: SQL `SELECT b.id, b.name, b.amount, b.period, b.category_id, b.is_active, c.name AS category_name FROM budgets b LEFT JOIN categories c ON c.id = b.category_id WHERE b.is_active = 1 ORDER BY b.period ASC, b.name ASC, b.id ASC`.
- subscriptions: SQL `SELECT s.*, a.name AS account_name, c.name AS category_name FROM subscriptions s LEFT JOIN accounts a ON a.id = s.account_id LEFT JOIN categories c ON c.id = s.category_id WHERE s.is_active = 1 ORDER BY s.next_billing_date ASC, s.name ASC, s.id ASC`.
- creditCards: SQL `SELECT id, name, currency, balance, credit_limit, statement_closing_day, payment_due_day FROM accounts WHERE type = 'credit_card' AND is_archived = 0 ORDER BY name ASC, id ASC` plus SQL `SELECT s.*, a.name AS account_name FROM credit_card_statements s JOIN accounts a ON a.id = s.account_id WHERE a.type = 'credit_card' AND a.is_archived = 0 ORDER BY s.due_date ASC, s.statement_end_date DESC, s.id ASC LIMIT 50`; due summaries use the same centavo payment math as credit-card tools.
- recurring: direct `get-recurring-expected-vs-paid` tool execute from `cli/src/tools/recurring.ts` for the next 30 days (no CLI shell).
- support.goals: SQL `SELECT g.id, g.name, g.target_amount, g.current_amount, g.deadline, g.account_id, g.notes, a.name AS account_name FROM goals g LEFT JOIN accounts a ON a.id = g.account_id ORDER BY g.deadline IS NULL ASC, g.deadline ASC, g.name ASC, g.id ASC`; mirrors existing `get-goal-status` table shape without invoking CLI. Display rows are capped after summaries are computed.
- support.debt: SQL `SELECT id, name, currency, balance, credit_limit, statement_closing_day, payment_due_day FROM accounts WHERE type = 'credit_card' AND is_archived = 0 AND balance < 0 ORDER BY ABS(balance) DESC, name ASC, id ASC`; mirrors existing `get-debt-payoff-plan` source and its no-APR limitation.
- support.investments: SQL `SELECT id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes FROM investments ORDER BY symbol ASC, id ASC`; no investment feature expansion or price fetching; discoverability points to `list-investments`, `manage-investment`, and `generate-portfolio-review` tools. Display rows are capped after summaries are computed.
- recentAuditEntries: SQL `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT $1` via the shared audit formatter in `cli/src/audit-read.ts`.
*/
export type AccountContextRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
  is_archived?: number | null
  is_primary?: number | null
  credit_limit?: number | null
  statement_closing_day?: number | null
  payment_due_day?: number | null
  account_mode?: 'transactional' | 'snapshot_only' | null
}

export type SubscriptionContextRow = {
  id: string
  account_id: string | null
  category_id: string | null
  name: string
  amount: number
  currency: string
  billing_cycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  next_billing_date: string
  url: string | null
  notes: string | null
  is_active: number
  account_name: string | null
  category_name: string | null
}

export type CreditCardStatementContextRow = {
  id: string
  account_id: string
  statement_start_date: string | null
  statement_end_date: string
  due_date: string
  statement_balance: number
  minimum_payment: number
  paid_amount: number
  unattributed_paid_amount: number
  currency: string
  status: 'open' | 'partial' | 'paid' | 'overdue'
  source: string | null
  note: string | null
  account_name: string | null
}

const REDACTED_KEY_PATTERN =
  /(?:account[_-]?number|routing[_-]?number|card[_-]?number|iban|swift|secret|token|password|private[_-]?key|name|title|description|notes?|source|url|value|summary|memo|content|pattern|tags|path|file|before_json|after_json)/i

function count(sql: string, params?: unknown[]): number {
  return query<{ count: number }>(sql, params)[0]?.count ?? 0
}

export function tableExists(tableName: string): boolean {
  return (
    count("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = $1", [
      tableName,
    ]) > 0
  )
}

function safeTableName(tableName: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
    throw new Error(`Unsafe table name ${tableName}`)
  }

  return tableName
}

export function tableHasColumns(tableName: string, columns: string[]): boolean {
  if (!tableExists(tableName)) return false

  const rows = query<{ name: string }>(`PRAGMA table_info(${safeTableName(tableName)})`)
  const existing = new Set(rows.map((row) => row.name))
  return columns.every((column) => existing.has(column))
}

function redactStructuredValue(value: unknown, parentKey?: string): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => redactStructuredValue(item, parentKey))
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactStructuredValue(nested, key)])
    )
  }
  if (typeof value === 'string') {
    return !parentKey || REDACTED_KEY_PATTERN.test(parentKey) ? REDACTED_VALUE : value
  }

  return value
}

export function maybeRedactObject<T>(value: T, redacted: boolean): T | unknown {
  return redacted ? redactStructuredValue(value) : value
}
