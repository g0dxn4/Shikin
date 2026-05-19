import {
  z,
  query,
  execute,
  transaction,
  fromCentavos,
  dayjs,
  nextDateForDay,
  boundedText,
  isoDate,
  resolveAccountId,
  getAccountAliases,
  getJsonSetting,
  writeAuditLog,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'
import { setupStatusTools } from './setup-status.js'
import { recurringTools } from './recurring.js'
import { findTransactionDuplicate, transactionDuplicateReason } from '../duplicate-detection.js'

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
- support.investments: SQL `SELECT id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes FROM investments ORDER BY symbol ASC, id ASC`; no investment feature expansion or price fetching; discoverability points to existing `manage-investment` and `generate-portfolio-review` tools. Display rows are capped after summaries are computed.
- recentAuditEntries: SQL `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT $1` via the shared audit formatter in this module.
*/

type AuditLogRow = {
  id: string
  entity: string
  entity_id: string | null
  action: string
  before_json: string | null
  after_json: string | null
  source: string | null
  note: string | null
  created_at: string
}

type AccountContextRow = {
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
}

type BudgetContextRow = {
  id: string
  name: string
  amount: number
  period: string
  category_id: string | null
  category_name: string | null
  is_active: number
}

type SubscriptionContextRow = {
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

type CreditCardAccountContextRow = {
  id: string
  name: string
  currency: string
  balance: number
  credit_limit: number | null
  statement_closing_day: number | null
  payment_due_day: number | null
}

type CreditCardStatementContextRow = {
  id: string
  account_id: string
  statement_start_date: string | null
  statement_end_date: string
  due_date: string
  statement_balance: number
  minimum_payment: number
  paid_amount: number
  currency: string
  status: 'open' | 'partial' | 'paid' | 'overdue'
  source: string | null
  note: string | null
  account_name: string | null
}

type GoalContextRow = {
  id: string
  name: string
  target_amount: number
  current_amount: number
  deadline: string | null
  account_id: string | null
  notes: string | null
  account_name: string | null
}

type InvestmentContextRow = {
  id: string
  account_id: string | null
  symbol: string
  name: string
  type: string
  shares: number
  avg_cost_basis: number
  currency: string
  notes: string | null
}

type ContextWarning = {
  section: string
  key?: string
  severity: 'warning' | 'gap'
  message: string
  hint?: string
}

type UndoSupportedEntity = 'transaction' | 'credit_card_statement'
type UndoSupportedAction = 'create' | 'update' | 'delete'

type UndoTransactionSnapshot = {
  id: string
  accountId: string
  categoryId: string | null
  transferToAccountId: string | null
  type: 'expense' | 'income' | 'transfer'
  amountCentavos: number
  currency: string | null
  description: string
  notes: string | null
  status: 'pending' | 'posted' | 'cleared'
  source: string | null
  note: string | null
  recurringRuleId: string | null
  tags: string[]
  isPlaceholder: boolean
  placeholderStatus: string | null
  resolvedAt: string | null
  resolvedByTransactionId: string | null
  placeholderReason: string | null
  placeholderParentTransactionId: string | null
  date: string
}

type UndoStatementSnapshot = {
  id: string
  accountId: string
  statementStartDate: string | null
  statementEndDate: string
  dueDate: string
  statementBalanceCentavos: number
  minimumPaymentCentavos: number
  paidAmountCentavos: number
  currency: string
  status: 'open' | 'partial' | 'paid' | 'overdue'
  source: string | null
  note: string | null
}

type UndoPlan = {
  entity: UndoSupportedEntity
  entityId: string
  action: UndoSupportedAction
  inverseAction: 'create' | 'update' | 'delete'
  beforeUndo: unknown
  afterUndo: unknown
  balanceImpact: ReturnType<typeof formatUndoBalanceImpact>
}

type FinanceSanityFinding = {
  severity: 'info' | 'warning' | 'critical'
  type: string
  message: string
  [key: string]: unknown
}

const DEFAULT_AUDIT_LIMIT = 25
const MAX_AUDIT_LIMIT = 200
const ASSISTANT_CONTEXT_AUDIT_LIMIT = 10
const ASSISTANT_CONTEXT_RECURRING_DAYS = 30
const ASSISTANT_CONTEXT_ITEM_LIMIT = 50
const UNDO_CANDIDATE_LIMIT = 200
const SANITY_DEFAULT_DAYS_AHEAD = 30
const SANITY_DEFAULT_LIMIT = 25
const SANITY_DEFAULT_LARGE_TRANSACTION = 1000
const GOAL_SUPPORT_TOOLS = ['create-goal', 'update-goal', 'get-goal-status'] as const
const DEBT_SUPPORT_TOOLS = ['get-debt-payoff-plan'] as const
const INVESTMENT_SUPPORT_TOOLS = ['manage-investment', 'generate-portfolio-review'] as const
const REDACTED_VALUE = '[REDACTED]'
const REDACTED_KEY_PATTERN =
  /(?:account[_-]?number|routing[_-]?number|card[_-]?number|iban|swift|secret|token|password|private[_-]?key|name|title|description|notes?|source|url|value|summary|memo|content|pattern|tags|path|file|before_json|after_json)/i
const AUDIT_STRING_ALLOWLIST = new Set([
  'id',
  'entity',
  'entityId',
  'accountId',
  'transferToAccountId',
  'categoryId',
  'subcategoryId',
  'recurringRuleId',
  'budgetId',
  'bucketId',
  'transactionId',
  'statementId',
  'subscriptionId',
  'goalId',
  'currency',
  'type',
  'status',
  'action',
  'date',
  'createdAt',
  'updatedAt',
])

function count(sql: string, params?: unknown[]): number {
  return query<{ count: number }>(sql, params)[0]?.count ?? 0
}

function tableExists(tableName: string): boolean {
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

function tableHasColumns(tableName: string, columns: string[]): boolean {
  if (!tableExists(tableName)) return false

  const rows = query<{ name: string }>(`PRAGMA table_info(${safeTableName(tableName)})`)
  const existing = new Set(rows.map((row) => row.name))
  return columns.every((column) => existing.has(column))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableJsonValue(nested)])
  )
}

function parseAuditJson(value: string | null): unknown {
  if (typeof value !== 'string' || value.trim() === '') return null

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
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

function redactAuditStructuredValue(value: unknown, parentKey?: string): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => redactAuditStructuredValue(item, parentKey))
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactAuditStructuredValue(nested, key)])
    )
  }
  if (typeof value === 'string') {
    return parentKey && AUDIT_STRING_ALLOWLIST.has(parentKey) ? value : REDACTED_VALUE
  }

  return value
}

function redactText(value: string | null | undefined, redacted: boolean): string | null {
  if (value === null || value === undefined) return null
  return redacted ? REDACTED_VALUE : value
}

function maybeRedactObject<T>(value: T, redacted: boolean): T | unknown {
  return redacted ? redactStructuredValue(value) : value
}

function formatAuditRow(row: AuditLogRow, redacted: boolean) {
  const before = parseAuditJson(row.before_json)
  const after = parseAuditJson(row.after_json)

  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    before: redacted ? redactAuditStructuredValue(before) : before,
    after: redacted ? redactAuditStructuredValue(after) : after,
    source: redactText(row.source, redacted),
    note: redactText(row.note, redacted),
    createdAt: row.created_at,
  }
}

function auditFilterInput(input: {
  since?: string
  entity?: string
  entityId?: string
  action?: string
  limit?: number
}) {
  const filters: string[] = []
  const params: unknown[] = []
  const addFilter = (sql: string, value: unknown) => {
    params.push(value)
    filters.push(sql.replace('?', `$${params.length}`))
  }

  if (input.since) addFilter('created_at >= ?', input.since)
  if (input.entity) addFilter('entity = ?', input.entity)
  if (input.entityId) addFilter('entity_id = ?', input.entityId)
  if (input.action) addFilter('action = ?', input.action)

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_AUDIT_LIMIT, 1), MAX_AUDIT_LIMIT)

  return { filters, params, limit }
}

function readAuditRows(input: {
  since?: string
  entity?: string
  entityId?: string
  action?: string
  limit?: number
  redacted: boolean
}) {
  const { filters, params, limit } = auditFilterInput(input)
  params.push(limit)
  const rows = query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  )

  return rows.map((row) => formatAuditRow(row, input.redacted))
}

function currencyTotalsSnapshot(totals: Map<string, number>) {
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountCentavos]) => ({
      currency,
      amount: fromCentavos(amountCentavos),
      amountCentavos,
    }))
}

function addCurrencyTotal(totals: Map<string, number>, currency: string, amountCentavos: number) {
  totals.set(currency, (totals.get(currency) ?? 0) + amountCentavos)
}

function monthlySubscriptionCentavos(
  amountCentavos: number,
  cycle: SubscriptionContextRow['billing_cycle']
) {
  switch (cycle) {
    case 'weekly':
      return Math.round((amountCentavos * 52) / 12)
    case 'quarterly':
      return Math.round(amountCentavos / 3)
    case 'yearly':
      return Math.round(amountCentavos / 12)
    case 'monthly':
    default:
      return amountCentavos
  }
}

function paymentAmounts(statement: CreditCardStatementContextRow) {
  const amountToPayCentavos = Math.max(statement.statement_balance - statement.paid_amount, 0)
  const minimumPaymentDueCentavos = Math.max(
    Math.min(statement.minimum_payment, statement.statement_balance) - statement.paid_amount,
    0
  )

  return {
    amountToPayCentavos,
    amountToPay: fromCentavos(amountToPayCentavos),
    minimumPaymentDueCentavos,
    minimumPaymentDue: fromCentavos(minimumPaymentDueCentavos),
  }
}

function effectiveStatementStatus(statement: CreditCardStatementContextRow) {
  const payment = paymentAmounts(statement)
  if (payment.amountToPayCentavos <= 0) return 'paid'
  if (statement.status === 'overdue' || dayjs(statement.due_date).isBefore(dayjs(), 'day')) {
    return 'overdue'
  }
  if (statement.status === 'partial' || statement.paid_amount > 0) return 'partial'
  return 'open'
}

