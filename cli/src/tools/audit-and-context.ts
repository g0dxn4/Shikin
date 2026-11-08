import { REPORTING_CTE, reportingReadFailure } from '../reporting-read.js'
import {
  z,
  query,
  fromCentavos,
  dayjs,
  nextDateForDay,
  boundedText,
  isoDate,
  getAccountAliases,
  getJsonSetting,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'
import { setupStatusTools } from './setup-status.js'
import { recurringTools } from './recurring.js'
import { findTransactionDuplicate, transactionDuplicateReason } from '../duplicate-detection.js'
import { paymentAmounts, effectiveStatementStatus } from '../statement-read.js'
import {
  type AuditLogRow,
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  REDACTED_VALUE,
  isPlainObject,
  redactAuditStructuredValue,
  redactText,
  formatAuditRow,
  readAuditRows,
} from '../audit-read.js'

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
  account_mode?: 'transactional' | 'snapshot_only' | null
}

type BudgetContextRow = {
  id: string
  name: string
  currency: string
  scope_json: string
  basis: string
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
  unattributed_paid_amount: number
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

type FinanceSanityFinding = {
  severity: 'info' | 'warning' | 'critical'
  type: string
  message: string
  [key: string]: unknown
}

const ASSISTANT_CONTEXT_AUDIT_LIMIT = 10
const ASSISTANT_CONTEXT_RECURRING_DAYS = 30
const ASSISTANT_CONTEXT_ITEM_LIMIT = 50
const SANITY_DEFAULT_DAYS_AHEAD = 30
const SANITY_DEFAULT_LIMIT = 25
const SANITY_DEFAULT_LARGE_TRANSACTION = 1000
const GOAL_SUPPORT_TOOLS = ['create-goal', 'update-goal', 'get-goal-status'] as const
const DEBT_SUPPORT_TOOLS = ['get-debt-payoff-plan'] as const
const INVESTMENT_SUPPORT_TOOLS = [
  'list-investments',
  'manage-investment',
  'generate-portfolio-review',
] as const
const REDACTED_KEY_PATTERN =
  /(?:account[_-]?number|routing[_-]?number|card[_-]?number|iban|swift|secret|token|password|private[_-]?key|name|title|description|notes?|source|url|value|summary|memo|content|pattern|tags|path|file|before_json|after_json)/i
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

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableJsonValue(nested)])
  )
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

