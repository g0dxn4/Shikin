import {
  z,
  query,
  fromCentavos,
  dayjs,
  nextDateForDay,
  boundedText,
  getAccountAliases,
  getJsonSetting,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'
import { setupStatusTools } from './setup-status.js'
import { recurringTools } from './recurring.js'

/*
Assistant context source inventory (kept here so future maintainers can audit each section):
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

const DEFAULT_AUDIT_LIMIT = 25
const MAX_AUDIT_LIMIT = 200
const ASSISTANT_CONTEXT_AUDIT_LIMIT = 10
const ASSISTANT_CONTEXT_RECURRING_DAYS = 30
const ASSISTANT_CONTEXT_ITEM_LIMIT = 50
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
      message: 'Setup status is unavailable; assistant context returned partial data.',
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

const auditList: ToolDefinition = {
  name: 'audit-list',
  description:
    'List audit history entries with filters for assistant-safe triage. Supports redaction of free-text before/after/source/note details.',
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

const assistantContext: ToolDefinition = {
  name: 'assistant-context',
  description:
    'Return one consolidated assistant context payload for setup readiness, accounts, aliases, budgets, subscriptions, cards, recurring bills, support surfaces, and recent audits.',
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
      message: `Assistant context generated with ${warnings.length} warning(s).`,
    }
  },
}

export const auditAndContextTools: ToolDefinition[] = [auditList, auditShow, assistantContext]