function getAccountsContext(redacted: boolean) {
  const accounts = query<AccountContextRow>(
    `SELECT id, name, type, currency, balance, is_archived, is_primary, credit_limit,
            statement_closing_day, payment_due_day
     FROM accounts
     WHERE is_archived = 0
     ORDER BY is_primary DESC, name ASC, id ASC`
  )
  const aliases = getAccountAliases()
  const aliasesByAccount = Object.entries(aliases).reduce<Record<string, string[]>>(
    (acc, [alias, accountId]) => {
      acc[accountId] = [...(acc[accountId] ?? []), alias].sort((a, b) => a.localeCompare(b))
      return acc
    },
    {}
  )

  return {
    count: accounts.length,
    aliasCount: Object.keys(aliases).length,
    aliasesRedacted: redacted,
    aliases: redacted ? {} : aliases,
    aliasesByAccount: redacted ? {} : aliasesByAccount,
    rows: accounts.map((account) => ({
      id: account.id,
      name: redactText(account.name, redacted),
      type: account.type,
      currency: account.currency,
      balance: fromCentavos(account.balance),
      balanceCentavos: account.balance,
      isPrimary: account.is_primary === 1,
      creditLimit:
        account.credit_limit === null || account.credit_limit === undefined
          ? null
          : fromCentavos(account.credit_limit),
      creditLimitCentavos: account.credit_limit ?? null,
      statementClosingDay: account.statement_closing_day ?? null,
      paymentDueDay: account.payment_due_day ?? null,
      aliases: redacted ? [] : (aliasesByAccount[account.id] ?? []),
    })),
  }
}

function getFinanceProfileContext(redacted: boolean) {
  const profile = getJsonSetting<unknown>(FINANCE_PROFILE_SETTING_KEY, {})
  const present = isPlainObject(profile) && Object.keys(profile).length > 0
  const keys = present ? Object.keys(profile).sort((a, b) => a.localeCompare(b)) : []

  return {
    present,
    keys,
    profile: redacted
      ? redactAuditStructuredValue(stableJsonValue(profile))
      : stableJsonValue(profile),
    profileRedacted: redacted && present,
  }
}

function getBudgetsContext(redacted: boolean, warnings: ContextWarning[]) {
  if (!tableHasColumns('budgets', ['id', 'name', 'amount', 'period', 'category_id', 'is_active'])) {
    warnings.push({
      section: 'budgets',
      severity: 'gap',
      message: 'budgets table is missing or incomplete; active budget context is unavailable.',
    })
    return { available: false, count: 0, active: [] }
  }

  const budgets = query<BudgetContextRow>(
    `SELECT b.id, b.name, b.amount, b.period, b.category_id, b.is_active,
            c.name AS category_name
     FROM budgets b
     LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.is_active = 1
     ORDER BY b.period ASC, b.name ASC, b.id ASC`
  )
  const totals = new Map<string, number>()
  for (const budget of budgets) addCurrencyTotal(totals, 'mixed', budget.amount)

  return {
    available: true,
    count: budgets.length,
    active: budgets.map((budget) => ({
      id: budget.id,
      name: redactText(budget.name, redacted),
      categoryId: budget.category_id,
      categoryName: redactText(budget.category_name, redacted),
      amount: fromCentavos(budget.amount),
      amountCentavos: budget.amount,
      period: budget.period,
      isActive: budget.is_active === 1,
    })),
    summary: {
      activeCount: budgets.length,
      totalsByCurrency: currencyTotalsSnapshot(totals),
      currencyNote: 'Budgets do not store currency directly; totals are reported under mixed.',
    },
  }
}

function getSubscriptionsContext(redacted: boolean, warnings: ContextWarning[]) {
  if (
    !tableHasColumns('subscriptions', [
      'id',
      'account_id',
      'category_id',
      'name',
      'amount',
      'currency',
      'billing_cycle',
      'next_billing_date',
      'url',
      'notes',
      'is_active',
    ])
  ) {
    warnings.push({
      section: 'subscriptions',
      severity: 'gap',
      message:
        'subscriptions table is missing or incomplete; active subscription context is unavailable.',
    })
    return { available: false, count: 0, active: [] }
  }

  const subscriptions = query<SubscriptionContextRow>(
    `SELECT s.*, a.name AS account_name, c.name AS category_name
     FROM subscriptions s
     LEFT JOIN accounts a ON a.id = s.account_id
     LEFT JOIN categories c ON c.id = s.category_id
     WHERE s.is_active = 1
     ORDER BY s.next_billing_date ASC, s.name ASC, s.id ASC`
  )
  const monthlyTotals = new Map<string, number>()
  const yearlyTotals = new Map<string, number>()
  for (const subscription of subscriptions) {
    const monthlyCentavos = monthlySubscriptionCentavos(
      subscription.amount,
      subscription.billing_cycle
    )
    addCurrencyTotal(monthlyTotals, subscription.currency, monthlyCentavos)
    addCurrencyTotal(yearlyTotals, subscription.currency, monthlyCentavos * 12)
  }

  return {
    available: true,
    count: subscriptions.length,
    active: subscriptions.slice(0, ASSISTANT_CONTEXT_ITEM_LIMIT).map((subscription) => {
      const monthlyCentavos = monthlySubscriptionCentavos(
        subscription.amount,
        subscription.billing_cycle
      )
      return {
        id: subscription.id,
        name: redactText(subscription.name, redacted),
        accountId: subscription.account_id,
        accountName: redactText(subscription.account_name, redacted),
        categoryId: subscription.category_id,
        categoryName: redactText(subscription.category_name, redacted),
        amount: fromCentavos(subscription.amount),
        amountCentavos: subscription.amount,
        currency: subscription.currency,
        billingCycle: subscription.billing_cycle,
        nextBillingDate: subscription.next_billing_date,
        monthlyEquivalent: fromCentavos(monthlyCentavos),
        monthlyEquivalentCentavos: monthlyCentavos,
        yearlyEquivalent: fromCentavos(monthlyCentavos * 12),
        yearlyEquivalentCentavos: monthlyCentavos * 12,
        url: redactText(subscription.url, redacted),
        notes: redactText(subscription.notes, redacted),
      }
    }),
    summary: {
      activeCount: subscriptions.length,
      monthlyTotalsByCurrency: currencyTotalsSnapshot(monthlyTotals),
      yearlyTotalsByCurrency: currencyTotalsSnapshot(yearlyTotals),
    },
  }
}

function getCreditCardsContext(redacted: boolean, warnings: ContextWarning[]) {
  const cards = query<CreditCardAccountContextRow>(
    `SELECT id, name, currency, balance, credit_limit, statement_closing_day, payment_due_day
     FROM accounts
     WHERE type = 'credit_card' AND is_archived = 0
     ORDER BY name ASC, id ASC`
  )
  const hasStatementColumns = tableHasColumns('credit_card_statements', [
    'id',
    'account_id',
    'statement_start_date',
    'statement_end_date',
    'due_date',
    'statement_balance',
    'minimum_payment',
    'paid_amount',
    'currency',
    'status',
    'source',
    'note',
  ])
  if (!hasStatementColumns) {
    warnings.push({
      section: 'creditCards',
      severity: 'gap',
      message:
        'credit_card_statements table is missing or incomplete; persisted statement context is unavailable.',
    })
  }
  const statements = hasStatementColumns
    ? query<CreditCardStatementContextRow>(
        `SELECT s.*, a.name AS account_name
         FROM credit_card_statements s
         JOIN accounts a ON a.id = s.account_id
         WHERE a.type = 'credit_card'
           AND a.is_archived = 0
          ORDER BY CASE WHEN s.statement_balance > s.paid_amount THEN 0 ELSE 1 END ASC,
                   s.due_date ASC, s.statement_end_date DESC, s.id ASC
          LIMIT 50`
      )
    : []

  const dueTotals = new Map<string, number>()
  const statementRows = statements.map((statement) => {
    const payment = paymentAmounts(statement)
    if (payment.amountToPayCentavos > 0) {
      addCurrencyTotal(dueTotals, statement.currency, payment.amountToPayCentavos)
    }
    return {
      id: statement.id,
      accountId: statement.account_id,
      accountName: redactText(statement.account_name, redacted),
      statementStartDate: statement.statement_start_date,
      statementEndDate: statement.statement_end_date,
      dueDate: statement.due_date,
      statementBalance: fromCentavos(statement.statement_balance),
      statementBalanceCentavos: statement.statement_balance,
      minimumPayment: fromCentavos(statement.minimum_payment),
      minimumPaymentCentavos: statement.minimum_payment,
      paidAmount: fromCentavos(statement.paid_amount),
      paidAmountCentavos: statement.paid_amount,
      ...payment,
      currency: statement.currency,
      status: statement.status,
      paymentStatus: effectiveStatementStatus(statement),
      source: redactText(statement.source, redacted),
      note: redactText(statement.note, redacted),
    }
  })
  const dues = statementRows.filter((statement) => statement.amountToPayCentavos > 0)

  return {
    available: true,
    cards: cards.map((card) => ({
      id: card.id,
      name: redactText(card.name, redacted),
      currency: card.currency,
      currentBalance: fromCentavos(Math.abs(card.balance)),
      currentBalanceCentavos: Math.abs(card.balance),
      creditLimit: card.credit_limit === null ? null : fromCentavos(card.credit_limit),
      creditLimitCentavos: card.credit_limit,
      statementClosingDay: card.statement_closing_day,
      paymentDueDay: card.payment_due_day,
      nextClosingDate: card.statement_closing_day
        ? nextDateForDay(card.statement_closing_day).format('YYYY-MM-DD')
        : null,
      nextPaymentDueDate: card.payment_due_day
        ? nextDateForDay(card.payment_due_day).format('YYYY-MM-DD')
        : null,
    })),
    statements: statementRows,
    dues,
    summary: {
      cardCount: cards.length,
      statementCount: statementRows.length,
      dueCount: dues.length,
      totalDueByCurrency: currencyTotalsSnapshot(dueTotals),
      paymentStatusCounts: {
        open: statementRows.filter((statement) => statement.paymentStatus === 'open').length,
        partial: statementRows.filter((statement) => statement.paymentStatus === 'partial').length,
        paid: statementRows.filter((statement) => statement.paymentStatus === 'paid').length,
        overdue: statementRows.filter((statement) => statement.paymentStatus === 'overdue').length,
      },
    },
  }
}

