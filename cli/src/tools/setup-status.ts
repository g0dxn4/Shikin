import { existsSync } from 'node:fs'
import {
  z,
  query,
  dayjs,
  getAccountAliases,
  getJsonSetting,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'
import { DATABASE_BACKUP_SETTING_KEY } from '../database.js'

const BALANCE_SNAPSHOT_STALE_DAYS = 30
const RECENT_BACKUP_DAYS = 7
const BUDGET_SETUP_COLUMNS = ['id', 'is_active'] as const
const RECURRING_RULE_SETUP_COLUMNS = ['id', 'active'] as const
const SUBSCRIPTION_SETUP_COLUMNS = ['id', 'is_active'] as const
const BALANCE_HISTORY_SETUP_COLUMNS = ['id', 'account_id', 'date', 'balance'] as const

function count(sql: string, params?: unknown[]): number {
  return query<{ count: number }>(sql, params)[0]?.count ?? 0
}

function hasFinanceProfile(value: unknown): boolean {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
  const existingColumns = new Set(rows.map((row) => row.name))
  return columns.every((column) => existingColumns.has(column))
}

function getLatestBalanceSnapshotDate(): string | null {
  return (
    query<{ latestDate: string | null }>(
      'SELECT MAX(date) as latestDate FROM account_balance_history'
    )[0]?.latestDate ?? null
  )
}

function getBackupReadiness() {
  const settings = getJsonSetting<unknown>(DATABASE_BACKUP_SETTING_KEY, {})
  const lastBackup =
    isPlainObject(settings) && isPlainObject(settings.lastBackup) ? settings.lastBackup : null
  const path = typeof lastBackup?.path === 'string' ? lastBackup.path : null
  const createdAt = typeof lastBackup?.createdAt === 'string' ? lastBackup.createdAt : null
  const fileExists = path ? existsSync(path) : false
  const ageDays =
    createdAt && dayjs(createdAt).isValid() ? dayjs().diff(dayjs(createdAt), 'day', true) : null
  const recent = fileExists && ageDays !== null && ageDays <= RECENT_BACKUP_DAYS

  return {
    ok: recent,
    count: recent ? 1 : 0,
    details: {
      path,
      createdAt,
      fileExists,
      ageDays,
      recentWithinDays: RECENT_BACKUP_DAYS,
    },
  }
}

const setupStatus: ToolDefinition = {
  name: 'setup-status',
  description: 'Show missing or incomplete setup that affects CLI and assistant usefulness.',
  schema: z.object({}),
  execute: async () => {
    const accountCount = count('SELECT COUNT(*) as count FROM accounts WHERE is_archived = 0')
    const categoryCount = count('SELECT COUNT(*) as count FROM categories')
    const transactionCount = count('SELECT COUNT(*) as count FROM transactions')
    const hasBudgetSupport = tableHasColumns('budgets', [...BUDGET_SETUP_COLUMNS])
    const activeBudgetCount = hasBudgetSupport
      ? count('SELECT COUNT(*) as count FROM budgets WHERE is_active = 1')
      : 0
    const hasRecurringRuleSupport = tableHasColumns('recurring_rules', [
      ...RECURRING_RULE_SETUP_COLUMNS,
    ])
    const activeRecurringRuleCount = hasRecurringRuleSupport
      ? count('SELECT COUNT(*) as count FROM recurring_rules WHERE active = 1')
      : 0
    const hasSubscriptionSupport = tableHasColumns('subscriptions', [...SUBSCRIPTION_SETUP_COLUMNS])
    const activeSubscriptionCount = hasSubscriptionSupport
      ? count('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1')
      : 0
    const hasGoalsSupport = tableHasColumns('goals', [
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
    const goalCount = hasGoalsSupport ? count('SELECT COUNT(*) as count FROM goals') : 0
    const debtSupportCount = count(
      `SELECT COUNT(*) as count
       FROM accounts
       WHERE type = 'credit_card' AND is_archived = 0 AND balance < 0`
    )
    const hasInvestmentSupport = tableHasColumns('investments', [
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
    const hasStockPriceSupport = tableHasColumns('stock_prices', [
      'id',
      'symbol',
      'price',
      'currency',
      'date',
      'created_at',
    ])
    const investmentHoldingCount = hasInvestmentSupport
      ? count('SELECT COUNT(*) as count FROM investments')
      : 0
    const creditCardsMissingBillingDates = count(
      `SELECT COUNT(*) as count
       FROM accounts
       WHERE is_archived = 0
         AND type = 'credit_card'
         AND (statement_closing_day IS NULL OR payment_due_day IS NULL)`
    )
    const aliasCount = Object.keys(getAccountAliases()).length
    const financeProfilePresent = hasFinanceProfile(
      getJsonSetting<unknown>(FINANCE_PROFILE_SETTING_KEY, {})
    )
    const hasBalanceSnapshotTable = tableHasColumns('account_balance_history', [
      ...BALANCE_HISTORY_SETUP_COLUMNS,
    ])
    const staleBefore = dayjs().subtract(BALANCE_SNAPSHOT_STALE_DAYS, 'day').format('YYYY-MM-DD')
    const missingBalanceSnapshotCount = hasBalanceSnapshotTable
      ? count(
          `SELECT COUNT(*) as count
           FROM accounts a
           WHERE a.is_archived = 0
             AND NOT EXISTS (
               SELECT 1 FROM account_balance_history h WHERE h.account_id = a.id
             )`
        )
      : accountCount
    const staleBalanceSnapshotCount = hasBalanceSnapshotTable
      ? count(
          `SELECT COUNT(*) as count
           FROM accounts a
           WHERE a.is_archived = 0
             AND EXISTS (
               SELECT 1 FROM account_balance_history h WHERE h.account_id = a.id
             )
             AND (
               SELECT MAX(h.date) FROM account_balance_history h WHERE h.account_id = a.id
             ) < $1`,
          [staleBefore]
        )
      : 0
    const latestBalanceSnapshotDate = hasBalanceSnapshotTable
      ? getLatestBalanceSnapshotDate()
      : null
    const backupReadiness = getBackupReadiness()
    const assistantContextReady =
      accountCount > 0 && categoryCount > 0 && aliasCount > 0 && financeProfilePresent

    const checks = [
      {
        key: 'accounts',
        ok: accountCount > 0,
        required: true,
        count: accountCount,
        hint: 'Run shikin create-account to add at least one account.',
      },
      {
        key: 'categories',
        ok: categoryCount > 0,
        required: true,
        count: categoryCount,
        hint: 'Open the Shikin app once to seed default categories if this is zero.',
      },
      {
        key: 'account_aliases',
        ok: aliasCount > 0,
        required: false,
        count: aliasCount,
        hint: 'Run shikin set-account-alias --account-id ... --alias bbva-checking.',
      },
      {
        key: 'finance_profile',
        ok: financeProfilePresent,
        required: false,
        count: financeProfilePresent ? 1 : 0,
        hint: 'Run shikin finance-profile --action set --profile ... to store assistant preferences.',
      },
      {
        key: 'transactions',
        ok: transactionCount > 0,
        required: false,
        count: transactionCount,
        hint: 'Run shikin add-transaction or import transactions in the app.',
      },
      {
        key: 'budgets',
        ok: hasBudgetSupport && activeBudgetCount > 0,
        required: false,
        count: activeBudgetCount,
        details: {
          available: hasBudgetSupport,
        },
        hint: 'Run shikin upsert-budget or shikin create-budget to create active budgets.',
      },
      {
        key: 'recurring_rules',
        ok: hasRecurringRuleSupport && activeRecurringRuleCount > 0,
        required: false,
        count: activeRecurringRuleCount,
        details: {
          available: hasRecurringRuleSupport,
        },
        hint: 'Run shikin manage-recurring-transaction to track expected recurring bills.',
      },
      {
        key: 'subscriptions',
        ok: hasSubscriptionSupport && activeSubscriptionCount > 0,
        required: false,
        count: activeSubscriptionCount,
        details: {
          available: hasSubscriptionSupport,
        },
        hint: 'Run shikin list-subscriptions to review known subscriptions.',
      },
      {
        key: 'goals',
        ok: hasGoalsSupport,
        required: false,
        count: goalCount,
        details: {
          available: hasGoalsSupport,
          availableTools: hasGoalsSupport ? ['create-goal', 'update-goal', 'get-goal-status'] : [],
        },
        hint: hasGoalsSupport
          ? 'Run shikin get-goal-status to review savings-goal progress.'
          : 'Run the current Shikin database migrations so goal support is available.',
      },
      {
        key: 'debt_support',
        ok: true,
        required: false,
        count: debtSupportCount,
        details: {
          available: true,
          availableTools: ['get-debt-payoff-plan'],
          source: 'active credit_card accounts with negative balances',
          limitation: 'APR is not stored on accounts, so payoff projections exclude interest.',
        },
        hint: 'Run shikin get-debt-payoff-plan to model payoff for negative credit-card balances.',
      },
      {
        key: 'investment_support',
        ok: hasInvestmentSupport,
        required: false,
        count: investmentHoldingCount,
        details: {
          available: hasInvestmentSupport,
          availableTools: [
            ...(hasInvestmentSupport ? ['manage-investment'] : []),
            ...(hasInvestmentSupport && hasStockPriceSupport ? ['generate-portfolio-review'] : []),
          ],
          stockPricesAvailable: hasStockPriceSupport,
          scope:
            'Stored holdings and portfolio review only; this setup check does not expand investment features.',
        },
        hint: hasInvestmentSupport
          ? 'Run shikin manage-investment for holdings or shikin generate-portfolio-review for a stored-holdings review.'
          : 'Run the current Shikin database migrations so investment support is available.',
      },
      {
        key: 'credit_card_billing_dates',
        ok: creditCardsMissingBillingDates === 0,
        required: false,
        count: creditCardsMissingBillingDates,
        hint: 'Run shikin update-account --account-id ... --statement-closing-day ... --payment-due-day ... for credit cards missing billing dates.',
      },
      {
        key: 'balance_snapshots',
        ok:
          hasBalanceSnapshotTable &&
          (accountCount === 0 ||
            (missingBalanceSnapshotCount === 0 && staleBalanceSnapshotCount === 0)),
        required: false,
        count: missingBalanceSnapshotCount + staleBalanceSnapshotCount,
        details: {
          tablePresent: hasBalanceSnapshotTable,
          activeAccounts: accountCount,
          missing: missingBalanceSnapshotCount,
          stale: staleBalanceSnapshotCount,
          latestDate: latestBalanceSnapshotDate,
          staleAfterDays: BALANCE_SNAPSHOT_STALE_DAYS,
        },
        hint: 'Run shikin balance-snapshot for accounts with missing or stale observed balances.',
      },
      {
        key: 'recent_backup',
        ok: backupReadiness.ok,
        required: false,
        count: backupReadiness.count,
        details: backupReadiness.details,
        hint: 'Run shikin backup-database to create a recent manual database backup.',
      },
      {
        key: 'assistant_context_readiness',
        ok: assistantContextReady,
        required: false,
        count: assistantContextReady ? 1 : 0,
        details: {
          accounts: accountCount > 0,
          categories: categoryCount > 0,
          accountAliases: aliasCount > 0,
          financeProfile: financeProfilePresent,
        },
        hint: 'Configure account aliases and a finance profile so assistant workflows have stable context.',
      },
    ]
    const missingRequired = checks.filter((check) => check.required && !check.ok)

    return {
      success: true,
      setupComplete: missingRequired.length === 0,
      checks,
      message:
        missingRequired.length === 0
          ? 'Required CLI setup is complete.'
          : `Missing required setup: ${missingRequired.map((check) => check.key).join(', ')}.`,
    }
  },
}

export const setupStatusTools: ToolDefinition[] = [setupStatus]