function maybeRedactObject<T>(value: T, redacted: boolean): T | unknown {
  return redacted ? redactStructuredValue(value) : value
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
  if (
    !tableHasColumns('budgets', [
      'id',
      'name',
      'amount',
      'currency',
      'scope_json',
      'basis',
      'period',
      'category_id',
      'is_active',
    ])
  ) {
    warnings.push({
      section: 'budgets',
      severity: 'gap',
      message: 'budgets table is missing or incomplete; active budget context is unavailable.',
    })
    return { available: false, count: 0, active: [] }
  }

  const budgets = query<BudgetContextRow>(
    `SELECT b.id, b.name, b.amount, b.currency, b.scope_json, b.basis, b.period, b.category_id, b.is_active,
            c.name AS category_name
     FROM budgets b
     LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.is_active = 1
     ORDER BY b.period ASC, b.name ASC, b.id ASC`
  )
  const totals = new Map<string, number>()
  if (budgets.length === 1) addCurrencyTotal(totals, budgets[0].currency, budgets[0].amount)

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
      currency: budget.currency,
      scope: maybeRedactObject(
        (() => {
          try {
            return JSON.parse(budget.scope_json)
          } catch {
            return null
          }
        })(),
        redacted
      ),
      basis: budget.basis,
      period: budget.period,
      isActive: budget.is_active === 1,
    })),
    summary: {
      activeCount: budgets.length,
      totalsByCurrency: currencyTotalsSnapshot(totals),
      currencyNote:
        budgets.length > 1
          ? 'Independent budgets are nonadditive; no aggregate total.'
          : 'Stored native plan currency; not a dated valuation.',
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
      unattributedPaidAmount: fromCentavos(
        statement.unattributed_paid_amount ?? statement.paid_amount
      ),
      unattributedPaidAmountCentavos: statement.unattributed_paid_amount ?? statement.paid_amount,
      linkedPaidAmount: fromCentavos(
        statement.paid_amount - (statement.unattributed_paid_amount ?? statement.paid_amount)
      ),
      linkedPaidAmountCentavos:
        statement.paid_amount - (statement.unattributed_paid_amount ?? statement.paid_amount),
      legacyOverpaid: statement.paid_amount > statement.statement_balance,
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
    'list-investments',
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
  const dueRows = query<CreditCardStatementContextRow>(
    `SELECT s.*, a.name AS account_name
     FROM credit_card_statements s
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE s.statement_balance > s.paid_amount
       AND s.due_date <= $1
     ORDER BY s.due_date ASC, s.statement_end_date DESC, s.id ASC
     LIMIT $2`,
    [input.cutoff, input.limit]
  )
  const dueFindings = dueRows.map((statement) => {
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
  if (
    !tableHasColumns('credit_card_statements', ['unattributed_paid_amount']) ||
    !tableExists('card_statement_payment_links')
  )
    return dueFindings
  const evidenceRows = query<
    CreditCardStatementContextRow & { linked_amount: number; account_name: string | null }
  >(
    `SELECT s.*, a.name AS account_name,
            COALESCE(SUM(CASE WHEN l.voided_at IS NULL THEN l.amount ELSE 0 END), 0) AS linked_amount
     FROM credit_card_statements s
     LEFT JOIN accounts a ON a.id = s.account_id
     LEFT JOIN card_statement_payment_links l ON l.statement_id = s.id
     GROUP BY s.id
     HAVING s.unattributed_paid_amount + linked_amount <> s.paid_amount
         OR s.paid_amount > s.statement_balance
     ORDER BY s.due_date ASC, s.id ASC
     LIMIT $1`,
    [input.limit]
  )
  const evidenceFindings = evidenceRows.map((statement) => {
    const inconsistent =
      statement.unattributed_paid_amount + statement.linked_amount !== statement.paid_amount
    return {
      severity: inconsistent ? ('critical' as const) : ('warning' as const),
      type: inconsistent
        ? 'credit_card_payment_evidence_inconsistent'
        : 'credit_card_statement_legacy_overpaid',
      statementId: statement.id,
      accountId: statement.account_id,
      accountName: maybeRedactText(statement.account_name, input.redacted),
      statementBalanceCentavos: statement.statement_balance,
      paidAmountCentavos: statement.paid_amount,
      unattributedPaidAmountCentavos: statement.unattributed_paid_amount,
      linkedAmountCentavos: statement.linked_amount,
      currency: statement.currency,
      message: inconsistent
        ? `Statement ${statement.id} paid total does not equal unattributed baseline plus active payment links.`
        : `Statement ${statement.id} retains a historical overpayment; it was not clipped.`,
    } satisfies FinanceSanityFinding
  })
  return [...evidenceFindings, ...dueFindings].slice(0, input.limit)
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
    source: string | null
    note: string | null
  }>(
    `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.amount, t.currency, t.type,
            COALESCE(NULLIF(TRIM(t.status), ''), 'posted') AS status,
             t.transfer_to_account_id, t.description, t.source, t.note
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.type IN ('expense', 'income', 'transfer')
       AND t.account_id IS NOT NULL
       AND t.date IS NOT NULL
        AND t.description IS NOT NULL
        AND COALESCE(t.is_archived, 0) = 0
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
      source: row.source,
      note: row.note,
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
      duplicateSignals: match.signals,
      provenance: match.provenance,
      message:
        match.kind === 'exact_duplicate'
          ? `Transactions ${transactionIds[0]} and ${transactionIds[1]} match on ${match.signals.join(', ')}.`
          : `Transactions ${transactionIds[0]} and ${transactionIds[1]} match on ${match.signals.join(', ')} within ${match.windowDays} days.`,
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
    account_mode: 'transactional' | 'snapshot_only' | null
  }>(
    `SELECT a.id, a.name, a.currency, a.balance AS stored_balance, a.account_mode,
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
                 AND COALESCE(t2.ledger_treatment, 'normal') = 'normal'
                 AND COALESCE(t2.is_archived, 0) = 0
             ), 0) AS computed_balance
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id
       AND COALESCE(t.ledger_treatment, 'normal') = 'normal'
       AND COALESCE(t.is_archived, 0) = 0
     WHERE COALESCE(a.is_archived, 0) = 0
     GROUP BY a.id
     HAVING ABS(stored_balance - computed_balance) > 0
     ORDER BY ABS(stored_balance - computed_balance) DESC
     LIMIT $1`,
    [input.limit]
  )
  return rows.map((row) => ({
    severity: row.account_mode === 'snapshot_only' ? ('info' as const) : ('critical' as const),
    type: row.account_mode === 'snapshot_only' ? 'snapshot_ledger_difference' : 'balance_mismatch',
    accountId: row.id,
    accountName: maybeRedactText(row.name, input.redacted),
    storedBalance: fromCentavos(row.stored_balance),
    storedBalanceCentavos: row.stored_balance,
    computedBalance: fromCentavos(row.computed_balance ?? 0),
    computedBalanceCentavos: row.computed_balance ?? 0,
    currency: row.currency,
    accountMode: row.account_mode ?? 'transactional',
    message:
      row.account_mode === 'snapshot_only'
        ? `Snapshot-only account ${row.id} valuation differs from its incomplete transaction ledger; this is informational until holdings or history are imported.`
        : `Account ${row.id} stored balance differs from transaction-derived balance.`,
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
      WHERE (
        (COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = 'pending' AND t.date <= $1)
        OR (t.type = 'expense' AND t.category_id IS NULL AND t.date >= $2)
        OR (ABS(t.amount) >= $3 AND t.date >= $4)
      )
        AND COALESCE(t.is_archived, 0) = 0
        AND COALESCE(t.transaction_kind, 'standard') <> 'reconciliation_bridge'
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
  const failure = reportingReadFailure(monthStart, input.asOf)
  if (failure)
    return [{ severity: 'warning' as const, type: 'incomplete_cashflow_reporting', ...failure }]
  const rows = query<{
    currency: string
    category_id: string | null
    category_name: string | null
    total: number
  }>(
    `${REPORTING_CTE}
     SELECT t.currency, t.category_id, c.name AS category_name, SUM(t.amount) AS total
     FROM category_allocations t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
       AND lower(COALESCE(c.name, '')) IN ('other', 'other expenses')
     GROUP BY t.currency, t.category_id, c.name
     HAVING total >= $3`,
    [monthStart, input.asOf, input.thresholdCentavos]
  )
  return rows.map((row) => ({
    severity: 'warning' as const,
    type: 'high_other_expenses',
    basis: 'gross_cashflow',
    currency: row.currency,
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
      success: !findings.some((finding) => finding.type === 'incomplete_cashflow_reporting'),
      complete: !findings.some((finding) => finding.type === 'incomplete_cashflow_reporting'),
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
  financeSanityCheck,
  auditList,
  auditShow,
  automationContext,
]