async function getRecurringContext(redacted: boolean, warnings: ContextWarning[]) {
  const unavailable = {
    available: false,
    success: false,
    period: null,
    scheduleBasis: null,
    scheduleNote: null,
    fallbackWindowDays: null,
    summary: null,
    expected: [],
  }

  if (!tableExists('recurring_rules')) {
    warnings.push({
      section: 'recurring',
      severity: 'gap',
      message: 'recurring_rules table is missing; expected-vs-paid context is unavailable.',
    })
    return unavailable
  }

  const tool = recurringTools.find(
    (candidate) => candidate.name === 'get-recurring-expected-vs-paid'
  )
  if (!tool) {
    warnings.push({
      section: 'recurring',
      severity: 'gap',
      message: 'get-recurring-expected-vs-paid tool is not registered.',
    })
    return unavailable
  }

  const startDate = dayjs().format('YYYY-MM-DD')
  const endDate = dayjs().add(ASSISTANT_CONTEXT_RECURRING_DAYS, 'day').format('YYYY-MM-DD')
  let result: Awaited<ReturnType<typeof tool.execute>>
  try {
    result = await tool.execute(
      tool.schema.parse({
        startDate,
        endDate,
        type: 'expense',
        includeInactive: false,
        fallbackWindowDays: 3,
        asOfDate: startDate,
      })
    )
  } catch (error) {
    warnings.push({
      section: 'recurring',
      severity: 'warning',
      message: `Recurring expected-vs-paid summary failed: ${error instanceof Error ? error.message : String(error)}`,
    })
    return {
      available: true,
      success: false,
      period: { startDate, endDate },
      scheduleBasis: null,
      scheduleNote: null,
      fallbackWindowDays: null,
      summary: null,
      expected: [],
    }
  }

  if (result?.success === false) {
    warnings.push({
      section: 'recurring',
      severity: 'warning',
      message: String(result.message ?? 'Recurring expected-vs-paid summary failed.'),
    })
    return {
      available: true,
      success: false,
      period: { startDate, endDate },
      scheduleBasis: null,
      scheduleNote: null,
      fallbackWindowDays: null,
      summary: null,
      expected: [],
    }
  }

  return {
    available: true,
    success: true,
    period: result.period,
    scheduleBasis: result.scheduleBasis,
    scheduleNote: result.scheduleNote,
    fallbackWindowDays: result.fallbackWindowDays,
    summary: result.summary,
    expected: maybeRedactObject(
      Array.isArray(result.expected) ? result.expected.slice(0, ASSISTANT_CONTEXT_ITEM_LIMIT) : [],
      redacted
    ),
  }
}

function getGoalsSupport(redacted: boolean, warnings: ContextWarning[]) {
  if (
    !tableHasColumns('goals', [
      'id',
      'name',
      'target_amount',
      'current_amount',
      'deadline',
      'account_id',
      'icon',
      'color',
      'notes',
      'created_at',
      'updated_at',
    ])
  ) {
    warnings.push({
      section: 'support.goals',
      severity: 'gap',
      message: 'goals table is missing or incomplete; goal support context is unavailable.',
    })
    return {
      available: false,
      tool: 'get-goal-status',
      availableTools: [],
      catalogTools: GOAL_SUPPORT_TOOLS,
      count: 0,
      goals: [],
    }
  }

  const goals = query<GoalContextRow>(
    `SELECT g.id, g.name, g.target_amount, g.current_amount, g.deadline, g.account_id,
            g.notes, a.name AS account_name
     FROM goals g
     LEFT JOIN accounts a ON a.id = g.account_id
     ORDER BY g.deadline IS NULL ASC, g.deadline ASC, g.name ASC, g.id ASC`
  )
  const totalTarget = goals.reduce((sum, goal) => sum + goal.target_amount, 0)
  const totalSaved = goals.reduce((sum, goal) => sum + goal.current_amount, 0)
  const completed = goals.filter((goal) => goal.current_amount >= goal.target_amount).length

  return {
    available: true,
    tool: 'get-goal-status',
    availableTools: GOAL_SUPPORT_TOOLS,
    count: goals.length,
    goals: goals.slice(0, ASSISTANT_CONTEXT_ITEM_LIMIT).map((goal) => ({
      id: goal.id,
      name: redactText(goal.name, redacted),
      accountId: goal.account_id,
      accountName: redactText(goal.account_name, redacted),
      targetAmount: fromCentavos(goal.target_amount),
      targetAmountCentavos: goal.target_amount,
      currentAmount: fromCentavos(goal.current_amount),
      currentAmountCentavos: goal.current_amount,
      remainingAmount: fromCentavos(Math.max(goal.target_amount - goal.current_amount, 0)),
      remainingAmountCentavos: Math.max(goal.target_amount - goal.current_amount, 0),
      progressPercent:
        goal.target_amount > 0 ? Math.round((goal.current_amount / goal.target_amount) * 100) : 0,
      completed: goal.current_amount >= goal.target_amount,
      deadline: goal.deadline,
      notes: redactText(goal.notes, redacted),
    })),
    summary: {
      totalGoals: goals.length,
      completedGoals: completed,
      totalTarget: fromCentavos(totalTarget),
      totalTargetCentavos: totalTarget,
      totalSaved: fromCentavos(totalSaved),
      totalSavedCentavos: totalSaved,
      overallProgressPercent: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0,
    },
  }
}

function getDebtSupport(redacted: boolean) {
  const debts = query<CreditCardAccountContextRow>(
    `SELECT id, name, currency, balance, credit_limit, statement_closing_day, payment_due_day
     FROM accounts
     WHERE type = 'credit_card' AND is_archived = 0 AND balance < 0
     ORDER BY ABS(balance) DESC, name ASC, id ASC`
  )
  const totals = new Map<string, number>()
  for (const debt of debts) addCurrencyTotal(totals, debt.currency, Math.abs(debt.balance))

  return {
    available: true,
    tool: 'get-debt-payoff-plan',
    availableTools: DEBT_SUPPORT_TOOLS,
    source: 'active credit_card accounts with negative balances',
    count: debts.length,
    debts: debts.map((debt) => ({
      accountId: debt.id,
      accountName: redactText(debt.name, redacted),
      currency: debt.currency,
      balance: fromCentavos(Math.abs(debt.balance)),
      balanceCentavos: Math.abs(debt.balance),
      minimumPaymentEstimate: fromCentavos(
        Math.max(Math.round(Math.abs(debt.balance) * 0.02), 2500)
      ),
      minimumPaymentEstimateCentavos: Math.max(Math.round(Math.abs(debt.balance) * 0.02), 2500),
      aprAvailable: false,
    })),
    summary: {
      debtCount: debts.length,
      totalDebtByCurrency: currencyTotalsSnapshot(totals),
      limitation: 'APR is not stored on accounts, so payoff projections exclude interest.',
    },
  }
}

function getInvestmentSupport(redacted: boolean, warnings: ContextWarning[]) {
  const stockPricesAvailable = tableHasColumns('stock_prices', [
    'id',
    'symbol',
    'price',
    'currency',
    'date',
    'created_at',
  ])
  if (
    !tableHasColumns('investments', [
      'id',
      'account_id',
      'symbol',
      'name',
      'type',
      'shares',
      'avg_cost_basis',
      'currency',
      'notes',
      'created_at',
      'updated_at',
    ])
  ) {
    warnings.push({
      section: 'support.investments',
      severity: 'gap',
      message:
        'investments table is missing or incomplete; investment support context is unavailable.',
    })
    return {
      available: false,
      tool: 'manage-investment',
      availableTools: [],
      catalogTools: INVESTMENT_SUPPORT_TOOLS,
      count: 0,
      holdings: [],
    }
  }

  const holdings = query<InvestmentContextRow>(
    `SELECT id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes
     FROM investments
     ORDER BY symbol ASC, id ASC`
  )
  const costBasisTotals = new Map<string, number>()
  const countByType = new Map<string, number>()
  const availableTools = [
    'manage-investment',
    ...(stockPricesAvailable ? ['generate-portfolio-review'] : []),
  ]
  for (const holding of holdings) {
    addCurrencyTotal(
      costBasisTotals,
      holding.currency,
      Math.round(holding.avg_cost_basis * holding.shares)
    )
    countByType.set(holding.type, (countByType.get(holding.type) ?? 0) + 1)
  }

  return {
    available: true,
    tool: 'manage-investment',
    availableTools,
    catalogTools: INVESTMENT_SUPPORT_TOOLS,
    stockPricesAvailable,
    count: holdings.length,
    holdings: holdings.slice(0, ASSISTANT_CONTEXT_ITEM_LIMIT).map((holding) => ({
      id: holding.id,
      accountId: holding.account_id,
      symbol: holding.symbol,
      name: redactText(holding.name, redacted),
      type: holding.type,
      shares: holding.shares,
      avgCostBasis: fromCentavos(holding.avg_cost_basis),
      avgCostBasisCentavos: holding.avg_cost_basis,
      currency: holding.currency,
      notes: redactText(holding.notes, redacted),
    })),
    summary: {
      holdingCount: holdings.length,
      countByType: Object.fromEntries(
        [...countByType.entries()].sort(([a], [b]) => a.localeCompare(b))
      ),
      costBasisByCurrency: currencyTotalsSnapshot(costBasisTotals),
      limitation:
        'Investment context uses stored holdings only; no new pricing or portfolio features are expanded here.',
    },
  }
}

