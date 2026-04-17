import {
  z,
  query,
  execute,
  generateId,
  toCentavos,
  fromCentavos,
  boundedText,
  assetCode,
  moneyAmount,
  nonNegativeMoneyAmount,
  normalizeCurrencyCode,
  recurringRuleAccountCurrencyChangeBlockedMessage,
  type ToolDefinition,
} from './shared.js'

type AccountRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
  credit_limit: number | null
  statement_closing_day: number | null
  payment_due_day: number | null
}

type CategoryRow = {
  id: string
  name: string
  type: string
  color: string | null
}

const listAccounts: ToolDefinition = {
  name: 'list-accounts',
  description:
    'List all active accounts. Use this when the user asks about their accounts, balances, or needs to pick an account.',
  schema: z.object({
    type: z
      .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
      .optional()
      .describe('Filter by account type'),
  }),
  execute: async ({ type }) => {
    const params: unknown[] = []
    let sql = 'SELECT * FROM accounts WHERE is_archived = 0'

    if (type) {
      sql += ' AND type = $1'
      params.push(type)
    }

    sql += ' ORDER BY name'

    const accounts = await query<AccountRow>(sql, params)

    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance: fromCentavos(a.balance),
      })),
      message:
        accounts.length === 0
          ? 'No accounts found.'
          : `Found ${accounts.length} account${accounts.length !== 1 ? 's' : ''}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 7. create-account
// ---------------------------------------------------------------------------
const createAccount: ToolDefinition = {
  name: 'create-account',
  description:
    'Create a new financial account. Use this when the user wants to add a bank account, credit card, cash wallet, or other account.',
  schema: z.object({
    name: boundedText(
      'Account name',
      'Account name (e.g. "Chase Checking", "BBVA Credit Card")',
      120
    ),
    type: z
      .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
      .optional()
      .default('checking')
      .describe('Account type (default: checking)'),
    currency: assetCode('Currency or asset code (default: USD)').optional().default('USD'),
    balance: moneyAmount('Initial balance in the main currency unit (default: 0)')
      .optional()
      .default(0),
    creditLimit: nonNegativeMoneyAmount(
      'Credit limit in the main currency unit (only for credit_card type)'
    ).optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('Day of the month the statement closes (1-31, only for credit_card type)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('Day of the month payment is due (1-31, only for credit_card type)'),
  }),
  execute: async ({
    name,
    type,
    currency,
    balance,
    creditLimit,
    statementClosingDay,
    paymentDueDay,
  }) => {
    const id = generateId()
    const balanceCentavos = toCentavos(balance)
    const creditLimitCentavos = creditLimit !== undefined ? toCentavos(creditLimit) : null

    await execute(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
      [
        id,
        name,
        type,
        currency,
        balanceCentavos,
        creditLimitCentavos,
        statementClosingDay ?? null,
        paymentDueDay ?? null,
      ]
    )

    const parts = [
      `Created ${type} account "${name}" with balance $${fromCentavos(balanceCentavos).toFixed(2)}`,
    ]
    if (creditLimit !== undefined) parts.push(`credit limit: $${creditLimit.toFixed(2)}`)
    if (statementClosingDay !== undefined) parts.push(`closing day: ${statementClosingDay}`)
    if (paymentDueDay !== undefined) parts.push(`payment due day: ${paymentDueDay}`)

    return {
      success: true,
      account: {
        id,
        name,
        type,
        currency,
        balance: fromCentavos(balanceCentavos),
        creditLimit: creditLimit ?? undefined,
        statementClosingDay: statementClosingDay ?? undefined,
        paymentDueDay: paymentDueDay ?? undefined,
      },
      message: parts.join(', '),
    }
  },
}

// ---------------------------------------------------------------------------
// 8. update-account
// ---------------------------------------------------------------------------
const updateAccount: ToolDefinition = {
  name: 'update-account',
  description:
    'Update an existing account. Use this to change the name, type, currency, balance, credit limit, or billing dates of an account.',
  schema: z.object({
    accountId: boundedText('Account ID', 'The ID of the account to update', 128),
    name: boundedText('Account name', 'New account name', 120).optional(),
    type: z
      .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
      .optional()
      .describe('New account type'),
    currency: assetCode('New currency or asset code').optional(),
    balance: moneyAmount('New balance in main currency unit').optional(),
    creditLimit: nonNegativeMoneyAmount('New credit limit in main currency unit').optional(),
    statementClosingDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('New statement closing day (1-31)'),
    paymentDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('New payment due day (1-31)'),
  }),
  execute: async ({
    accountId,
    name,
    type,
    currency,
    balance,
    creditLimit,
    statementClosingDay,
    paymentDueDay,
  }) => {
    const existing = await query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [accountId])

    if (existing.length === 0) {
      return { success: false, message: `Account ${accountId} not found.` }
    }

    const account = existing[0]
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (
      currency !== undefined &&
      normalizeCurrencyCode(currency) !== normalizeCurrencyCode(account.currency)
    ) {
      const targetCurrency = normalizeCurrencyCode(currency)
      const linkedRecurringRules = query<{ currency: string | null }>(
        'SELECT currency FROM recurring_rules WHERE account_id = $1',
        [accountId]
      )
      const blockingRuleCount = linkedRecurringRules.filter((rule) => {
        const ruleCurrency = normalizeCurrencyCode(rule.currency)
        return ruleCurrency === '' || ruleCurrency !== targetCurrency
      }).length

      if (blockingRuleCount > 0) {
        return {
          success: false,
          message: recurringRuleAccountCurrencyChangeBlockedMessage(blockingRuleCount),
        }
      }
    }

    if (name !== undefined) {
      setClauses.push(`name = $${paramIdx++}`)
      params.push(name)
    }
    if (type !== undefined) {
      setClauses.push(`type = $${paramIdx++}`)
      params.push(type)
    }
    if (currency !== undefined) {
      setClauses.push(`currency = $${paramIdx++}`)
      params.push(currency)
    }
    if (balance !== undefined) {
      setClauses.push(`balance = $${paramIdx++}`)
      params.push(toCentavos(balance))
    }
    if (creditLimit !== undefined) {
      setClauses.push(`credit_limit = $${paramIdx++}`)
      params.push(toCentavos(creditLimit))
    }
    if (statementClosingDay !== undefined) {
      setClauses.push(`statement_closing_day = $${paramIdx++}`)
      params.push(statementClosingDay)
    }
    if (paymentDueDay !== undefined) {
      setClauses.push(`payment_due_day = $${paramIdx++}`)
      params.push(paymentDueDay)
    }

    if (setClauses.length === 0) {
      return { success: false, message: 'No fields to update.' }
    }

    setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    params.push(accountId)

    await execute(`UPDATE accounts SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`, params)

    return {
      success: true,
      message: `Updated account "${name ?? account.name}".`,
    }
  },
}

// ---------------------------------------------------------------------------
// 9. delete-account
// ---------------------------------------------------------------------------
const deleteAccount: ToolDefinition = {
  name: 'delete-account',
  description:
    'Delete or archive an account. If the account has linked transactions it will be archived instead of deleted.',
  schema: z.object({
    accountId: z.string().describe('The ID of the account to delete'),
  }),
  execute: async ({ accountId }) => {
    const existing = await query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [accountId])

    if (existing.length === 0) {
      return { success: false, message: `Account ${accountId} not found.` }
    }

    const account = existing[0]

    const txCount = await query<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions WHERE account_id = $1',
      [accountId]
    )

    const hasTransactions = txCount.length > 0 && txCount[0].count > 0

    if (hasTransactions) {
      await execute(
        "UPDATE accounts SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1",
        [accountId]
      )

      return {
        success: true,
        action: 'archived',
        message: `Archived account "${account.name}" (has ${txCount[0].count} linked transactions).`,
      }
    }

    await execute('DELETE FROM accounts WHERE id = $1', [accountId])

    return {
      success: true,
      action: 'deleted',
      message: `Deleted account "${account.name}".`,
    }
  },
}

// ---------------------------------------------------------------------------
// 10. list-categories
// ---------------------------------------------------------------------------
const listCategories: ToolDefinition = {
  name: 'list-categories',
  description:
    'List available transaction categories. Use this when the user asks about categories or needs to pick one.',
  schema: z.object({
    type: z.enum(['expense', 'income', 'transfer']).optional().describe('Filter by category type'),
  }),
  execute: async ({ type }) => {
    const params: unknown[] = []
    let sql = 'SELECT * FROM categories'

    if (type) {
      sql += ' WHERE type = $1'
      params.push(type)
    }

    sql += ' ORDER BY sort_order'

    const categories = await query<CategoryRow>(sql, params)

    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        color: c.color,
      })),
      message:
        categories.length === 0
          ? 'No categories found.'
          : `Found ${categories.length} categor${categories.length !== 1 ? 'ies' : 'y'}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 11. get-balance-overview
// ---------------------------------------------------------------------------

export const accountsTools: ToolDefinition[] = [
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  listCategories,
]
