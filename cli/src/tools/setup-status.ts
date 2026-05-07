import {
  z,
  query,
  getAccountAliases,
  getJsonSetting,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'

function count(sql: string): number {
  return query<{ count: number }>(sql)[0]?.count ?? 0
}

function hasFinanceProfile(value: unknown): boolean {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
  )
}

const setupStatus: ToolDefinition = {
  name: 'setup-status',
  description: 'Show missing or incomplete setup that affects CLI and assistant usefulness.',
  schema: z.object({}),
  execute: async () => {
    const accountCount = count('SELECT COUNT(*) as count FROM accounts WHERE is_archived = 0')
    const categoryCount = count('SELECT COUNT(*) as count FROM categories')
    const transactionCount = count('SELECT COUNT(*) as count FROM transactions')
    const activeBudgetCount = count('SELECT COUNT(*) as count FROM budgets WHERE is_active = 1')
    const activeRecurringRuleCount = count(
      'SELECT COUNT(*) as count FROM recurring_rules WHERE active = 1'
    )
    const activeSubscriptionCount = count(
      'SELECT COUNT(*) as count FROM subscriptions WHERE is_active = 1'
    )
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
        ok: activeBudgetCount > 0,
        required: false,
        count: activeBudgetCount,
        hint: 'Run shikin upsert-budget or shikin create-budget to create active budgets.',
      },
      {
        key: 'recurring_rules',
        ok: activeRecurringRuleCount > 0,
        required: false,
        count: activeRecurringRuleCount,
        hint: 'Run shikin manage-recurring-transaction to track expected recurring bills.',
      },
      {
        key: 'subscriptions',
        ok: activeSubscriptionCount > 0,
        required: false,
        count: activeSubscriptionCount,
        hint: 'Run shikin list-subscriptions to review known subscriptions.',
      },
      {
        key: 'credit_card_billing_dates',
        ok: creditCardsMissingBillingDates === 0,
        required: false,
        count: creditCardsMissingBillingDates,
        hint: 'Run shikin update-account --account-id ... --statement-closing-day ... --payment-due-day ... for credit cards missing billing dates.',
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