function getSupportSummary(support: {
  goals: { available: boolean; count: number; availableTools?: readonly string[] }
  debt: { available: boolean; count: number; availableTools?: readonly string[] }
  investments: {
    available: boolean
    count: number
    availableTools?: readonly string[]
    catalogTools?: readonly string[]
  }
}) {
  const availableTools = [
    ...(support.goals.availableTools ?? []),
    ...(support.debt.availableTools ?? []),
    ...(support.investments.availableTools ?? []),
  ]
  return {
    availableTools,
    catalogTools: [...GOAL_SUPPORT_TOOLS, ...DEBT_SUPPORT_TOOLS, ...INVESTMENT_SUPPORT_TOOLS],
    surfaces: {
      goals: {
        available: support.goals.available,
        count: support.goals.count,
        availableTools: support.goals.availableTools ?? [],
        catalogTools: GOAL_SUPPORT_TOOLS,
      },
      debt: {
        available: support.debt.available,
        count: support.debt.count,
        availableTools: support.debt.availableTools ?? [],
        catalogTools: DEBT_SUPPORT_TOOLS,
      },
      investments: {
        available: support.investments.available,
        count: support.investments.count,
        availableTools: support.investments.availableTools ?? [],
        catalogTools: support.investments.catalogTools ?? INVESTMENT_SUPPORT_TOOLS,
      },
    },
    scopeNote:
      'Goal, debt, and investment support reflects existing CLI/MCP tools; investment context remains limited to stored holdings and portfolio review.',
  }
}

async function getSetupContext(redacted: boolean) {
  const setupTool = setupStatusTools.find((tool) => tool.name === 'setup-status')
  if (!setupTool) {
    return {
      setupComplete: false,
      checks: [],
      warnings: [
        {
          section: 'setup',
          severity: 'gap' as const,
          message: 'setup-status tool is not registered.',
        },
      ],
    }
  }

  let setup: Record<string, unknown>
  try {
    setup = await setupTool.execute(setupTool.schema.parse({}))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      setupComplete: false,
      checks: [],
      warnings: [
        {
          section: 'setup',
          severity: 'warning' as const,
          message: `setup-status could not be read: ${message}`,
        },
      ],
      message: 'Setup status is unavailable; automation context returned partial data.',
    }
  }
  const checks = Array.isArray(setup.checks) ? setup.checks : []
  const warnings: ContextWarning[] = checks
    .filter((check: Record<string, unknown>) => check.ok === false)
    .map((check: Record<string, unknown>) => ({
      section: 'setup',
      key: typeof check.key === 'string' ? check.key : undefined,
      severity: 'warning' as const,
      message:
        typeof check.hint === 'string'
          ? check.hint
          : `Setup check ${String(check.key ?? 'unknown')} is not ready.`,
      hint: typeof check.hint === 'string' ? check.hint : undefined,
    }))

  return {
    setupComplete: Boolean(setup.setupComplete),
    checks: maybeRedactObject(checks, redacted),
    warnings,
    message: setup.message,
  }
}

function failure(reason: string, message: string, extra: Record<string, unknown> = {}) {
  return { success: false as const, reason, message, ...extra }
}

function supportedAuditAction(value: string): value is UndoSupportedAction {
  return value === 'create' || value === 'update' || value === 'delete'
}

function supportedAuditEntity(value: string): value is UndoSupportedEntity {
  return value === 'transaction' || value === 'credit_card_statement'
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function nestedSnapshot(value: unknown, key: string): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null
  const nested = value[key]
  return isPlainObject(nested) ? nested : null
}

function normalizeUndoTransactionStatus(value: unknown): UndoTransactionSnapshot['status'] {
  return value === 'pending' || value === 'cleared' || value === 'posted' ? value : 'posted'
}

function normalizeUndoStatementStatus(value: unknown): UndoStatementSnapshot['status'] {
  return value === 'open' || value === 'partial' || value === 'paid' || value === 'overdue'
    ? value
    : 'open'
}

function transactionSnapshotFromAudit(value: unknown): UndoTransactionSnapshot | null {
  const tx = nestedSnapshot(value, 'transaction')
  if (!tx) return null
  const id = asString(tx.id)
  const accountId = asString(tx.accountId)
  const type = asString(tx.type)
  const amountCentavos = asNumber(tx.amountCentavos)
  const description = asString(tx.description)
  const date = asString(tx.date)
  if (
    !id ||
    !accountId ||
    !(type === 'expense' || type === 'income' || type === 'transfer') ||
    amountCentavos === null ||
    !description ||
    !date
  ) {
    return null
  }

  return {
    id,
    accountId,
    categoryId: asString(tx.categoryId),
    transferToAccountId: asString(tx.transferToAccountId),
    type,
    amountCentavos,
    currency: asString(tx.currency),
    description,
    notes: asString(tx.notes),
    status: normalizeUndoTransactionStatus(tx.status),
    source: asString(tx.source),
    note: asString(tx.note),
    recurringRuleId: asString(tx.recurringRuleId),
    tags: asStringArray(tx.tags),
    isPlaceholder: Boolean(tx.isPlaceholder),
    placeholderStatus: asString(tx.placeholderStatus),
    resolvedAt: asString(tx.resolvedAt),
    resolvedByTransactionId: asString(tx.resolvedByTransactionId),
    placeholderReason: asString(tx.placeholderReason),
    placeholderParentTransactionId: asString(tx.placeholderParentTransactionId),
    date,
  }
}

function statementSnapshotFromAudit(value: unknown): UndoStatementSnapshot | null {
  const statement = nestedSnapshot(value, 'statement')
  if (!statement) return null
  const id = asString(statement.id)
  const accountId = asString(statement.accountId)
  const statementEndDate = asString(statement.statementEndDate)
  const dueDate = asString(statement.dueDate)
  const statementBalanceCentavos = asNumber(statement.statementBalanceCentavos)
  const minimumPaymentCentavos = asNumber(statement.minimumPaymentCentavos)
  const paidAmountCentavos = asNumber(statement.paidAmountCentavos)
  const currency = asString(statement.currency)
  if (
    !id ||
    !accountId ||
    !statementEndDate ||
    !dueDate ||
    statementBalanceCentavos === null ||
    minimumPaymentCentavos === null ||
    paidAmountCentavos === null ||
    !currency
  ) {
    return null
  }

  return {
    id,
    accountId,
    statementStartDate: asString(statement.statementStartDate),
    statementEndDate,
    dueDate,
    statementBalanceCentavos,
    minimumPaymentCentavos,
    paidAmountCentavos,
    currency,
    status: normalizeUndoStatementStatus(statement.status),
    source: asString(statement.source),
    note: asString(statement.note),
  }
}

function transactionSnapshotPublic(tx: UndoTransactionSnapshot) {
  return {
    ...tx,
    amount: fromCentavos(tx.amountCentavos),
  }
}

function statementSnapshotPublic(statement: UndoStatementSnapshot) {
  return {
    ...statement,
    statementBalance: fromCentavos(statement.statementBalanceCentavos),
    minimumPayment: fromCentavos(statement.minimumPaymentCentavos),
    paidAmount: fromCentavos(statement.paidAmountCentavos),
  }
}

function transactionBalanceImpacts(tx: UndoTransactionSnapshot): Map<string, number> {
  const impacts = new Map<string, number>()
  if (tx.status === 'pending') return impacts
  if (tx.type === 'transfer') {
    if (!tx.transferToAccountId) return impacts
    impacts.set(tx.accountId, (impacts.get(tx.accountId) ?? 0) - tx.amountCentavos)
    impacts.set(
      tx.transferToAccountId,
      (impacts.get(tx.transferToAccountId) ?? 0) + tx.amountCentavos
    )
    return impacts
  }
  impacts.set(
    tx.accountId,
    (impacts.get(tx.accountId) ?? 0) +
      (tx.type === 'income' ? tx.amountCentavos : -tx.amountCentavos)
  )
  return impacts
}

function addUndoImpact(target: Map<string, number>, source: Map<string, number>, multiplier = 1) {
  for (const [accountId, amount] of source) {
    const next = (target.get(accountId) ?? 0) + amount * multiplier
    if (next === 0) target.delete(accountId)
    else target.set(accountId, next)
  }
}

function readUndoAccountBalances(accountIds: string[]) {
  const uniqueIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b))
  if (uniqueIds.length === 0)
    return new Map<string, { name: string | null; balance: number | null }>()
  const placeholders = uniqueIds.map((_, index) => `$${index + 1}`).join(', ')
  const rows = query<{ id: string; name: string | null; balance: number | null }>(
    `SELECT id, name, balance FROM accounts WHERE id IN (${placeholders})`,
    uniqueIds
  )
  return new Map(
    rows.map((row) => [row.id, { name: row.name ?? null, balance: row.balance ?? null }])
  )
}

function formatUndoBalanceImpact(deltas: Map<string, number>) {
  const sorted = [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))
  const balances = readUndoAccountBalances(sorted.map(([accountId]) => accountId))
  const accounts = sorted.map(([accountId, deltaCentavos]) => {
    const account = balances.get(accountId)
    const previousBalanceCentavos = account?.balance ?? null
    const newBalanceCentavos =
      previousBalanceCentavos === null ? null : previousBalanceCentavos + deltaCentavos
    return {
      accountId,
      accountName: account?.name ?? null,
      previousBalance:
        previousBalanceCentavos === null ? null : fromCentavos(previousBalanceCentavos),
      newBalance: newBalanceCentavos === null ? null : fromCentavos(newBalanceCentavos),
      delta: fromCentavos(deltaCentavos),
      previousBalanceCentavos,
      newBalanceCentavos,
      deltaCentavos,
    }
  })

  return { affectsBalances: accounts.length > 0, accounts, deltas: accounts }
}

function buildUndoPlan(entry: AuditLogRow): UndoPlan | ReturnType<typeof failure> {
  if (!supportedAuditEntity(entry.entity) || !supportedAuditAction(entry.action)) {
    return failure(
      'unsupported_undo_target',
      `Audit entry ${entry.id} is ${entry.entity}/${entry.action}, which cannot be undone safely by this tool.`
    )
  }

  const before = parseAuditJson(entry.before_json)
  const after = parseAuditJson(entry.after_json)
  const inverseAction =
    entry.action === 'create' ? 'delete' : entry.action === 'delete' ? 'create' : 'update'

  if (entry.entity === 'transaction') {
    const beforeTx = transactionSnapshotFromAudit(before)
    const afterTx = transactionSnapshotFromAudit(after)
    const sourceTx = entry.action === 'delete' ? beforeTx : afterTx
    if (!sourceTx) {
      return failure(
        'unsupported_undo_snapshot',
        `Audit entry ${entry.id} does not contain the transaction snapshot required for undo.`
      )
    }

    const exists = query<{ id: string }>('SELECT id FROM transactions WHERE id = $1 LIMIT 1', [
      sourceTx.id,
    ])[0]
    if (entry.action === 'delete' && exists) {
      return failure(
        'undo_conflict_transaction_exists',
        `Transaction ${sourceTx.id} already exists; undoing delete audit ${entry.id} would overwrite data.`
      )
    }
    if (entry.action !== 'delete' && !exists) {
      return failure(
        'undo_conflict_transaction_missing',
        `Transaction ${sourceTx.id} no longer exists; audit ${entry.id} cannot be undone safely.`
      )
    }

    const deltas = new Map<string, number>()
    if (entry.action === 'create' && afterTx)
      addUndoImpact(deltas, transactionBalanceImpacts(afterTx), -1)
    if (entry.action === 'delete' && beforeTx)
      addUndoImpact(deltas, transactionBalanceImpacts(beforeTx), 1)
    if (entry.action === 'update' && beforeTx && afterTx) {
      addUndoImpact(deltas, transactionBalanceImpacts(beforeTx), 1)
      addUndoImpact(deltas, transactionBalanceImpacts(afterTx), -1)
    }

    return {
      entity: 'transaction',
      entityId: sourceTx.id,
      action: entry.action,
      inverseAction,
      beforeUndo: entry.action === 'delete' ? null : transactionSnapshotPublic(afterTx!),
      afterUndo: entry.action === 'create' ? null : transactionSnapshotPublic(beforeTx!),
      balanceImpact: formatUndoBalanceImpact(deltas),
    }
  }

  const beforeStatement = statementSnapshotFromAudit(before)
  const afterStatement = statementSnapshotFromAudit(after)
  const sourceStatement = entry.action === 'delete' ? beforeStatement : afterStatement
  if (!sourceStatement) {
    return failure(
      'unsupported_undo_snapshot',
      `Audit entry ${entry.id} does not contain the credit-card statement snapshot required for undo.`
    )
  }
  const exists = query<{ id: string }>(
    'SELECT id FROM credit_card_statements WHERE id = $1 LIMIT 1',
    [sourceStatement.id]
  )[0]
  if (entry.action === 'delete' && exists) {
    return failure(
      'undo_conflict_statement_exists',
      `Credit-card statement ${sourceStatement.id} already exists; undoing delete audit ${entry.id} would overwrite data.`
    )
  }
  if (entry.action !== 'delete' && !exists) {
    return failure(
      'undo_conflict_statement_missing',
      `Credit-card statement ${sourceStatement.id} no longer exists; audit ${entry.id} cannot be undone safely.`
    )
  }

  return {
    entity: 'credit_card_statement',
    entityId: sourceStatement.id,
    action: entry.action,
    inverseAction,
    beforeUndo: entry.action === 'delete' ? null : statementSnapshotPublic(afterStatement!),
    afterUndo: entry.action === 'create' ? null : statementSnapshotPublic(beforeStatement!),
    balanceImpact: formatUndoBalanceImpact(new Map()),
  }
}

function dependentAuditRows(entry: AuditLogRow, limit = 5) {
  if (!entry.entity_id) return []
  return query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     WHERE entity = $1 AND entity_id = $2 AND created_at > $3 AND id <> $4
     ORDER BY created_at DESC, id DESC
     LIMIT $5`,
    [entry.entity, entry.entity_id, entry.created_at, entry.id, limit]
  )
}

function auditEntryMatchesAccount(entry: AuditLogRow, accountId: string): boolean {
  const before = parseAuditJson(entry.before_json)
  const after = parseAuditJson(entry.after_json)
  const txBefore = transactionSnapshotFromAudit(before)
  const txAfter = transactionSnapshotFromAudit(after)
  const statementBefore = statementSnapshotFromAudit(before)
  const statementAfter = statementSnapshotFromAudit(after)
  return (
    [txBefore, txAfter].some(
      (tx) => tx && (tx.accountId === accountId || tx.transferToAccountId === accountId)
    ) || [statementBefore, statementAfter].some((statement) => statement?.accountId === accountId)
  )
}

function findUndoAuditEntry(input: {
  auditId?: string
  transactionId?: string
  statementId?: string
  last?: boolean
  source?: string
  since?: string
  command?: string
  account?: string
}) {
  const targetCount = [input.auditId, input.transactionId, input.statementId].filter(Boolean).length
  if (targetCount > 1) {
    return failure(
      'undo_target_conflict',
      'Use only one of auditId, transactionId, or statementId for undo target selection.'
    )
  }
  if (!input.auditId && !input.transactionId && !input.statementId && !input.last) {
    return failure(
      'undo_target_required',
      'Provide auditId, transactionId, statementId, or last=true to choose what to undo.'
    )
  }

  let resolvedAccountId: string | null = null
  if (input.account) {
    const resolved = resolveAccountId(undefined, input.account)
    if (!resolved.success) return resolved
    resolvedAccountId = resolved.id
  }

  const filters = [
    "entity IN ('transaction', 'credit_card_statement')",
    "action IN ('create', 'update', 'delete')",
  ]
  const params: unknown[] = []
  const addFilter = (sql: string, value: unknown) => {
    params.push(value)
    filters.push(sql.replace('?', `$${params.length}`))
  }
  if (input.auditId) addFilter('id = ?', input.auditId)
  if (input.transactionId) {
    addFilter('entity = ?', 'transaction')
    addFilter('entity_id = ?', input.transactionId)
  }
  if (input.statementId) {
    addFilter('entity = ?', 'credit_card_statement')
    addFilter('entity_id = ?', input.statementId)
  }
  if (input.source) addFilter('source = ?', input.source)
  if (input.since) addFilter('created_at >= ?', input.since)
  if (input.command) addFilter('action = ?', input.command)

  params.push(resolvedAccountId ? UNDO_CANDIDATE_LIMIT : 1)
  const rows = query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  )
  const row = resolvedAccountId
    ? rows.find((candidate) => auditEntryMatchesAccount(candidate, resolvedAccountId))
    : rows[0]
  if (!row) {
    return failure(
      'undo_target_not_found',
      'No undoable audit entry matched the requested filters.'
    )
  }
  return { success: true as const, entry: row }
}

function applyUndoBalanceDeltas(balanceImpact: UndoPlan['balanceImpact']) {
  for (const account of balanceImpact.accounts) {
    if (account.deltaCentavos === 0) continue
    execute(
      "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
      [account.deltaCentavos, account.accountId]
    )
  }
}

function serializedUndoTags(tx: UndoTransactionSnapshot) {
  return JSON.stringify(tx.tags ?? [])
}

function insertUndoTransaction(tx: UndoTransactionSnapshot) {
  execute(
    `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, tags, is_placeholder, placeholder_status, resolved_at, resolved_by_transaction_id, placeholder_reason, placeholder_parent_transaction_id, date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      tx.id,
      tx.accountId,
      tx.categoryId,
      tx.transferToAccountId,
      tx.type,
      tx.amountCentavos,
      tx.currency,
      tx.description,
      tx.notes,
      tx.status,
      tx.source,
      tx.note,
      tx.recurringRuleId,
      serializedUndoTags(tx),
      tx.isPlaceholder ? 1 : 0,
      tx.placeholderStatus,
      tx.resolvedAt,
      tx.resolvedByTransactionId,
      tx.placeholderReason,
      tx.placeholderParentTransactionId,
      tx.date,
    ]
  )
}

function updateUndoTransaction(tx: UndoTransactionSnapshot) {
  const result = execute(
    `UPDATE transactions
     SET account_id = $1, category_id = $2, transfer_to_account_id = $3, type = $4, amount = $5,
         currency = $6, description = $7, notes = $8, status = $9, source = $10, note = $11,
         recurring_rule_id = $12, tags = $13, is_placeholder = $14, placeholder_status = $15,
         resolved_at = $16, resolved_by_transaction_id = $17, placeholder_reason = $18,
         placeholder_parent_transaction_id = $19, date = $20,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $21`,
    [
      tx.accountId,
      tx.categoryId,
      tx.transferToAccountId,
      tx.type,
      tx.amountCentavos,
      tx.currency,
      tx.description,
      tx.notes,
      tx.status,
      tx.source,
      tx.note,
      tx.recurringRuleId,
      serializedUndoTags(tx),
      tx.isPlaceholder ? 1 : 0,
      tx.placeholderStatus,
      tx.resolvedAt,
      tx.resolvedByTransactionId,
      tx.placeholderReason,
      tx.placeholderParentTransactionId,
      tx.date,
      tx.id,
    ]
  )
  if (result.rowsAffected !== 1)
    throw new Error(`Transaction ${tx.id} could not be restored safely.`)
}

function deleteUndoTransaction(transactionId: string) {
  const result = execute('DELETE FROM transactions WHERE id = $1', [transactionId])
  if (result.rowsAffected !== 1)
    throw new Error(`Transaction ${transactionId} could not be deleted safely.`)
}

function insertUndoStatement(statement: UndoStatementSnapshot) {
  execute(
    `INSERT INTO credit_card_statements (id, account_id, statement_start_date, statement_end_date, due_date, statement_balance, minimum_payment, paid_amount, currency, status, source, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      statement.id,
      statement.accountId,
      statement.statementStartDate,
      statement.statementEndDate,
      statement.dueDate,
      statement.statementBalanceCentavos,
      statement.minimumPaymentCentavos,
      statement.paidAmountCentavos,
      statement.currency,
      statement.status,
      statement.source,
      statement.note,
    ]
  )
}

function updateUndoStatement(statement: UndoStatementSnapshot) {
  const result = execute(
    `UPDATE credit_card_statements
     SET account_id = $1, statement_start_date = $2, statement_end_date = $3, due_date = $4,
         statement_balance = $5, minimum_payment = $6, paid_amount = $7, currency = $8,
         status = $9, source = $10, note = $11,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $12`,
    [
      statement.accountId,
      statement.statementStartDate,
      statement.statementEndDate,
      statement.dueDate,
      statement.statementBalanceCentavos,
      statement.minimumPaymentCentavos,
      statement.paidAmountCentavos,
      statement.currency,
      statement.status,
      statement.source,
      statement.note,
      statement.id,
    ]
  )
  if (result.rowsAffected !== 1) {
    throw new Error(`Credit-card statement ${statement.id} could not be restored safely.`)
  }
}

function deleteUndoStatement(statementId: string) {
  const result = execute('DELETE FROM credit_card_statements WHERE id = $1', [statementId])
  if (result.rowsAffected !== 1) {
    throw new Error(`Credit-card statement ${statementId} could not be deleted safely.`)
  }
}

function applyUndoPlan(entry: AuditLogRow, plan: UndoPlan, source?: string, note?: string) {
  transaction(() => {
    if (plan.entity === 'transaction') {
      if (plan.inverseAction === 'delete') deleteUndoTransaction(plan.entityId)
      if (plan.inverseAction === 'update') {
        const tx = transactionSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!tx) throw new Error(`Audit entry ${entry.id} has no transaction snapshot to restore.`)
        updateUndoTransaction(tx)
      }
      if (plan.inverseAction === 'create') {
        const tx = transactionSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!tx) throw new Error(`Audit entry ${entry.id} has no transaction snapshot to recreate.`)
        insertUndoTransaction(tx)
      }
      applyUndoBalanceDeltas(plan.balanceImpact)
    } else {
      if (plan.inverseAction === 'delete') deleteUndoStatement(plan.entityId)
      if (plan.inverseAction === 'update') {
        const statement = statementSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!statement)
          throw new Error(`Audit entry ${entry.id} has no statement snapshot to restore.`)
        updateUndoStatement(statement)
      }
      if (plan.inverseAction === 'create') {
        const statement = statementSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!statement)
          throw new Error(`Audit entry ${entry.id} has no statement snapshot to recreate.`)
        insertUndoStatement(statement)
      }
    }

    writeAuditLog({
      entity: plan.entity,
      entityId: plan.entityId,
      action: 'undo',
      before: {
        auditEntryId: entry.id,
        originalAction: entry.action,
        beforeUndo: plan.beforeUndo,
      },
      after: {
        auditEntryId: entry.id,
        undoAction: plan.inverseAction,
        afterUndo: plan.afterUndo,
        balanceImpact: plan.balanceImpact,
      },
      source: source ?? 'undo',
      note,
    })
  })
}

function maybeRedactText(value: string | null | undefined, redacted: boolean) {
  return redactText(value, redacted)
}

function addFinding(
  findings: FinanceSanityFinding[],
  severity: FinanceSanityFinding['severity'],
  type: string,
  message: string,
  extra: Record<string, unknown> = {}
) {
  findings.push({ severity, type, message, ...extra })
}

function getCreditCardSanityFindings(input: {
  asOf: string
  cutoff: string
  redacted: boolean
  limit: number
}) {
  if (
    !tableHasColumns('credit_card_statements', [
      'id',
      'account_id',
      'due_date',
      'statement_balance',
      'paid_amount',
    ])
  ) {
    return []
  }
  const rows = query<CreditCardStatementContextRow>(
    `SELECT s.*, a.name AS account_name
     FROM credit_card_statements s
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE s.statement_balance > s.paid_amount
       AND s.due_date <= $1
     ORDER BY s.due_date ASC, s.statement_end_date DESC, s.id ASC
     LIMIT $2`,
    [input.cutoff, input.limit]
  )
  return rows.map((statement) => {
    const payment = paymentAmounts(statement)
    const overdue = dayjs(statement.due_date).isBefore(dayjs(input.asOf), 'day')
    return {
      severity: overdue ? 'critical' : 'warning',
      type: overdue ? 'credit_card_statement_overdue' : 'credit_card_statement_due_soon',
      statementId: statement.id,
      accountId: statement.account_id,
      accountName: maybeRedactText(statement.account_name, input.redacted),
      dueDate: statement.due_date,
      amountToPay: payment.amountToPay,
      amountToPayCentavos: payment.amountToPayCentavos,
      minimumPaymentDue: payment.minimumPaymentDue,
      minimumPaymentDueCentavos: payment.minimumPaymentDueCentavos,
      currency: statement.currency,
      paymentStatus: effectiveStatementStatus(statement),
      message: overdue
        ? `Credit-card statement ${statement.id} is overdue with ${payment.amountToPay.toFixed(2)} ${statement.currency} remaining.`
        : `Credit-card statement ${statement.id} is due by ${statement.due_date} with ${payment.amountToPay.toFixed(2)} ${statement.currency} remaining.`,
    } satisfies FinanceSanityFinding
  })
}

function getPlaceholderSanityFindings(input: { redacted: boolean; limit: number }) {
  if (!tableHasColumns('transactions', ['is_placeholder', 'placeholder_status'])) return []
  const rows = query<{
    id: string
    description: string
    amount: number
    currency: string | null
    date: string
    account_id: string
    account_name: string | null
    placeholder_reason: string | null
  }>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.account_id,
            a.name AS account_name, t.placeholder_reason
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.is_placeholder = 1
       AND COALESCE(t.placeholder_status, 'unresolved') = 'unresolved'
     ORDER BY t.date ASC, t.id ASC
     LIMIT $1`,
    [input.limit]
  )
  return rows.map((row) => ({
    severity: 'warning' as const,
    type: 'unresolved_placeholder',
    transactionId: row.id,
    accountId: row.account_id,
    accountName: maybeRedactText(row.account_name, input.redacted),
    date: row.date,
    amount: fromCentavos(row.amount),
    amountCentavos: row.amount,
    currency: row.currency,
    description: maybeRedactText(row.description, input.redacted),
    placeholderReason: maybeRedactText(row.placeholder_reason, input.redacted),
    message: `Placeholder transaction ${row.id} is still unresolved.`,
  }))
}

function getDuplicateSanityFindings(input: { redacted: boolean; limit: number }) {
  const rows = query<{
    id: string
    account_id: string
    account_name: string | null
    date: string
    amount: number
    currency: string | null
    type: 'expense' | 'income' | 'transfer'
    status: 'pending' | 'posted' | 'cleared' | null
    transfer_to_account_id: string | null
    description: string
  }>(
    `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.amount, t.currency, t.type,
            COALESCE(NULLIF(TRIM(t.status), ''), 'posted') AS status,
            t.transfer_to_account_id, t.description
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.type IN ('expense', 'income', 'transfer')
       AND t.account_id IS NOT NULL
       AND t.date IS NOT NULL
       AND t.description IS NOT NULL
      ORDER BY t.date DESC, t.id DESC
     LIMIT $1`,
    [Math.max(input.limit * 4, input.limit)]
  )
  const findings: FinanceSanityFinding[] = []
  const seenPairs = new Set<string>()

  for (const row of rows) {
    if (findings.length >= input.limit) break

    const duplicateCheck = findTransactionDuplicate({
      accountId: row.account_id,
      date: row.date,
      amountCentavos: row.amount,
      type: row.type,
      status: row.status,
      transferToAccountId: row.transfer_to_account_id,
      description: row.description,
      excludeTransactionId: row.id,
    })
    const match = duplicateCheck.match
    if (!match) continue

    const transactionIds = [row.id, match.existingTransactionId].sort((a, b) => a.localeCompare(b))
    const pairKey = transactionIds.join('\u0000')
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)

    findings.push({
      severity: 'warning' as const,
      type: 'duplicate_looking_transactions',
      duplicateKind: match.kind,
      duplicateReason: transactionDuplicateReason(match.kind),
      transactionIds,
      accountId: row.account_id,
      accountName: maybeRedactText(row.account_name, input.redacted),
      date: row.date,
      matchedDate: match.date,
      amount: fromCentavos(row.amount),
      amountCentavos: row.amount,
      currency: row.currency,
      transactionType: row.type,
      status: duplicateCheck.input.status,
      transferToAccountId: duplicateCheck.input.transferToAccountId,
      description: maybeRedactText(row.description, input.redacted),
      daysApart: match.daysApart,
      descriptionSimilarity: match.descriptionSimilarity,
      windowDays: match.windowDays,
      similarityThreshold: match.similarityThreshold,
      message:
        match.kind === 'exact_duplicate'
          ? `Transactions ${transactionIds[0]} and ${transactionIds[1]} look duplicated.`
          : `Transactions ${transactionIds[0]} and ${transactionIds[1]} look potentially duplicated within ${match.windowDays} days.`,
    })
  }

  return findings
}

function getSubscriptionSanityFindings(input: {
  cutoff: string
  redacted: boolean
  limit: number
}) {
  if (
    !tableHasColumns('subscriptions', [
      'id',
      'name',
      'amount',
      'currency',
      'next_billing_date',
      'is_active',
    ])
  )
    return []
  const rows = query<SubscriptionContextRow>(
    `SELECT s.*, a.name AS account_name, c.name AS category_name
     FROM subscriptions s
     LEFT JOIN accounts a ON a.id = s.account_id
     LEFT JOIN categories c ON c.id = s.category_id
     WHERE s.is_active = 1 AND s.next_billing_date <= $1
     ORDER BY s.next_billing_date ASC, s.name ASC
     LIMIT $2`,
    [input.cutoff, input.limit]
  )
  return rows.map((row) => ({
    severity: 'info' as const,
    type: 'subscription_due_soon',
    subscriptionId: row.id,
    name: maybeRedactText(row.name, input.redacted),
    nextBillingDate: row.next_billing_date,
    amount: fromCentavos(row.amount),
    amountCentavos: row.amount,
    currency: row.currency,
    accountId: row.account_id,
    accountName: maybeRedactText(row.account_name, input.redacted),
    message: `Subscription ${row.id} is due by ${row.next_billing_date}.`,
  }))
}

function getRecurringSanityFindings(input: {
  asOf: string
  cutoff: string
  redacted: boolean
  limit: number
}) {
  if (
    !tableHasColumns('recurring_rules', [
      'id',
      'description',
      'amount',
      'type',
      'next_date',
      'active',
    ])
  )
    return []
  const rows = query<RecurringRuleRow>(
    `SELECT r.*, a.name AS account_name, c.name AS category_name
     FROM recurring_rules r
     LEFT JOIN accounts a ON a.id = r.account_id
     LEFT JOIN categories c ON c.id = r.category_id
     WHERE r.active = 1 AND r.next_date <= $1
     ORDER BY r.next_date ASC, r.description ASC
     LIMIT $2`,
    [input.cutoff, input.limit]
  )
  return rows.map((row) => {
    const late = dayjs(row.next_date).isBefore(dayjs(input.asOf), 'day')
    return {
      severity: late ? ('warning' as const) : ('info' as const),
      type: late ? 'recurring_expected_late' : 'recurring_expected_due_soon',
      recurringRuleId: row.id,
      description: maybeRedactText(row.description, input.redacted),
      nextDate: row.next_date,
      amount: fromCentavos(row.amount),
      amountCentavos: row.amount,
      currency: row.currency,
      accountId: row.account_id,
      accountName: maybeRedactText(row.account_name, input.redacted),
      message: `Recurring rule ${row.id} is expected by ${row.next_date}.`,
    }
  })
}

type RecurringRuleRow = {
  id: string
  description: string
  amount: number
  type: string
  next_date: string
  account_id: string
  category_id: string | null
  active: number
  currency: string | null
  account_name: string | null
  category_name: string | null
}

function getAccountSanityFindings(input: { redacted: boolean; limit: number }) {
  const rows = query<AccountContextRow>(
    `SELECT id, name, type, currency, balance, is_archived, is_primary, credit_limit, statement_closing_day, payment_due_day
     FROM accounts
     WHERE COALESCE(is_archived, 0) = 0 AND type <> 'credit_card' AND balance < 0
     ORDER BY balance ASC, name ASC
     LIMIT $1`,
    [input.limit]
  )
  return rows.map((row) => ({
    severity: 'warning' as const,
    type: 'low_balance',
    accountId: row.id,
    accountName: maybeRedactText(row.name, input.redacted),
    balance: fromCentavos(row.balance),
    balanceCentavos: row.balance,
    currency: row.currency,
    message: `Account ${row.id} has a negative balance.`,
  }))
}

function getBalanceMismatchFindings(input: { redacted: boolean; limit: number }) {
  const rows = query<{
    id: string
    name: string
    currency: string
    stored_balance: number
    computed_balance: number | null
  }>(
    `SELECT a.id, a.name, a.currency, a.balance AS stored_balance,
            COALESCE(SUM(CASE
              WHEN COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = 'pending' THEN 0
              WHEN t.type = 'income' THEN t.amount
              WHEN t.type = 'expense' THEN -t.amount
              WHEN t.type = 'transfer' AND t.account_id = a.id THEN -t.amount
              ELSE 0
            END), 0) + COALESCE((
              SELECT SUM(t2.amount)
              FROM transactions t2
              WHERE t2.transfer_to_account_id = a.id
                AND t2.type = 'transfer'
                AND COALESCE(NULLIF(TRIM(t2.status), ''), 'posted') <> 'pending'
            ), 0) AS computed_balance
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id
     WHERE COALESCE(a.is_archived, 0) = 0
     GROUP BY a.id
     HAVING ABS(stored_balance - computed_balance) > 0
     ORDER BY ABS(stored_balance - computed_balance) DESC
     LIMIT $1`,
    [input.limit]
  )
  return rows.map((row) => ({
    severity: 'critical' as const,
    type: 'balance_mismatch',
    accountId: row.id,
    accountName: maybeRedactText(row.name, input.redacted),
    storedBalance: fromCentavos(row.stored_balance),
    storedBalanceCentavos: row.stored_balance,
    computedBalance: fromCentavos(row.computed_balance ?? 0),
    computedBalanceCentavos: row.computed_balance ?? 0,
    currency: row.currency,
    message: `Account ${row.id} stored balance differs from transaction-derived balance.`,
  }))
}

function getTransactionHygieneFindings(input: {
  asOf: string
  largeAmountCentavos: number
  redacted: boolean
  limit: number
}) {
  const staleDate = dayjs(input.asOf).subtract(7, 'day').format('YYYY-MM-DD')
  const recentDate = dayjs(input.asOf).subtract(30, 'day').format('YYYY-MM-DD')
  const rows = query<{
    id: string
    description: string
    amount: number
    currency: string | null
    type: string
    date: string
    status: string | null
    category_id: string | null
    account_id: string
    account_name: string | null
  }>(
    `SELECT t.id, t.description, t.amount, t.currency, t.type, t.date, t.status,
            t.category_id, t.account_id, a.name AS account_name
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE (COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = 'pending' AND t.date <= $1)
         OR (t.type = 'expense' AND t.category_id IS NULL AND t.date >= $2)
         OR (ABS(t.amount) >= $3 AND t.date >= $4)
      ORDER BY t.date DESC, t.id DESC
      LIMIT $5`,
    [staleDate, recentDate, input.largeAmountCentavos, recentDate, input.limit]
  )
  const findings: FinanceSanityFinding[] = []
  for (const row of rows) {
    const base = {
      transactionId: row.id,
      accountId: row.account_id,
      accountName: maybeRedactText(row.account_name, input.redacted),
      description: maybeRedactText(row.description, input.redacted),
      date: row.date,
      amount: fromCentavos(row.amount),
      amountCentavos: row.amount,
      currency: row.currency,
    }
    if ((row.status ?? 'posted') === 'pending' && row.date <= staleDate) {
      addFinding(
        findings,
        'warning',
        'old_pending_transaction',
        `Pending transaction ${row.id} is older than 7 days.`,
        base
      )
    }
    if (row.type === 'expense' && row.category_id === null && row.date >= recentDate) {
      addFinding(
        findings,
        'warning',
        'missing_category',
        `Expense transaction ${row.id} is missing a category.`,
        base
      )
    }
    if (Math.abs(row.amount) >= input.largeAmountCentavos && row.date >= recentDate) {
      addFinding(
        findings,
        'info',
        'unusually_large_transaction',
        `Transaction ${row.id} is unusually large.`,
        base
      )
    }
  }
  return findings
}

function getOtherExpensesFindings(input: {
  asOf: string
  thresholdCentavos: number
  redacted: boolean
}) {
  const monthStart = dayjs(input.asOf).startOf('month').format('YYYY-MM-DD')
  const rows = query<{ category_id: string | null; category_name: string | null; total: number }>(
    `SELECT t.category_id, c.name AS category_name, SUM(t.amount) AS total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.type = 'expense'
       AND t.date >= $1
       AND t.date <= $2
       AND COALESCE(NULLIF(TRIM(t.status), ''), 'posted') IN ('posted', 'cleared')
       AND lower(COALESCE(c.name, '')) IN ('other', 'other expenses')
     GROUP BY t.category_id, c.name
     HAVING total >= $3`,
    [monthStart, input.asOf, input.thresholdCentavos]
  )
  return rows.map((row) => ({
    severity: 'warning' as const,
    type: 'high_other_expenses',
    categoryId: row.category_id,
    categoryName: maybeRedactText(row.category_name, input.redacted),
    periodStart: monthStart,
    periodEnd: input.asOf,
    amount: fromCentavos(row.total),
    amountCentavos: row.total,
    threshold: fromCentavos(input.thresholdCentavos),
    thresholdCentavos: input.thresholdCentavos,
    message: `Other Expenses are above the configured threshold for the current month.`,
  }))
}

function getRecentAuditSanityFindings(input: { asOf: string; redacted: boolean; limit: number }) {
  if (!tableExists('audit_log')) return []
  const since = dayjs(input.asOf).subtract(7, 'day').toISOString()
  const rows = query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     WHERE created_at >= $1 AND source IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [since, input.limit]
  )
  return rows.map((row) => ({
    severity: 'info' as const,
    type: 'recent_provenance_write',
    auditId: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    source: maybeRedactText(row.source, input.redacted),
    note: maybeRedactText(row.note, input.redacted),
    createdAt: row.created_at,
    message: `Recent provenance-tagged write ${row.id} from ${input.redacted ? REDACTED_VALUE : row.source}.`,
  }))
}

const undo: ToolDefinition = {
  name: 'undo',
  description:
    'Preview or apply a safe rollback for the latest matching transaction or credit-card-statement audit entry. Dry-run is the default; pass apply=true to write.',
  schema: z.object({
    last: z
      .boolean()
      .optional()
      .default(false)
      .describe('Select the latest matching undoable audit entry'),
    source: boundedText('Source', 'Optional provenance source filter', 120).optional(),
    since: z
      .string()
      .trim()
      .datetime({ offset: true })
      .transform((value) => dayjs(value).toISOString())
      .optional()
      .describe('Only consider audit entries at or after this ISO timestamp'),
    command: boundedText(
      'Command/action',
      'Optional audit action filter, e.g. create/update/delete',
      80
    )
      .optional()
      .describe('Optional audit action filter. Currently maps to audit_log.action.'),
    account: boundedText(
      'Account reference',
      'Optional account alias, ID, or exact name filter',
      128
    )
      .optional()
      .describe('Filter transaction/statement audit snapshots by account'),
    transactionId: boundedText(
      'Transaction ID',
      'Undo the latest audit entry for this transaction',
      128
    ).optional(),
    statementId: boundedText(
      'Statement ID',
      'Undo the latest audit entry for this credit-card statement',
      128
    ).optional(),
    auditId: boundedText('Audit ID', 'Undo this exact audit entry', 160).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Force preview mode. Preview mode is also used whenever apply is false.'),
    apply: z
      .boolean()
      .optional()
      .default(false)
      .describe('Actually apply the undo. Without apply, the tool only previews.'),
    allowDependentWrites: z
      .boolean()
      .optional()
      .default(false)
      .describe('Allow undo even when later audit writes exist for the same entity'),
    note: boundedText('Undo note', 'Optional audit note for the undo operation', 1000).optional(),
  }),
  execute: async ({
    last,
    source,
    since,
    command,
    account,
    transactionId,
    statementId,
    auditId,
    dryRun,
    apply,
    allowDependentWrites,
    note,
  }) => {
    const found = findUndoAuditEntry({
      auditId,
      transactionId,
      statementId,
      last,
      source,
      since,
      command,
      account,
    })
    if (!found.success) return found

    const entry = found.entry
    const planResult = buildUndoPlan(entry)
    if ('success' in planResult && planResult.success === false) return planResult
    const plan = planResult as UndoPlan
    const dependentWrites = dependentAuditRows(entry).map((row) => formatAuditRow(row, false))
    if (dependentWrites.length > 0 && !allowDependentWrites) {
      return failure(
        'dependent_writes_exist',
        `Audit entry ${entry.id} has later writes for the same entity. Re-run with allowDependentWrites only after reviewing them.`,
        { auditEntry: formatAuditRow(entry, false), dependentWrites, wouldUndo: plan }
      )
    }

    const preview = {
      auditEntry: formatAuditRow(entry, false),
      dependentWrites,
      wouldUndo: plan,
      requiresApply: !apply,
    }
    if (!apply || dryRun) {
      return {
        success: true,
        dryRun: true,
        ...preview,
        message: `Dry run: audit entry ${entry.id} would be undone with inverse action ${plan.inverseAction}.`,
      }
    }

    applyUndoPlan(entry, plan, source, note)
    return {
      success: true,
      dryRun: false,
      auditEntry: formatAuditRow(entry, false),
      undone: plan,
      dependentWrites,
      message: `Undid audit entry ${entry.id} with inverse action ${plan.inverseAction}.`,
    }
  },
}

const financeSanityCheck: ToolDefinition = {
  name: 'finance-sanity-check',
  description:
    'Run generic automation-safe finance checks for card statements, placeholders, duplicate-looking transactions, subscriptions, recurring rules, balances, uncategorized spending, and recent provenance writes.',
  schema: z.object({
    asOf: isoDate('Date used for due/overdue checks').optional(),
    daysAhead: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .default(SANITY_DEFAULT_DAYS_AHEAD)
      .describe('Days ahead to include due-soon statements, subscriptions, and recurring rules'),
    largeTransactionAmount: z
      .number()
      .positive()
      .optional()
      .default(SANITY_DEFAULT_LARGE_TRANSACTION)
      .describe('Main-currency amount threshold for unusually large transactions'),
    otherExpensesThreshold: z
      .number()
      .positive()
      .optional()
      .default(250)
      .describe('Main-currency monthly threshold for Other Expenses warnings'),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact names, descriptions, notes, and source labels'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(SANITY_DEFAULT_LIMIT)
      .describe('Maximum rows per check'),
  }),
  execute: async ({
    asOf,
    daysAhead,
    largeTransactionAmount,
    otherExpensesThreshold,
    redacted,
    limit,
  }) => {
    const asOfDate = asOf ?? dayjs().format('YYYY-MM-DD')
    const cutoff = dayjs(asOfDate).add(daysAhead, 'day').format('YYYY-MM-DD')
    const findings: FinanceSanityFinding[] = [
      ...getCreditCardSanityFindings({ asOf: asOfDate, cutoff, redacted, limit }),
      ...getPlaceholderSanityFindings({ redacted, limit }),
      ...getDuplicateSanityFindings({ redacted, limit }),
      ...getSubscriptionSanityFindings({ cutoff, redacted, limit }),
      ...getRecurringSanityFindings({ asOf: asOfDate, cutoff, redacted, limit }),
      ...getAccountSanityFindings({ redacted, limit }),
      ...getBalanceMismatchFindings({ redacted, limit }),
      ...getTransactionHygieneFindings({
        asOf: asOfDate,
        largeAmountCentavos: Math.round(largeTransactionAmount * 100),
        redacted,
        limit,
      }),
      ...getOtherExpensesFindings({
        asOf: asOfDate,
        thresholdCentavos: Math.round(otherExpensesThreshold * 100),
        redacted,
      }),
      ...getRecentAuditSanityFindings({ asOf: asOfDate, redacted, limit }),
    ]
    const summary = findings.reduce(
      (acc, finding) => {
        acc[finding.severity] += 1
        return acc
      },
      { critical: 0, warning: 0, info: 0 } as Record<FinanceSanityFinding['severity'], number>
    )
    const status = summary.critical > 0 ? 'critical' : summary.warning > 0 ? 'warning' : 'ok'

    return {
      success: true,
      asOf: asOfDate,
      daysAhead,
      cutoffDate: cutoff,
      redacted,
      status,
      summary: {
        totalFindings: findings.length,
        ...summary,
      },
      findings,
      message:
        findings.length === 0
          ? 'Finance sanity check found no issues.'
          : `Finance sanity check found ${findings.length} finding(s): ${summary.critical} critical, ${summary.warning} warning, ${summary.info} info.`,
    }
  },
}

const auditList: ToolDefinition = {
  name: 'audit-list',
  description:
    'List audit history entries with filters for automation-safe triage. Supports redaction of free-text before/after/source/note details.',
  schema: z.object({
    since: z
      .string()
      .trim()
      .datetime({ offset: true })
      .transform((value) => dayjs(value).toISOString())
      .optional()
      .describe('Only entries at or after this ISO timestamp'),
    entity: boundedText(
      'Audit entity',
      'Filter by audit entity, e.g. transaction or budget',
      120
    ).optional(),
    entityId: boundedText('Audit entity ID', 'Filter by audited entity ID', 160).optional(),
    action: boundedText(
      'Audit action',
      'Filter by audit action, e.g. create/update/delete',
      80
    ).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_AUDIT_LIMIT)
      .optional()
      .default(DEFAULT_AUDIT_LIMIT)
      .describe(`Maximum audit rows to return (max ${MAX_AUDIT_LIMIT})`),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact sensitive/free-text before/after/source/note details'),
  }),
  execute: async ({ since, entity, entityId, action, limit, redacted }) => {
    const rows = readAuditRows({ since, entity, entityId, action, limit, redacted })

    return {
      success: true,
      redacted,
      filters: {
        since: since ?? null,
        entity: entity ?? null,
        entityId: entityId ?? null,
        action: action ?? null,
        limit,
      },
      count: rows.length,
      rows,
      message:
        rows.length === 0 ? 'No audit entries found.' : `Found ${rows.length} audit entry(s).`,
    }
  },
}

const auditShow: ToolDefinition = {
  name: 'audit-show',
  description: 'Show one audit history entry by ID with optional free-text redaction.',
  schema: z.object({
    id: boundedText('Audit ID', 'Audit log entry ID to fetch', 160),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact sensitive/free-text before/after/source/note details'),
  }),
  execute: async ({ id, redacted }) => {
    const row = query<AuditLogRow>(
      `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
       FROM audit_log
       WHERE id = $1
       LIMIT 1`,
      [id]
    )[0]

    if (!row) {
      return {
        success: false,
        reason: 'audit_entry_not_found',
        code: 'AUDIT_ENTRY_NOT_FOUND',
        message: `Audit entry ${id} not found.`,
      }
    }

    return {
      success: true,
      redacted,
      entry: formatAuditRow(row, redacted),
      message: `Found audit entry ${id}.`,
    }
  },
}

const automationContext: ToolDefinition = {
  name: 'automation-context',
  description:
    'Return one consolidated automation context payload for setup readiness, accounts, aliases, budgets, subscriptions, cards, recurring bills, support surfaces, and recent audits.',
  schema: z.object({
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Redact free-text and sensitive fields while preserving IDs, dates, amounts, and statuses'
      ),
  }),
  execute: async ({ redacted }) => {
    const generatedAt = dayjs().toISOString()
    const warnings: ContextWarning[] = []
    const setup = await getSetupContext(redacted)
    warnings.push(...setup.warnings)

    const accounts = getAccountsContext(redacted)
    const financeProfile = getFinanceProfileContext(redacted)
    const budgets = getBudgetsContext(redacted, warnings)
    const subscriptions = getSubscriptionsContext(redacted, warnings)
    const creditCards = getCreditCardsContext(redacted, warnings)
    const recurring = await getRecurringContext(redacted, warnings)
    const support = {
      goals: getGoalsSupport(redacted, warnings),
      debt: getDebtSupport(redacted),
      investments: getInvestmentSupport(redacted, warnings),
    }
    const supportSummary = getSupportSummary(support)
    const hasAuditLog = tableExists('audit_log')
    if (!hasAuditLog) {
      warnings.push({
        section: 'recentAuditEntries',
        severity: 'gap',
        message: 'audit_log table is missing; recent audit context is unavailable.',
      })
    }
    const recentAuditRows = hasAuditLog
      ? readAuditRows({ limit: ASSISTANT_CONTEXT_AUDIT_LIMIT, redacted })
      : []

    return {
      success: true,
      generatedAt,
      redacted,
      setup,
      accounts,
      financeProfile,
      budgets,
      subscriptions,
      creditCards,
      recurring,
      support,
      supportSummary,
      recentAuditEntries: {
        redacted,
        count: recentAuditRows.length,
        rows: recentAuditRows,
      },
      warnings,
      gaps: warnings.filter((warning) => warning.severity === 'gap'),
      message: `Automation context generated with ${warnings.length} warning(s).`,
    }
  },
}

export const auditAndContextTools: ToolDefinition[] = [
  undo,
  financeSanityCheck,
  auditList,
  auditShow,
  automationContext,
]
