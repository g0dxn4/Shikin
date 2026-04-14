/* eslint-disable @typescript-eslint/no-explicit-any, no-useless-assignment */
import { z } from 'zod'
import { query, execute, transaction } from './database.js'
import { generateId } from './ulid.js'
import { toCentavos, fromCentavos } from './money.js'
import { readNote, writeNote, appendNote, noteExists, listNotes } from './notebook.js'
import { isSafeNotebookPathInput } from './notebook-path.js'
import dayjs from 'dayjs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string
  description: string
  schema: z.ZodObject<any>
  execute: (input: any) => Promise<any>
  mcpUnavailableMessage?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextDateForDay(day: number): dayjs.Dayjs {
  const today = dayjs()
  const thisMonth = today.date(Math.min(day, today.daysInMonth()))
  if (thisMonth.isAfter(today) || thisMonth.isSame(today, 'day')) {
    return thisMonth
  }
  const nextMonth = today.add(1, 'month')
  return nextMonth.date(Math.min(day, nextMonth.daysInMonth()))
}

function advanceDate(current: string, frequency: string): string {
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

function boundedText(label: string, description: string, maxLength = 255) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer`)
    .describe(description)
}

function isoDate(description: string) {
  return z
    .string()
    .trim()
    .regex(ISO_DATE_PATTERN, 'Date must be in YYYY-MM-DD format')
    .refine(isStrictIsoDate, 'Date must be a real calendar date')
    .describe(description)
}

function currencyCode(description: string) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .regex(CURRENCY_CODE_PATTERN, 'Currency code must be a 3-letter ISO code')
    .describe(description)
}

function notebookPathSchema(description: string, options?: { allowEmpty?: boolean }) {
  return z
    .string()
    .trim()
    .refine(
      (value) => isSafeNotebookPathInput(value, options),
      'Path must stay within the notebook'
    )
    .describe(description)
}

function assetCode(description: string) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .regex(ASSET_CODE_PATTERN, 'Code must be 2-10 uppercase letters or digits')
    .describe(description)
}

function moneyAmount(
  description: string,
  { min = -MAX_ABSOLUTE_AMOUNT, max = MAX_ABSOLUTE_AMOUNT }: { min?: number; max?: number } = {}
): z.ZodNumber {
  return z.number().finite().min(min).max(max).describe(description)
}

function positiveMoneyAmount(description: string, max = MAX_ABSOLUTE_AMOUNT): z.ZodNumber {
  return z.number().finite().positive().max(max).describe(description)
}

function nonNegativeMoneyAmount(description: string, max = MAX_ABSOLUTE_AMOUNT): z.ZodNumber {
  return moneyAmount(description, { min: 0, max })
}

function isStrictIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false

  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

// ---------------------------------------------------------------------------
// 1. add-transaction
// ---------------------------------------------------------------------------

const addTransaction: ToolDefinition = {
  name: 'add-transaction',
  description:
    'Add a new financial transaction (expense, income, or transfer). Use this when the user wants to record spending, earnings, or money movement between accounts.',
  schema: z.object({
    amount: positiveMoneyAmount(
      'The transaction amount in the main currency unit (e.g. 12.50, not cents; max 1,000,000,000)'
    ),
    type: z.enum(['expense', 'income', 'transfer']).describe('The type of transaction'),
    description: boundedText('Description', 'A short description of the transaction', 200),
    category: boundedText(
      'Category',
      'Category name (e.g. "Food & Dining", "Salary"). Will match the closest existing category.',
      120
    ).optional(),
    date: isoDate('Transaction date in YYYY-MM-DD format. Defaults to today.').optional(),
    notes: boundedText('Notes', 'Additional notes about the transaction', 1000).optional(),
    accountId: boundedText(
      'Account ID',
      'Optional account ID to apply the transaction to. Defaults to the first account when omitted.',
      128
    ).optional(),
  }),
  execute: async ({ amount, type, description, category, date, notes, accountId }) => {
    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const txDate = date || dayjs().format('YYYY-MM-DD')

    return transaction(() => {
      let categoryId: string | null = null
      if (category) {
        const categories = query<{ id: string }>(
          'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
          [`%${category}%`]
        )
        if (categories.length > 0) {
          categoryId = categories[0].id
        }
      }

      let resolvedAccountId = accountId ?? null
      if (resolvedAccountId) {
        const accounts = query<{ id: string }>('SELECT id FROM accounts WHERE id = $1 LIMIT 1', [
          resolvedAccountId,
        ])
        if (accounts.length === 0) {
          return {
            success: false,
            message: `Account ${resolvedAccountId} not found.`,
          }
        }
        resolvedAccountId = accounts[0].id
      } else {
        const accounts = query<{ id: string }>('SELECT id FROM accounts LIMIT 1')
        resolvedAccountId = accounts.length > 0 ? accounts[0].id : null
      }

      if (!resolvedAccountId) {
        return {
          success: false,
          message: 'No accounts found. Please create an account first.',
        }
      }

      execute(
        `INSERT INTO transactions (id, account_id, category_id, type, amount, description, notes, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          resolvedAccountId,
          categoryId,
          type,
          amountCentavos,
          description,
          notes || null,
          txDate,
        ]
      )

      const balanceChange = type === 'income' ? amountCentavos : -amountCentavos
      execute(
        "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [balanceChange, resolvedAccountId]
      )

      return {
        success: true,
        transaction: {
          id,
          accountId: resolvedAccountId,
          amount,
          type,
          description,
          category: category || 'Uncategorized',
          date: txDate,
        },
        message: `Added ${type}: $${amount.toFixed(2)} for "${description}" on ${txDate}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 2. update-transaction
// ---------------------------------------------------------------------------

const updateTransaction: ToolDefinition = {
  name: 'update-transaction',
  description:
    'Update an existing transaction. Use this when the user wants to change the amount, description, category, date, or other details of a transaction.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'The ID of the transaction to update', 128),
    amount: positiveMoneyAmount('New amount in the main currency unit (e.g. 12.50)').optional(),
    type: z.enum(['expense', 'income', 'transfer']).optional().describe('New transaction type'),
    description: boundedText('Description', 'New description', 200).optional(),
    category: boundedText(
      'Category',
      'New category name — will match the closest existing category',
      120
    ).optional(),
    date: isoDate('New date in YYYY-MM-DD format').optional(),
    notes: z.string().max(1000).optional().describe('New notes. Pass an empty string to clear.'),
    accountId: boundedText(
      'Account ID',
      'New account ID to move the transaction to',
      128
    ).optional(),
  }),
  execute: async ({
    transactionId,
    amount,
    type,
    description,
    category,
    date,
    notes,
    accountId,
  }) => {
    return transaction(() => {
      const existing = query<any>('SELECT * FROM transactions WHERE id = $1', [transactionId])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]
      const oldAmountCentavos = tx.amount
      const oldType = tx.type
      const oldAccountId = tx.account_id

      const newAmount = amount !== undefined ? toCentavos(amount) : oldAmountCentavos
      const newType = type || oldType
      const newAccountId = accountId || oldAccountId

      if (accountId !== undefined && accountId !== oldAccountId) {
        const accounts = query<{ id: string }>('SELECT id FROM accounts WHERE id = $1 LIMIT 1', [
          accountId,
        ])
        if (accounts.length === 0) {
          return { success: false, message: `Account ${accountId} not found.` }
        }
      }

      let newCategoryId = tx.category_id
      if (category !== undefined) {
        const categories = query<{ id: string }>(
          'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
          [`%${category}%`]
        )
        newCategoryId = categories.length > 0 ? categories[0].id : null
      }

      // Reverse old balance impact
      const oldBalanceChange = oldType === 'income' ? oldAmountCentavos : -oldAmountCentavos
      execute(
        "UPDATE accounts SET balance = balance - $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [oldBalanceChange, oldAccountId]
      )

      // Apply new balance impact
      const newBalanceChange = newType === 'income' ? newAmount : -newAmount
      execute(
        "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [newBalanceChange, newAccountId]
      )

      const updateResult = execute(
        `UPDATE transactions
         SET amount = $1, type = $2, description = $3, category_id = $4, date = $5, notes = $6, account_id = $7,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $8`,
        [
          newAmount,
          newType,
          description !== undefined ? description : tx.description,
          newCategoryId,
          date || tx.date,
          notes !== undefined ? (notes === '' ? null : notes) : tx.notes,
          newAccountId,
          transactionId,
        ]
      )

      if (updateResult.rowsAffected !== 1) {
        throw new Error(`Transaction ${transactionId} could not be updated safely.`)
      }

      const displayAmount = amount !== undefined ? amount : fromCentavos(oldAmountCentavos)

      return {
        success: true,
        transaction: {
          id: transactionId,
          amount: displayAmount,
          type: newType,
          description: description !== undefined ? description : tx.description,
          date: date || tx.date,
        },
        message: `Updated transaction ${transactionId}: $${displayAmount.toFixed(2)} ${newType}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 3. delete-transaction
// ---------------------------------------------------------------------------

const deleteTransaction: ToolDefinition = {
  name: 'delete-transaction',
  description:
    'Delete a transaction. Use this when the user wants to remove a transaction. The account balance will be adjusted accordingly.',
  schema: z.object({
    transactionId: z.string().describe('The ID of the transaction to delete'),
  }),
  execute: async ({ transactionId }) => {
    return transaction(() => {
      const existing = query<any>('SELECT * FROM transactions WHERE id = $1', [transactionId])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]

      const balanceChange = tx.type === 'income' ? tx.amount : -tx.amount
      execute(
        "UPDATE accounts SET balance = balance - $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [balanceChange, tx.account_id]
      )

      execute('DELETE FROM transactions WHERE id = $1', [transactionId])

      return {
        success: true,
        message: `Deleted ${tx.type}: $${fromCentavos(tx.amount).toFixed(2)} "${tx.description}" from ${tx.date}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 4. query-transactions
// ---------------------------------------------------------------------------

const queryTransactions: ToolDefinition = {
  name: 'query-transactions',
  description:
    'Search and filter transactions. Use this when the user asks about their transactions, wants to find specific ones, or asks questions about their financial history.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Filter by account ID', 128).optional(),
    categoryId: boundedText('Category ID', 'Filter by category ID', 128).optional(),
    type: z
      .enum(['expense', 'income', 'transfer'])
      .optional()
      .describe('Filter by transaction type'),
    startDate: isoDate('Start date (YYYY-MM-DD) inclusive').optional(),
    endDate: isoDate('End date (YYYY-MM-DD) inclusive').optional(),
    search: boundedText(
      'Search term',
      'Search term to match against transaction descriptions',
      200
    ).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of results (default 20, max 100)'),
  }),
  execute: async ({ accountId, categoryId, type, startDate, endDate, search, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 0

    if (accountId) {
      paramIndex++
      conditions.push(`t.account_id = $${paramIndex}`)
      params.push(accountId)
    }
    if (categoryId) {
      paramIndex++
      conditions.push(`t.category_id = $${paramIndex}`)
      params.push(categoryId)
    }
    if (type) {
      paramIndex++
      conditions.push(`t.type = $${paramIndex}`)
      params.push(type)
    }
    if (startDate) {
      paramIndex++
      conditions.push(`t.date >= $${paramIndex}`)
      params.push(startDate)
    }
    if (endDate) {
      paramIndex++
      conditions.push(`t.date <= $${paramIndex}`)
      params.push(endDate)
    }
    if (search) {
      paramIndex++
      conditions.push(`t.description LIKE $${paramIndex}`)
      params.push(`%${search}%`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    paramIndex++
    const limitParam = `$${paramIndex}`
    params.push(limit)

    const transactions = await query<any>(
      `SELECT t.id, t.description, t.amount, t.type, t.date, t.notes,
              COALESCE(c.name, 'Uncategorized') as category_name,
              a.name as account_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       ${whereClause}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT ${limitParam}`,
      params
    )

    const countResult = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions t ${whereClause}`,
      params.slice(0, -1)
    )

    const totalMatched = countResult[0]?.count || 0

    return {
      transactions: transactions.map((t: any) => ({
        id: t.id,
        description: t.description,
        amount: fromCentavos(t.amount),
        type: t.type,
        category: t.category_name,
        account: t.account_name,
        date: t.date,
        notes: t.notes,
      })),
      count: transactions.length,
      totalMatched,
      message:
        transactions.length === 0
          ? 'No transactions found matching your criteria.'
          : `Found ${totalMatched} transaction${totalMatched !== 1 ? 's' : ''}${transactions.length < totalMatched ? `, showing first ${transactions.length}` : ''}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 5. get-spending-summary
// ---------------------------------------------------------------------------

const getSpendingSummary: ToolDefinition = {
  name: 'get-spending-summary',
  description:
    'Get a summary of spending by category for a given time period. Use this when the user asks about their spending, expenses, or budget status.',
  schema: z.object({
    period: z
      .enum(['week', 'month', 'year', 'custom'])
      .optional()
      .default('month')
      .describe('The time period to summarize'),
    startDate: isoDate('Start date (YYYY-MM-DD) for custom period').optional(),
    endDate: isoDate('End date (YYYY-MM-DD) for custom period').optional(),
  }),
  execute: async ({ period, startDate, endDate }) => {
    let start: string
    let end: string

    if (period === 'custom' && startDate && endDate) {
      start = startDate
      end = endDate
    } else {
      const now = dayjs()
      end = now.format('YYYY-MM-DD')
      switch (period) {
        case 'week':
          start = now.subtract(7, 'day').format('YYYY-MM-DD')
          break
        case 'year':
          start = now.startOf('year').format('YYYY-MM-DD')
          break
        default:
          start = now.startOf('month').format('YYYY-MM-DD')
      }
    }

    const spending = await query<{ category_name: string; total: number; count: number }>(
      `SELECT
         COALESCE(c.name, 'Uncategorized') as category_name,
         SUM(t.amount) as total,
         COUNT(*) as count
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.type = 'expense'
         AND t.date >= $1
         AND t.date <= $2
       GROUP BY c.name
       ORDER BY total DESC`,
      [start, end]
    )

    const totalIncome = await query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE type = 'income' AND date >= $1 AND date <= $2`,
      [start, end]
    )

    const totalExpenses = spending.reduce((sum, row) => sum + row.total, 0)
    const income = totalIncome[0]?.total || 0

    return {
      period: { start, end },
      totalExpenses: fromCentavos(totalExpenses),
      totalIncome: fromCentavos(income),
      netSavings: fromCentavos(income - totalExpenses),
      byCategory: spending.map((row) => ({
        category: row.category_name,
        amount: fromCentavos(row.total),
        transactionCount: row.count,
        percentage: totalExpenses > 0 ? Math.round((row.total / totalExpenses) * 100) : 0,
      })),
      message:
        spending.length === 0
          ? `No expenses found for ${start} to ${end}.`
          : `Total spending from ${start} to ${end}: $${fromCentavos(totalExpenses).toFixed(2)} across ${spending.length} categories.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 6. list-accounts
// ---------------------------------------------------------------------------

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

    const accounts = await query<any>(sql, params)

    return {
      accounts: accounts.map((a: any) => ({
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
    const existing = await query<any>('SELECT * FROM accounts WHERE id = $1', [accountId])

    if (existing.length === 0) {
      return { success: false, message: `Account ${accountId} not found.` }
    }

    const account = existing[0]
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

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
    const existing = await query<any>('SELECT * FROM accounts WHERE id = $1', [accountId])

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

    const categories = await query<any>(sql, params)

    return {
      categories: categories.map((c: any) => ({
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

const getBalanceOverview: ToolDefinition = {
  name: 'get-balance-overview',
  description:
    'Get a complete balance overview including total balance, per-account breakdown, and month-over-month change.',
  schema: z.object({}),
  execute: async () => {
    const accounts = await query<any>('SELECT * FROM accounts WHERE is_archived = 0 ORDER BY name')

    const totalBalance = accounts.reduce((sum: number, a: any) => sum + a.balance, 0)

    const currentMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')
    const currentMonthEnd = dayjs().endOf('month').format('YYYY-MM-DD')

    const currentMonth = await query<{ total_income: number; total_expenses: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses
       FROM transactions
       WHERE date >= $1 AND date <= $2`,
      [currentMonthStart, currentMonthEnd]
    )

    const prevMonthStart = dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
    const prevMonthEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

    const prevMonth = await query<{ total_income: number; total_expenses: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses
       FROM transactions
       WHERE date >= $1 AND date <= $2`,
      [prevMonthStart, prevMonthEnd]
    )

    const currentNet = (currentMonth[0]?.total_income || 0) - (currentMonth[0]?.total_expenses || 0)
    const previousNet = (prevMonth[0]?.total_income || 0) - (prevMonth[0]?.total_expenses || 0)

    let trend: 'up' | 'down' | 'stable' = 'stable'
    if (currentNet > previousNet) trend = 'up'
    else if (currentNet < previousNet) trend = 'down'

    return {
      totalBalance: fromCentavos(totalBalance),
      accounts: accounts.map((a: any) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance: fromCentavos(a.balance),
      })),
      monthlyChange: {
        current: fromCentavos(currentNet),
        previous: fromCentavos(previousNet),
        trend,
      },
      message:
        accounts.length === 0
          ? 'No accounts found. Create an account to get started.'
          : `Total balance: $${fromCentavos(totalBalance).toFixed(2)} across ${accounts.length} account${accounts.length !== 1 ? 's' : ''}. This month's net: $${fromCentavos(currentNet).toFixed(2)} (${trend} vs last month).`,
    }
  },
}

// ---------------------------------------------------------------------------
// 12. analyze-spending-trends
// ---------------------------------------------------------------------------

const analyzeSpendingTrends: ToolDefinition = {
  name: 'analyze-spending-trends',
  description:
    'Analyze spending trends over multiple months with category breakdowns and trend detection.',
  schema: z.object({
    months: z
      .number()
      .int()
      .min(2)
      .max(12)
      .optional()
      .default(3)
      .describe('Number of months to analyze (default 3, max 12)'),
  }),
  execute: async ({ months }) => {
    const startDate = dayjs()
      .subtract(months - 1, 'month')
      .startOf('month')
      .format('YYYY-MM-DD')
    const endDate = dayjs().endOf('month').format('YYYY-MM-DD')

    const breakdown = await query<{ month: string; category_name: string; total: number }>(
      `SELECT
         strftime('%Y-%m', t.date) as month,
         COALESCE(c.name, 'Uncategorized') as category_name,
         SUM(t.amount) as total
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
       GROUP BY month, category_name
       ORDER BY month, total DESC`,
      [startDate, endDate]
    )

    const aggregates = await query<{
      month: string
      total_expenses: number
      total_income: number
    }>(
      `SELECT
         strftime('%Y-%m', date) as month,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses,
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income
       FROM transactions
       WHERE date >= $1 AND date <= $2
       GROUP BY month
       ORDER BY month`,
      [startDate, endDate]
    )

    const monthlyData = aggregates.map((agg) => {
      const monthCategories = breakdown
        .filter((b) => b.month === agg.month)
        .slice(0, 3)
        .map((b) => ({
          category: b.category_name,
          amount: fromCentavos(b.total),
        }))

      return {
        month: agg.month,
        totalExpenses: fromCentavos(agg.total_expenses),
        totalIncome: fromCentavos(agg.total_income),
        net: fromCentavos(agg.total_income - agg.total_expenses),
        topCategories: monthCategories,
      }
    })

    const trends: Array<{ category: string; direction: 'up' | 'down'; changePercent: number }> = []

    if (aggregates.length >= 2) {
      const latestMonth = aggregates[aggregates.length - 1].month
      const prevMonth = aggregates[aggregates.length - 2].month

      const latestCategories = new Map<string, number>()
      const prevCategories = new Map<string, number>()

      for (const b of breakdown) {
        if (b.month === latestMonth) latestCategories.set(b.category_name, b.total)
        if (b.month === prevMonth) prevCategories.set(b.category_name, b.total)
      }

      const allCategories = new Set([...latestCategories.keys(), ...prevCategories.keys()])

      for (const cat of allCategories) {
        const latest = latestCategories.get(cat) || 0
        const prev = prevCategories.get(cat) || 0
        if (prev === 0) continue
        const changePercent = Math.round(((latest - prev) / prev) * 100)
        if (Math.abs(changePercent) >= 10) {
          trends.push({
            category: cat,
            direction: changePercent > 0 ? 'up' : 'down',
            changePercent: Math.abs(changePercent),
          })
        }
      }

      trends.sort((a, b) => b.changePercent - a.changePercent)
    }

    return {
      months: monthlyData,
      trends,
      message:
        monthlyData.length === 0
          ? 'No transaction data found for the requested period.'
          : `Analyzed ${monthlyData.length} month${monthlyData.length !== 1 ? 's' : ''} of spending data.${trends.length > 0 ? ` Notable trends: ${trends.map((t) => `${t.category} ${t.direction} ${t.changePercent}%`).join(', ')}.` : ''}`,
    }
  },
}

// ---------------------------------------------------------------------------
// 13. save-memory
// ---------------------------------------------------------------------------

const saveMemory: ToolDefinition = {
  name: 'save-memory',
  description:
    'Save or update a memory about the user. Use this to remember preferences, facts, goals, behaviors, or context across conversations.',
  schema: z.object({
    content: z.string().describe('The memory content to save'),
    category: z
      .enum(['preference', 'fact', 'goal', 'behavior', 'context'])
      .describe(
        'Memory category: preference (user likes/dislikes), fact (personal info), goal (financial targets), behavior (spending patterns), context (situational info)'
      ),
    importance: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe('Importance level 1-10 (10 = critical, 5 = normal).'),
    existingMemoryId: z
      .string()
      .optional()
      .describe('If updating an existing memory, pass its ID here'),
  }),
  execute: async ({ content, category, importance, existingMemoryId }) => {
    if (existingMemoryId) {
      const existing = await query<{ id: string }>('SELECT id FROM ai_memories WHERE id = $1', [
        existingMemoryId,
      ])
      if (existing.length === 0) {
        return { success: false, message: `Memory with ID ${existingMemoryId} not found.` }
      }

      await execute(
        `UPDATE ai_memories SET content = $1, category = $2, importance = $3,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $4`,
        [content, category, importance, existingMemoryId]
      )

      return {
        success: true,
        memoryId: existingMemoryId,
        action: 'updated',
        message: `Updated memory: "${content}"`,
      }
    }

    const id = generateId()
    await execute(
      `INSERT INTO ai_memories (id, category, content, importance)
       VALUES ($1, $2, $3, $4)`,
      [id, category, content, importance]
    )

    return {
      success: true,
      memoryId: id,
      action: 'created',
      message: `Saved new memory: "${content}"`,
    }
  },
}

// ---------------------------------------------------------------------------
// 14. recall-memories
// ---------------------------------------------------------------------------

const recallMemories: ToolDefinition = {
  name: 'recall-memories',
  description:
    'Search and retrieve saved memories about the user. Use this to recall preferences, facts, goals, or other stored information.',
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe('Search term to filter memories by content (uses full-text search when available)'),
    category: z
      .enum(['preference', 'fact', 'goal', 'behavior', 'context'])
      .optional()
      .describe('Filter by memory category'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe('Maximum number of memories to return (default 20)'),
  }),
  execute: async ({ search, category, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 0

    if (search) {
      // Try FTS first, fallback to LIKE
      let useFts = false
      try {
        const ftsCheck = await query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_memories_fts'"
        )
        useFts = ftsCheck.length > 0
      } catch {
        useFts = false
      }

      if (useFts) {
        paramIndex++
        conditions.push(
          `rowid IN (SELECT rowid FROM ai_memories_fts WHERE ai_memories_fts MATCH $${paramIndex})`
        )
        const safeSearch = search
          .replace(/['"]/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .map((token: string) => `"${token}"`)
          .join(' ')
        params.push(safeSearch || `"${search}"`)
      } else {
        paramIndex++
        conditions.push(`content LIKE $${paramIndex}`)
        params.push(`%${search}%`)
      }
    }
    if (category) {
      paramIndex++
      conditions.push(`category = $${paramIndex}`)
      params.push(category)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    paramIndex++
    params.push(limit)

    const memories = await query<{
      id: string
      category: string
      content: string
      importance: number
    }>(
      `SELECT id, category, content, importance
       FROM ai_memories
       ${whereClause}
       ORDER BY importance DESC, updated_at DESC
       LIMIT $${paramIndex}`,
      params
    )

    // Touch last_accessed_at
    if (memories.length > 0) {
      const ids = memories.map((m) => m.id)
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
      await execute(
        `UPDATE ai_memories SET last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id IN (${placeholders})`,
        ids
      )
    }

    return {
      memories: memories.map((m) => ({
        id: m.id,
        category: m.category,
        content: m.content,
        importance: m.importance,
      })),
      count: memories.length,
      message:
        memories.length === 0
          ? 'No memories found.'
          : `Found ${memories.length} memor${memories.length !== 1 ? 'ies' : 'y'}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 15. forget-memory
// ---------------------------------------------------------------------------

const forgetMemory: ToolDefinition = {
  name: 'forget-memory',
  description:
    'Delete a specific memory. Use this when the user asks you to forget something or when a memory is no longer relevant.',
  schema: z.object({
    memoryId: z.string().describe('The ID of the memory to delete'),
  }),
  execute: async ({ memoryId }) => {
    const existing = await query<{ id: string; content: string }>(
      'SELECT id, content FROM ai_memories WHERE id = $1',
      [memoryId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Memory with ID ${memoryId} not found.` }
    }

    await execute('DELETE FROM ai_memories WHERE id = $1', [memoryId])

    return {
      success: true,
      message: `Forgot memory: "${existing[0].content}"`,
    }
  },
}

// ---------------------------------------------------------------------------
// 16. get-credit-card-status
// ---------------------------------------------------------------------------

const getCreditCardStatus: ToolDefinition = {
  name: 'get-credit-card-status',
  description:
    'Get credit card status including balance, credit limit, available credit, utilization, and upcoming dates.',
  schema: z.object({
    accountId: z
      .string()
      .optional()
      .describe('Specific credit card account ID. Omit to get all credit cards.'),
  }),
  execute: async ({ accountId }) => {
    let cards: any[]

    if (accountId) {
      cards = await query<any>(
        "SELECT * FROM accounts WHERE id = $1 AND type = 'credit_card' AND is_archived = 0",
        [accountId]
      )
      if (cards.length === 0) {
        return { success: false, message: `Credit card ${accountId} not found.` }
      }
    } else {
      cards = await query<any>(
        "SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 ORDER BY name"
      )
      if (cards.length === 0) {
        return { success: false, message: 'No credit cards found.' }
      }
    }

    const statuses = cards.map((card: any) => {
      const balance = fromCentavos(Math.abs(card.balance))
      const limit = card.credit_limit ? fromCentavos(card.credit_limit) : null
      const available = limit !== null ? limit - balance : null
      const utilization = limit !== null && limit > 0 ? Math.round((balance / limit) * 100) : null

      return {
        id: card.id,
        name: card.name,
        currency: card.currency,
        currentBalance: balance,
        creditLimit: limit,
        availableCredit: available,
        utilizationPercent: utilization,
        nextClosingDate: card.statement_closing_day
          ? nextDateForDay(card.statement_closing_day).format('YYYY-MM-DD')
          : null,
        nextPaymentDueDate: card.payment_due_day
          ? nextDateForDay(card.payment_due_day).format('YYYY-MM-DD')
          : null,
        statementClosingDay: card.statement_closing_day ?? null,
        paymentDueDay: card.payment_due_day ?? null,
      }
    })

    const totalBalance = statuses.reduce((s, c) => s + c.currentBalance, 0)
    const totalLimit = statuses.reduce((s, c) => s + (c.creditLimit ?? 0), 0)

    return {
      success: true,
      cards: statuses,
      summary: {
        totalCards: statuses.length,
        totalBalance,
        totalLimit: totalLimit > 0 ? totalLimit : null,
        totalAvailable: totalLimit > 0 ? totalLimit - totalBalance : null,
        overallUtilization: totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : null,
      },
      message: `${statuses.length} credit card(s). Total balance: $${totalBalance.toFixed(2)}${totalLimit > 0 ? `, utilization: ${Math.round((totalBalance / totalLimit) * 100)}%` : ''}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 17. create-budget
// ---------------------------------------------------------------------------

const createBudget: ToolDefinition = {
  name: 'create-budget',
  description:
    'Create a budget for a spending category. Use this when the user wants to set a spending limit for a category.',
  schema: z.object({
    categoryId: z
      .string()
      .optional()
      .describe('Category ID to budget. If not provided, use categoryName to find it.'),
    categoryName: z
      .string()
      .optional()
      .describe('Category name to match (e.g. "Food & Dining"). Used if categoryId not provided.'),
    amount: z
      .number()
      .positive()
      .describe('Budget amount in the main currency unit (e.g. 500 for $500)'),
    period: z
      .enum(['weekly', 'monthly', 'yearly'])
      .optional()
      .default('monthly')
      .describe('Budget period (default: monthly)'),
    name: z
      .string()
      .optional()
      .describe('Budget name. Defaults to the category name if not provided.'),
  }),
  execute: async ({ categoryId, categoryName, amount, period, name }) => {
    let resolvedCategoryId = categoryId ?? null
    let resolvedName = name

    if (!resolvedCategoryId && categoryName) {
      const categories = await query<{ id: string; name: string }>(
        'SELECT id, name FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
        [`%${categoryName}%`]
      )
      if (categories.length > 0) {
        resolvedCategoryId = categories[0].id
        if (!resolvedName) resolvedName = categories[0].name + ' Budget'
      }
    }

    if (!resolvedName) resolvedName = 'Budget'

    const id = generateId()
    const amountCentavos = toCentavos(amount)

    await execute(
      `INSERT INTO budgets (id, category_id, name, amount, period, is_active)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [id, resolvedCategoryId, resolvedName, amountCentavos, period]
    )

    return {
      success: true,
      budget: {
        id,
        name: resolvedName,
        categoryId: resolvedCategoryId,
        amount,
        period,
      },
      message: `Created ${period} budget "${resolvedName}" for $${amount.toFixed(2)}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 18. get-budget-status
// ---------------------------------------------------------------------------

const getBudgetStatus: ToolDefinition = {
  name: 'get-budget-status',
  description:
    'Get budget status showing how much has been spent vs the budget amount for the current period.',
  schema: z.object({
    categoryId: z.string().optional().describe('Filter by category ID. Omit to see all budgets.'),
  }),
  execute: async ({ categoryId }) => {
    let budgets: any[]

    if (categoryId) {
      budgets = await query<any>(
        `SELECT b.id, b.name, b.amount, b.period, b.category_id, c.name as category_name
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         WHERE b.is_active = 1 AND b.category_id = $1`,
        [categoryId]
      )
    } else {
      budgets = await query<any>(
        `SELECT b.id, b.name, b.amount, b.period, b.category_id, c.name as category_name
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         WHERE b.is_active = 1
         ORDER BY b.name`
      )
    }

    if (budgets.length === 0) {
      return { success: true, budgets: [], message: 'No active budgets found.' }
    }

    const today = dayjs()

    const statuses = await Promise.all(
      budgets.map(async (budget: any) => {
        let periodStart: string
        let periodEnd: string

        if (budget.period === 'weekly') {
          periodStart = today.startOf('week').format('YYYY-MM-DD')
          periodEnd = today.endOf('week').format('YYYY-MM-DD')
        } else if (budget.period === 'yearly') {
          periodStart = today.startOf('year').format('YYYY-MM-DD')
          periodEnd = today.endOf('year').format('YYYY-MM-DD')
        } else {
          periodStart = today.startOf('month').format('YYYY-MM-DD')
          periodEnd = today.endOf('month').format('YYYY-MM-DD')
        }

        let spentResult: { total: number | null }[]
        if (budget.category_id) {
          spentResult = await query<{ total: number | null }>(
            `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
             WHERE category_id = $1 AND type = 'expense' AND date >= $2 AND date <= $3`,
            [budget.category_id, periodStart, periodEnd]
          )
        } else {
          spentResult = await query<{ total: number | null }>(
            `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
             WHERE type = 'expense' AND date >= $1 AND date <= $2`,
            [periodStart, periodEnd]
          )
        }

        const spentCentavos = spentResult[0]?.total ?? 0
        const budgetAmount = fromCentavos(budget.amount)
        const spentAmount = fromCentavos(spentCentavos)
        const remaining = budgetAmount - spentAmount
        const percentUsed = budgetAmount > 0 ? Math.round((spentAmount / budgetAmount) * 100) : 0

        return {
          id: budget.id,
          name: budget.name,
          categoryName: budget.category_name ?? 'All categories',
          budgetAmount,
          spentAmount,
          remaining,
          percentUsed,
          period: budget.period,
          periodStart,
          periodEnd,
          isOverBudget: remaining < 0,
        }
      })
    )

    const totalBudget = statuses.reduce((s, b) => s + b.budgetAmount, 0)
    const totalSpent = statuses.reduce((s, b) => s + b.spentAmount, 0)

    return {
      success: true,
      budgets: statuses,
      summary: {
        totalBudget,
        totalSpent,
        totalRemaining: totalBudget - totalSpent,
        overallPercentUsed: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
      },
      message: `${statuses.length} active budget(s). Overall: $${totalSpent.toFixed(2)} / $${totalBudget.toFixed(2)} (${totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}% used).`,
    }
  },
}

// ---------------------------------------------------------------------------
// 19. delete-budget
// ---------------------------------------------------------------------------

const deleteBudget: ToolDefinition = {
  name: 'delete-budget',
  description:
    'Delete a budget. Use this when the user wants to remove a budget they no longer need.',
  schema: z.object({
    budgetId: z.string().describe('The ID of the budget to delete'),
  }),
  execute: async ({ budgetId }) => {
    const existing = await query<{ id: string; name: string }>(
      'SELECT id, name FROM budgets WHERE id = $1',
      [budgetId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Budget ${budgetId} not found.` }
    }

    await execute('DELETE FROM budgets WHERE id = $1', [budgetId])

    return {
      success: true,
      message: `Deleted budget "${existing[0].name}".`,
    }
  },
}

// ---------------------------------------------------------------------------
// 20. get-net-worth
// ---------------------------------------------------------------------------

const getNetWorth: ToolDefinition = {
  name: 'get-net-worth',
  description:
    'Calculate total net worth by summing all account balances (assets minus credit card debt) plus investment values.',
  schema: z.object({}),
  execute: async () => {
    const accounts = await query<any>(
      'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY type, name'
    )

    const investments = await query<any>(
      `SELECT i.*,
              (SELECT sp.price FROM stock_prices sp WHERE sp.symbol = i.symbol ORDER BY sp.date DESC LIMIT 1) as latest_price
       FROM investments i
       ORDER BY i.name`
    )

    let totalAssets = 0
    let totalLiabilities = 0

    const accountBreakdown = accounts.map((acc: any) => {
      const balance = fromCentavos(acc.balance)
      const isLiability = acc.type === 'credit_card'

      if (isLiability) {
        totalLiabilities += Math.abs(balance)
      } else {
        totalAssets += balance
      }

      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        balance,
        isLiability,
      }
    })

    let totalInvestments = 0

    const investmentBreakdown = investments.map((inv: any) => {
      const currentPrice = inv.latest_price
        ? fromCentavos(inv.latest_price)
        : fromCentavos(inv.avg_cost_basis)
      const value = inv.shares * currentPrice
      const costBasis = inv.shares * fromCentavos(inv.avg_cost_basis)
      const gainLoss = value - costBasis
      totalInvestments += value

      return {
        id: inv.id,
        name: inv.name,
        symbol: inv.symbol,
        type: inv.type,
        shares: inv.shares,
        currentPrice,
        value,
        costBasis,
        gainLoss,
        gainLossPercent: costBasis > 0 ? Math.round((gainLoss / costBasis) * 100) : 0,
        currency: inv.currency,
      }
    })

    totalAssets += totalInvestments
    const netWorth = totalAssets - totalLiabilities

    return {
      success: true,
      netWorth,
      totalAssets,
      totalLiabilities,
      totalInvestments,
      accounts: accountBreakdown,
      investments: investmentBreakdown,
      message: `Net worth: $${netWorth.toFixed(2)} (Assets: $${totalAssets.toFixed(2)}, Liabilities: $${totalLiabilities.toFixed(2)}, Investments: $${totalInvestments.toFixed(2)}).`,
    }
  },
}

// ---------------------------------------------------------------------------
// 21. manage-investment
// ---------------------------------------------------------------------------

const manageInvestment: ToolDefinition = {
  name: 'manage-investment',
  description:
    'Add, update, or delete an investment holding. Use this to track stocks, ETFs, crypto, bonds, and other investments.',
  schema: z.object({
    action: z.enum(['add', 'update', 'delete']).describe('The action to perform'),
    investmentId: z.string().optional().describe('Required for update/delete. The investment ID.'),
    name: z.string().optional().describe('Investment name (e.g. "Apple Inc.")'),
    symbol: z.string().optional().describe('Ticker symbol (e.g. "AAPL")'),
    type: z
      .enum(['stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'other'])
      .optional()
      .describe('Investment type'),
    shares: z.number().optional().describe('Number of shares/units'),
    avgCost: z.number().optional().describe('Average cost basis per share in main currency unit'),
    currentPrice: z
      .number()
      .optional()
      .describe('Current price per share (will be saved to price history)'),
    currency: z.string().optional().default('USD').describe('Currency code'),
    accountId: z.string().optional().describe('Link to an account'),
    notes: z.string().optional().describe('Notes about the investment'),
  }),
  execute: async ({
    action,
    investmentId,
    name,
    symbol,
    type,
    shares,
    avgCost,
    currentPrice,
    currency,
    accountId,
    notes,
  }) => {
    if (action === 'add') {
      if (!name || !symbol) {
        return {
          success: false,
          message: 'Name and symbol are required when adding an investment.',
        }
      }

      const id = generateId()
      const avgCostCentavos = avgCost !== undefined ? toCentavos(avgCost) : 0

      await execute(
        `INSERT INTO investments (id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          accountId ?? null,
          symbol.toUpperCase(),
          name,
          type ?? 'stock',
          shares ?? 0,
          avgCostCentavos,
          currency,
          notes ?? null,
        ]
      )

      if (currentPrice !== undefined) {
        const priceId = generateId()
        const today = dayjs().format('YYYY-MM-DD')
        await execute(
          `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, date)
           VALUES ($1, $2, $3, $4, $5)`,
          [priceId, symbol.toUpperCase(), toCentavos(currentPrice), currency, today]
        )
      }

      return {
        success: true,
        investment: {
          id,
          name,
          symbol: symbol.toUpperCase(),
          type: type ?? 'stock',
          shares: shares ?? 0,
          avgCost: avgCost ?? 0,
        },
        message: `Added investment: ${name} (${symbol.toUpperCase()}) — ${shares ?? 0} shares at $${(avgCost ?? 0).toFixed(2)} avg cost.`,
      }
    }

    if (action === 'update') {
      if (!investmentId) {
        return { success: false, message: 'investmentId is required for update.' }
      }

      const existing = await query<any>('SELECT * FROM investments WHERE id = $1', [investmentId])

      if (existing.length === 0) {
        return { success: false, message: `Investment ${investmentId} not found.` }
      }

      const inv = existing[0]
      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (name !== undefined) {
        setClauses.push(`name = $${paramIdx++}`)
        params.push(name)
      }
      if (symbol !== undefined) {
        setClauses.push(`symbol = $${paramIdx++}`)
        params.push(symbol.toUpperCase())
      }
      if (type !== undefined) {
        setClauses.push(`type = $${paramIdx++}`)
        params.push(type)
      }
      if (shares !== undefined) {
        setClauses.push(`shares = $${paramIdx++}`)
        params.push(shares)
      }
      if (avgCost !== undefined) {
        setClauses.push(`avg_cost_basis = $${paramIdx++}`)
        params.push(toCentavos(avgCost))
      }
      if (currency !== undefined) {
        setClauses.push(`currency = $${paramIdx++}`)
        params.push(currency)
      }
      if (accountId !== undefined) {
        setClauses.push(`account_id = $${paramIdx++}`)
        params.push(accountId)
      }
      if (notes !== undefined) {
        setClauses.push(`notes = $${paramIdx++}`)
        params.push(notes)
      }

      if (setClauses.length === 0 && currentPrice === undefined) {
        return { success: false, message: 'No fields to update.' }
      }

      if (setClauses.length > 0) {
        setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
        params.push(investmentId)
        await execute(
          `UPDATE investments SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
          params
        )
      }

      if (currentPrice !== undefined) {
        const priceId = generateId()
        const today = dayjs().format('YYYY-MM-DD')
        const sym = symbol?.toUpperCase() ?? inv.symbol
        await execute(
          `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, date)
           VALUES ($1, $2, $3, $4, $5)`,
          [priceId, sym, toCentavos(currentPrice), currency ?? inv.currency, today]
        )
      }

      return {
        success: true,
        message: `Updated investment "${name ?? inv.name}".`,
      }
    }

    if (action === 'delete') {
      if (!investmentId) {
        return { success: false, message: 'investmentId is required for delete.' }
      }

      const existing = await query<any>('SELECT * FROM investments WHERE id = $1', [investmentId])

      if (existing.length === 0) {
        return { success: false, message: `Investment ${investmentId} not found.` }
      }

      await execute('DELETE FROM investments WHERE id = $1', [investmentId])

      return {
        success: true,
        message: `Deleted investment "${existing[0].name}" (${existing[0].symbol}).`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
}

// ---------------------------------------------------------------------------
// 22. get-upcoming-bills
// ---------------------------------------------------------------------------

const getUpcomingBills: ToolDefinition = {
  name: 'get-upcoming-bills',
  description:
    'Get upcoming bills from credit card due dates and recurring transactions. Returns a sorted list of bills due within the specified number of days.',
  schema: z.object({
    daysAhead: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .default(30)
      .describe('Number of days to look ahead (default: 30)'),
  }),
  execute: async ({ daysAhead }) => {
    const today = dayjs()
    const cutoff = today.add(daysAhead, 'day')
    const bills: Array<{
      name: string
      amount: number
      currency: string
      dueDate: string
      source: string
      daysUntilDue: number
    }> = []

    // Credit card payment due dates
    const creditCards = await query<any>(
      "SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 AND payment_due_day IS NOT NULL"
    )

    for (const card of creditCards) {
      if (card.payment_due_day) {
        const dueDate = nextDateForDay(card.payment_due_day)
        if (dueDate.isBefore(cutoff) || dueDate.isSame(cutoff, 'day')) {
          bills.push({
            name: `${card.name} payment`,
            amount: fromCentavos(Math.abs(card.balance)),
            currency: card.currency,
            dueDate: dueDate.format('YYYY-MM-DD'),
            source: 'credit_card',
            daysUntilDue: dueDate.diff(today, 'day'),
          })
        }
      }
    }

    // Recurring transactions
    const recurringTx = await query<any>(
      `SELECT description, amount, currency, MAX(date) as date, COUNT(*) as count
       FROM transactions
       WHERE is_recurring = 1 AND type = 'expense'
         AND date >= $1
       GROUP BY description, amount
       HAVING count >= 1
       ORDER BY date DESC`,
      [today.subtract(60, 'day').format('YYYY-MM-DD')]
    )

    for (const tx of recurringTx) {
      const lastDate = dayjs(tx.date)
      const estimatedNext = lastDate.add(30, 'day')
      if (
        (estimatedNext.isAfter(today) || estimatedNext.isSame(today, 'day')) &&
        (estimatedNext.isBefore(cutoff) || estimatedNext.isSame(cutoff, 'day'))
      ) {
        const isDuplicate = bills.some(
          (b) =>
            b.name.toLowerCase() === tx.description.toLowerCase() &&
            Math.abs(b.amount - fromCentavos(tx.amount)) < 1
        )
        if (!isDuplicate) {
          bills.push({
            name: tx.description,
            amount: fromCentavos(tx.amount),
            currency: tx.currency,
            dueDate: estimatedNext.format('YYYY-MM-DD'),
            source: 'recurring',
            daysUntilDue: estimatedNext.diff(today, 'day'),
          })
        }
      }
    }

    bills.sort((a, b) => a.daysUntilDue - b.daysUntilDue)

    const totalDue = bills.reduce((sum, b) => sum + b.amount, 0)

    return {
      success: true,
      bills,
      summary: {
        count: bills.length,
        totalAmount: Math.round(totalDue * 100) / 100,
        daysAhead,
        bySource: {
          creditCard: bills.filter((b) => b.source === 'credit_card').length,
          subscription: bills.filter((b) => b.source === 'subscription').length,
          recurring: bills.filter((b) => b.source === 'recurring').length,
        },
      },
      message:
        bills.length === 0
          ? `No upcoming bills in the next ${daysAhead} days.`
          : `${bills.length} upcoming bill(s) in the next ${daysAhead} days, totaling $${totalDue.toFixed(2)}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 23. list-subscriptions
// ---------------------------------------------------------------------------

const listSubscriptions: ToolDefinition = {
  name: 'list-subscriptions',
  mcpUnavailableMessage:
    'Subby integration is not available via the Shikin MCP server. Use the dedicated Subby integration/server or import the data first.',
  description:
    'List subscriptions from Subby (the subscription tracker app). Shows active subscriptions with their amounts, billing cycles, and next payment dates.',
  schema: z.object({
    activeOnly: z
      .boolean()
      .optional()
      .default(true)
      .describe('Only show active subscriptions (default: true)'),
  }),
  execute: async () => {
    return {
      success: false,
      message:
        'Subby integration is not available in CLI mode. Direct SQLite access to Subby requires additional setup. Future: integrate via Subby MCP server or data import.',
    }
  },
}

// ---------------------------------------------------------------------------
// 24. get-subscription-spending
// ---------------------------------------------------------------------------

const getSubscriptionSpending: ToolDefinition = {
  name: 'get-subscription-spending',
  mcpUnavailableMessage:
    'Subby integration is not available via the Shikin MCP server. Use the dedicated Subby integration/server or import the data first.',
  description:
    'Analyze subscription spending from Subby. Groups subscriptions by category and shows monthly/yearly cost breakdown.',
  schema: z.object({}),
  execute: async () => {
    return {
      success: false,
      message:
        'Subby integration is not available in CLI mode. Direct SQLite access to Subby requires additional setup. Future: integrate via Subby MCP server or data import.',
    }
  },
}

// ---------------------------------------------------------------------------
// 25. write-notebook
// ---------------------------------------------------------------------------

const writeNotebookTool: ToolDefinition = {
  name: 'write-notebook',
  description:
    'Write or update a markdown note in the notebook. Use for research findings, portfolio reviews, market signals, and educational content.',
  schema: z.object({
    path: notebookPathSchema('Relative path within the notebook (e.g. "holdings/AAPL.md")'),
    content: z.string().describe('Markdown content to write'),
    append: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, append to existing note instead of overwriting'),
  }),
  execute: async ({ path, content, append }) => {
    try {
      if (append) {
        await appendNote(path, content)
      } else {
        await writeNote(path, content)
      }
      return {
        success: true,
        message: `${append ? 'Appended to' : 'Wrote'} notebook: ${path}`,
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to write notebook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
}

// ---------------------------------------------------------------------------
// 26. read-notebook
// ---------------------------------------------------------------------------

const readNotebookTool: ToolDefinition = {
  name: 'read-notebook',
  description:
    'Read a note from the notebook. Use to reference previous research, reviews, or educational content.',
  schema: z.object({
    path: notebookPathSchema('Relative path within the notebook (e.g. "holdings/AAPL.md")'),
  }),
  execute: async ({ path }) => {
    try {
      const exists = await noteExists(path)
      if (!exists) {
        return { success: false, message: `Note not found: ${path}` }
      }
      const content = await readNote(path)
      return { success: true, content, path }
    } catch (err) {
      return {
        success: false,
        message: `Failed to read notebook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
}

// ---------------------------------------------------------------------------
// 27. list-notebook
// ---------------------------------------------------------------------------

const listNotebookTool: ToolDefinition = {
  name: 'list-notebook',
  description:
    'List notes and directories in the notebook. Use to discover available research, reviews, and educational content.',
  schema: z.object({
    directory: notebookPathSchema(
      'Subdirectory to list (e.g. "holdings", "weekly-reviews"). Omit for root.',
      { allowEmpty: true }
    ).optional(),
  }),
  execute: async ({ directory }) => {
    try {
      const notes = await listNotes(directory)
      return {
        success: true,
        directory: directory || '/',
        notes,
        count: notes.length,
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to list notebook: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
}

// ---------------------------------------------------------------------------
// 28. get-financial-news
// ---------------------------------------------------------------------------

const getFinancialNews: ToolDefinition = {
  name: 'get-financial-news',
  mcpUnavailableMessage:
    'Financial news is not available via the Shikin MCP server until the external service is configured.',
  description: 'Fetch financial news for a specific symbol or the entire portfolio.',
  schema: z.object({
    symbol: z
      .string()
      .optional()
      .describe('Stock/crypto symbol. If omitted, fetches news for the whole portfolio.'),
    days: z.number().optional().default(7).describe('Number of days to look back'),
  }),
  execute: async () => {
    // TODO: Wire up news service when API keys are configured
    return {
      success: false,
      message: 'Financial news requires API keys. Configure via Shikin settings.',
    }
  },
}

// ---------------------------------------------------------------------------
// 29. get-congressional-trades
// ---------------------------------------------------------------------------

const getCongressionalTrades: ToolDefinition = {
  name: 'get-congressional-trades',
  mcpUnavailableMessage:
    'Congressional trades are not available via the Shikin MCP server until the external service is configured.',
  description:
    'Check recent congressional stock trading disclosures. This is public data that can be interesting to review alongside your own holdings.',
  schema: z.object({
    symbol: z
      .string()
      .optional()
      .describe('Filter trades by ticker symbol. If omitted, returns all recent trades.'),
    days: z.number().optional().default(30).describe('Number of days to look back'),
  }),
  execute: async () => {
    // TODO: Wire up congressional trades API when configured
    return {
      success: false,
      message: 'Congressional trades requires external API access. Configure via Shikin settings.',
    }
  },
}

// ---------------------------------------------------------------------------
// 30. generate-portfolio-review
// ---------------------------------------------------------------------------

const generatePortfolioReview: ToolDefinition = {
  name: 'generate-portfolio-review',
  mcpUnavailableMessage:
    'Portfolio review generation is not available via the Shikin MCP server yet.',
  description:
    'Generate a portfolio review and save it to the notebook. Reviews include performance summary, top/worst performers, and a holdings table.',
  schema: z.object({
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe('Force generation even if a review exists for this week'),
  }),
  execute: async () => {
    // TODO: Wire up portfolio review service in CLI
    return {
      success: false,
      message: 'Portfolio review generation is not yet available in CLI mode.',
    }
  },
}

// ---------------------------------------------------------------------------
// 31. manage-category-rules
// ---------------------------------------------------------------------------

const manageCategoryRules: ToolDefinition = {
  name: 'manage-category-rules',
  description:
    'Manage auto-categorization rules. List learned rules, create new rules, delete rules, or suggest a category for a description.',
  schema: z.object({
    action: z
      .enum(['list', 'create', 'delete', 'suggest'])
      .describe(
        'Action: list (show all rules), create (learn a new rule), delete (remove a rule), suggest (get category suggestion)'
      ),
    pattern: z
      .string()
      .optional()
      .describe('For create/suggest: the merchant or description pattern'),
    categoryId: z.string().optional().describe('For create: the category ID to map the pattern to'),
    subcategoryId: z.string().optional().describe('For create: optional subcategory ID'),
    ruleId: z.string().optional().describe('For delete: the rule ID to remove'),
  }),
  execute: async ({ action, pattern, categoryId, subcategoryId, ruleId }) => {
    switch (action) {
      case 'list': {
        const rules = await query<any>(
          `SELECT r.id, r.pattern, r.category_id, r.subcategory_id, r.confidence, r.hit_count,
                  c.name as category_name
           FROM auto_categorization_rules r
           LEFT JOIN categories c ON r.category_id = c.id
           ORDER BY r.hit_count DESC`
        )
        return {
          success: true,
          rules: rules.map((r: any) => ({
            id: r.id,
            pattern: r.pattern,
            category_name: r.category_name,
            category_id: r.category_id,
            hit_count: r.hit_count,
            confidence: r.confidence,
          })),
          count: rules.length,
          message:
            rules.length === 0
              ? 'No auto-categorization rules yet.'
              : `Found ${rules.length} auto-categorization rule(s).`,
        }
      }

      case 'create': {
        if (!pattern || !categoryId) {
          return {
            success: false,
            message: 'Both pattern and categoryId are required to create a rule.',
          }
        }

        // Check for existing rule with same pattern
        const existing = await query<any>(
          'SELECT id FROM auto_categorization_rules WHERE LOWER(pattern) = LOWER($1)',
          [pattern]
        )

        if (existing.length > 0) {
          await execute(
            `UPDATE auto_categorization_rules
             SET category_id = $1, subcategory_id = $2, confidence = 1.0,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = $3`,
            [categoryId, subcategoryId ?? null, existing[0].id]
          )
        } else {
          const id = generateId()
          await execute(
            `INSERT INTO auto_categorization_rules (id, pattern, category_id, subcategory_id, confidence, hit_count)
             VALUES ($1, $2, $3, $4, 1.0, 0)`,
            [id, pattern.toLowerCase(), categoryId, subcategoryId ?? null]
          )
        }

        return {
          success: true,
          message: `Learned rule: "${pattern}" will be categorized automatically.`,
        }
      }

      case 'delete': {
        if (!ruleId) {
          return { success: false, message: 'ruleId is required to delete a rule.' }
        }
        await execute('DELETE FROM auto_categorization_rules WHERE id = $1', [ruleId])
        return { success: true, message: 'Rule deleted successfully.' }
      }

      case 'suggest': {
        if (!pattern) {
          return { success: false, message: 'pattern is required to suggest a category.' }
        }

        const rules = await query<any>(
          `SELECT r.*, c.name as category_name
           FROM auto_categorization_rules r
           LEFT JOIN categories c ON r.category_id = c.id
           WHERE LOWER($1) LIKE '%' || r.pattern || '%'
           ORDER BY r.confidence DESC, r.hit_count DESC
           LIMIT 1`,
          [pattern.toLowerCase()]
        )

        if (rules.length === 0) {
          return {
            success: true,
            suggestion: null,
            message: `No category suggestion found for "${pattern}".`,
          }
        }

        return {
          success: true,
          suggestion: {
            categoryId: rules[0].category_id,
            categoryName: rules[0].category_name,
            confidence: rules[0].confidence,
          },
          message: `Suggested category for "${pattern}" with ${Math.round(rules[0].confidence * 100)}% confidence.`,
        }
      }

      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  },
}

// ---------------------------------------------------------------------------
// 32. get-spending-anomalies
// ---------------------------------------------------------------------------

const getSpendingAnomalies: ToolDefinition = {
  name: 'get-spending-anomalies',
  mcpUnavailableMessage:
    'Spending anomaly detection is not available via the Shikin MCP server yet.',
  description:
    'Detect and return spending anomalies such as unusual charges, duplicate transactions, spending spikes, and large transactions.',
  schema: z.object({
    largeTransactionThreshold: z
      .number()
      .optional()
      .default(500)
      .describe('Dollar threshold for flagging large transactions (default $500)'),
  }),
  execute: async () => {
    // TODO: Wire up anomaly detection service
    return {
      totalAnomalies: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
      anomalies: [],
      message:
        'Spending anomaly detection is not yet available in CLI mode. This will be wired up in a future release.',
    }
  },
}

// ---------------------------------------------------------------------------
// 33. manage-recurring-transaction
// ---------------------------------------------------------------------------

const manageRecurringTransaction: ToolDefinition = {
  name: 'manage-recurring-transaction',
  description:
    'Create, update, delete, list, or toggle recurring transaction rules. Recurring rules automatically generate transactions on a schedule.',
  schema: z.object({
    action: z
      .enum(['create', 'update', 'delete', 'list', 'toggle'])
      .describe('The action to perform on recurring rules'),
    ruleId: z
      .string()
      .optional()
      .describe('Required for update/delete/toggle. The recurring rule ID.'),
    description: z.string().optional().describe('Description of the recurring transaction'),
    amount: z.number().positive().optional().describe('Amount in the main currency unit'),
    type: z.enum(['expense', 'income', 'transfer']).optional().describe('Transaction type'),
    frequency: z
      .enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'])
      .optional()
      .describe('How often this recurs'),
    nextDate: z.string().optional().describe('Next occurrence date in YYYY-MM-DD format'),
    endDate: z.string().optional().describe('Optional end date in YYYY-MM-DD format'),
    category: z.string().optional().describe('Category name to match'),
    notes: z.string().optional().describe('Optional notes'),
  }),
  execute: async ({
    action,
    ruleId,
    description,
    amount,
    type,
    frequency,
    nextDate,
    endDate,
    category,
    notes,
  }) => {
    if (action === 'list') {
      const rules = await query<any>(
        `SELECT r.*, a.name as account_name, c.name as category_name
         FROM recurring_rules r
         LEFT JOIN accounts a ON r.account_id = a.id
         LEFT JOIN categories c ON r.category_id = c.id
         ORDER BY r.active DESC, r.next_date ASC`
      )

      if (rules.length === 0) {
        return { success: true, rules: [], message: 'No recurring rules found.' }
      }

      return {
        success: true,
        rules: rules.map((r: any) => ({
          id: r.id,
          description: r.description,
          amount: fromCentavos(r.amount),
          type: r.type,
          frequency: r.frequency,
          nextDate: r.next_date,
          endDate: r.end_date,
          active: !!r.active,
          account: r.account_name,
          category: r.category_name,
        })),
        message: `Found ${rules.length} recurring rule(s).`,
      }
    }

    if (action === 'create') {
      if (!description || !amount || !type || !frequency) {
        return {
          success: false,
          message:
            'description, amount, type, and frequency are required to create a recurring rule.',
        }
      }

      let categoryId: string | null = null
      if (category) {
        const categories = await query<{ id: string }>(
          'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
          [`%${category}%`]
        )
        if (categories.length > 0) categoryId = categories[0].id
      }

      const accounts = await query<{ id: string }>('SELECT id FROM accounts LIMIT 1')
      if (accounts.length === 0) {
        return {
          success: false,
          message: 'No accounts found. Please create an account first.',
        }
      }

      const id = generateId()
      const amountCentavos = toCentavos(amount)
      const resolvedNextDate = nextDate || dayjs().format('YYYY-MM-DD')

      await execute(
        `INSERT INTO recurring_rules (id, description, amount, type, frequency, next_date, end_date, account_id, category_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          description,
          amountCentavos,
          type,
          frequency,
          resolvedNextDate,
          endDate ?? null,
          accounts[0].id,
          categoryId,
          notes ?? null,
        ]
      )

      return {
        success: true,
        rule: { id, description, amount, type, frequency, nextDate: resolvedNextDate },
        message: `Created ${frequency} recurring ${type}: "$${amount.toFixed(2)} — ${description}" starting ${resolvedNextDate}.`,
      }
    }

    if (action === 'update') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for update.' }
      }

      const existing = await query<any>('SELECT * FROM recurring_rules WHERE id = $1', [ruleId])
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      const rule = existing[0]
      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (description !== undefined) {
        setClauses.push(`description = $${paramIdx++}`)
        params.push(description)
      }
      if (amount !== undefined) {
        setClauses.push(`amount = $${paramIdx++}`)
        params.push(toCentavos(amount))
      }
      if (type !== undefined) {
        setClauses.push(`type = $${paramIdx++}`)
        params.push(type)
      }
      if (frequency !== undefined) {
        setClauses.push(`frequency = $${paramIdx++}`)
        params.push(frequency)
      }
      if (nextDate !== undefined) {
        setClauses.push(`next_date = $${paramIdx++}`)
        params.push(nextDate)
      }
      if (endDate !== undefined) {
        setClauses.push(`end_date = $${paramIdx++}`)
        params.push(endDate)
      }
      if (notes !== undefined) {
        setClauses.push(`notes = $${paramIdx++}`)
        params.push(notes)
      }

      if (category !== undefined) {
        let categoryId: string | null = null
        if (category) {
          const categories = await query<{ id: string }>(
            'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
            [`%${category}%`]
          )
          if (categories.length > 0) categoryId = categories[0].id
        }
        setClauses.push(`category_id = $${paramIdx++}`)
        params.push(categoryId)
      }

      if (setClauses.length === 0) {
        return { success: false, message: 'No fields to update.' }
      }

      setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      params.push(ruleId)

      await execute(
        `UPDATE recurring_rules SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        params
      )

      return {
        success: true,
        message: `Updated recurring rule "${description ?? rule.description}".`,
      }
    }

    if (action === 'delete') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for delete.' }
      }

      const existing = await query<any>('SELECT * FROM recurring_rules WHERE id = $1', [ruleId])
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      await execute('DELETE FROM recurring_rules WHERE id = $1', [ruleId])

      return {
        success: true,
        message: `Deleted recurring rule "${existing[0].description}".`,
      }
    }

    if (action === 'toggle') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for toggle.' }
      }

      const existing = await query<any>('SELECT * FROM recurring_rules WHERE id = $1', [ruleId])
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      const newActive = existing[0].active ? 0 : 1
      await execute(
        "UPDATE recurring_rules SET active = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [newActive, ruleId]
      )

      return {
        success: true,
        message: `${newActive ? 'Activated' : 'Paused'} recurring rule "${existing[0].description}".`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
}

// ---------------------------------------------------------------------------
// 34. materialize-recurring
// ---------------------------------------------------------------------------

const materializeRecurring: ToolDefinition = {
  name: 'materialize-recurring',
  description:
    'Manually trigger materialization of due recurring transactions. Creates actual transactions for any recurring rules whose next_date has passed.',
  schema: z.object({}),
  execute: async () => {
    const today = dayjs().format('YYYY-MM-DD')

    // Find due recurring rules
    const dueRules = await query<any>(
      `SELECT r.*, a.name as account_name
       FROM recurring_rules r
       LEFT JOIN accounts a ON r.account_id = a.id
       WHERE r.active = 1 AND r.next_date <= $1`,
      [today]
    )

    if (dueRules.length === 0) {
      return {
        success: true,
        created: 0,
        message: 'No recurring transactions were due.',
      }
    }

    let created = 0

    for (const rule of dueRules) {
      // Check if past end date
      if (rule.end_date && rule.next_date > rule.end_date) {
        await execute(
          "UPDATE recurring_rules SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1",
          [rule.id]
        )
        continue
      }

      const txId = generateId()

      await execute(
        `INSERT INTO transactions (id, account_id, category_id, type, amount, description, notes, date, is_recurring)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)`,
        [
          txId,
          rule.account_id,
          rule.category_id,
          rule.type,
          rule.amount,
          rule.description,
          rule.notes,
          rule.next_date,
        ]
      )

      // Update account balance
      const balanceChange = rule.type === 'income' ? rule.amount : -rule.amount
      await execute(
        "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [balanceChange, rule.account_id]
      )

      // Advance next_date
      const newNextDate = advanceDate(rule.next_date, rule.frequency)
      await execute(
        "UPDATE recurring_rules SET next_date = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [newNextDate, rule.id]
      )

      created++
    }

    return {
      success: true,
      created,
      message:
        created > 0
          ? `Created ${created} transaction(s) from recurring rules.`
          : 'No recurring transactions were due.',
    }
  },
}

// ---------------------------------------------------------------------------
// 35. get-forecasted-cash-flow
// ---------------------------------------------------------------------------

const getForecastedCashFlow: ToolDefinition = {
  name: 'get-forecasted-cash-flow',
  mcpUnavailableMessage: 'Cash flow forecasting is not available via the Shikin MCP server yet.',
  description: 'Get a cash flow forecast showing projected balances, burn rate, and danger dates.',
  schema: z.object({
    days: z
      .number()
      .optional()
      .default(30)
      .describe('Number of days to forecast (default 30, max 90)'),
  }),
  execute: async () => {
    // TODO: Wire up forecast service
    return {
      success: false,
      message:
        'Cash flow forecasting is not yet available in CLI mode. This will be wired up in a future release.',
    }
  },
}

// ---------------------------------------------------------------------------
// 36. create-goal
// ---------------------------------------------------------------------------

const createGoal: ToolDefinition = {
  name: 'create-goal',
  description:
    'Create a savings goal. Use this when the user wants to set a savings target, like an emergency fund, vacation, or big purchase.',
  schema: z.object({
    name: z.string().describe('Name of the savings goal (e.g. "Emergency Fund", "Vacation")'),
    targetAmount: z
      .number()
      .positive()
      .describe('Target amount in the main currency unit (e.g. 5000 for $5,000)'),
    currentAmount: z
      .number()
      .min(0)
      .optional()
      .default(0)
      .describe('Current amount already saved (default: 0)'),
    deadline: z.string().optional().describe('Target date in YYYY-MM-DD format (optional)'),
    accountId: z.string().optional().describe('Account ID to link this goal to (optional)'),
    icon: z.string().optional().default('🎯').describe('Emoji icon for the goal'),
    color: z.string().optional().default('#bf5af2').describe('Color hex code for the goal'),
    notes: z.string().optional().describe('Additional notes about the goal'),
  }),
  execute: async ({
    name,
    targetAmount,
    currentAmount,
    deadline,
    accountId,
    icon,
    color,
    notes,
  }) => {
    const id = generateId()
    const now = new Date().toISOString()

    await execute(
      `INSERT INTO goals (id, name, target_amount, current_amount, deadline, account_id, icon, color, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        name,
        toCentavos(targetAmount),
        toCentavos(currentAmount),
        deadline ?? null,
        accountId ?? null,
        icon,
        color,
        notes ?? null,
        now,
        now,
      ]
    )

    const progress = targetAmount > 0 ? Math.round((currentAmount / targetAmount) * 100) : 0

    return {
      success: true,
      goal: {
        id,
        name,
        targetAmount,
        currentAmount,
        deadline: deadline ?? null,
        progress,
      },
      message: `Created savings goal "${name}" — target: $${targetAmount.toFixed(2)}${currentAmount > 0 ? `, starting at $${currentAmount.toFixed(2)} (${progress}%)` : ''}.${deadline ? ` Deadline: ${deadline}.` : ''}`,
    }
  },
}

// ---------------------------------------------------------------------------
// 37. update-goal
// ---------------------------------------------------------------------------

const updateGoal: ToolDefinition = {
  name: 'update-goal',
  description:
    'Update a savings goal. Can add/withdraw saved amounts, change the target, deadline, or other details.',
  schema: z.object({
    goalId: z.string().describe('The ID of the goal to update'),
    name: z.string().optional().describe('New name for the goal'),
    targetAmount: z.number().positive().optional().describe('New target amount'),
    currentAmount: z.number().min(0).optional().describe('Set current amount directly'),
    addAmount: z.number().positive().optional().describe('Amount to add to current savings'),
    withdrawAmount: z
      .number()
      .positive()
      .optional()
      .describe('Amount to withdraw from current savings'),
    deadline: z.string().optional().describe('New deadline in YYYY-MM-DD format'),
    icon: z.string().optional().describe('New emoji icon'),
    color: z.string().optional().describe('New color hex code'),
    notes: z.string().optional().describe('New notes'),
  }),
  execute: async ({
    goalId,
    name,
    targetAmount,
    currentAmount,
    addAmount,
    withdrawAmount,
    deadline,
    icon,
    color,
    notes,
  }) => {
    const existing = await query<any>(
      'SELECT id, name, target_amount, current_amount, deadline FROM goals WHERE id = $1',
      [goalId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Goal ${goalId} not found.` }
    }

    const goal = existing[0]
    const now = new Date().toISOString()

    // Calculate new current amount
    let newCurrentCentavos = goal.current_amount
    if (currentAmount !== undefined) {
      newCurrentCentavos = toCentavos(currentAmount)
    } else if (addAmount !== undefined) {
      newCurrentCentavos = goal.current_amount + toCentavos(addAmount)
    } else if (withdrawAmount !== undefined) {
      newCurrentCentavos = Math.max(0, goal.current_amount - toCentavos(withdrawAmount))
    }

    const newTargetCentavos =
      targetAmount !== undefined ? toCentavos(targetAmount) : goal.target_amount
    const newName = name ?? goal.name
    const newDeadline = deadline !== undefined ? deadline : goal.deadline

    const setClauses = [
      'name = $1',
      'target_amount = $2',
      'current_amount = $3',
      'deadline = $4',
      'updated_at = $5',
    ]
    const params: unknown[] = [newName, newTargetCentavos, newCurrentCentavos, newDeadline, now]
    let paramIdx = 6

    if (icon !== undefined) {
      setClauses.push(`icon = $${paramIdx}`)
      params.push(icon)
      paramIdx++
    }
    if (color !== undefined) {
      setClauses.push(`color = $${paramIdx}`)
      params.push(color)
      paramIdx++
    }
    if (notes !== undefined) {
      setClauses.push(`notes = $${paramIdx}`)
      params.push(notes)
      paramIdx++
    }

    params.push(goalId)
    await execute(`UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`, params)

    const newCurrentAmount = fromCentavos(newCurrentCentavos)
    const newTargetAmount = fromCentavos(newTargetCentavos)
    const progress =
      newTargetAmount > 0 ? Math.round((newCurrentAmount / newTargetAmount) * 100) : 0

    return {
      success: true,
      goal: {
        id: goalId,
        name: newName,
        targetAmount: newTargetAmount,
        currentAmount: newCurrentAmount,
        deadline: newDeadline,
        progress,
      },
      message: `Updated goal "${newName}" — $${newCurrentAmount.toFixed(2)} / $${newTargetAmount.toFixed(2)} (${progress}%).`,
    }
  },
}

// ---------------------------------------------------------------------------
// 38. get-goal-status
// ---------------------------------------------------------------------------

const getGoalStatus: ToolDefinition = {
  name: 'get-goal-status',
  description: 'Get savings goal status showing progress toward each goal.',
  schema: z.object({
    goalId: z.string().optional().describe('Filter by specific goal ID. Omit to see all goals.'),
  }),
  execute: async ({ goalId }) => {
    let goals: any[]

    if (goalId) {
      goals = await query<any>(
        `SELECT g.*, a.name as account_name
         FROM goals g
         LEFT JOIN accounts a ON g.account_id = a.id
         WHERE g.id = $1`,
        [goalId]
      )
    } else {
      goals = await query<any>(
        `SELECT g.*, a.name as account_name
         FROM goals g
         LEFT JOIN accounts a ON g.account_id = a.id
         ORDER BY g.created_at DESC`
      )
    }

    if (goals.length === 0) {
      return {
        success: true,
        goals: [],
        message: goalId ? `Goal ${goalId} not found.` : 'No savings goals found.',
      }
    }

    const statuses = goals.map((goal: any) => {
      const targetAmount = fromCentavos(goal.target_amount)
      const currentAmount = fromCentavos(goal.current_amount)
      const remaining = Math.max(0, targetAmount - currentAmount)
      const progress = targetAmount > 0 ? Math.round((currentAmount / targetAmount) * 100) : 0
      const isCompleted = currentAmount >= targetAmount

      let daysRemaining: number | null = null
      let monthlyNeeded = 0

      if (goal.deadline) {
        daysRemaining = Math.max(0, dayjs(goal.deadline).diff(dayjs(), 'day'))
        const monthsLeft = dayjs(goal.deadline).diff(dayjs(), 'month', true)
        if (monthsLeft > 0 && remaining > 0) {
          monthlyNeeded = Math.ceil(remaining / monthsLeft)
        } else if (remaining > 0) {
          monthlyNeeded = remaining
        }
      }

      return {
        id: goal.id,
        name: goal.name,
        icon: goal.icon,
        targetAmount,
        currentAmount,
        remaining,
        progress,
        isCompleted,
        deadline: goal.deadline,
        daysRemaining,
        monthlyNeeded,
        accountName: goal.account_name,
        notes: goal.notes,
      }
    })

    const totalTarget = statuses.reduce((s: number, g: any) => s + g.targetAmount, 0)
    const totalSaved = statuses.reduce((s: number, g: any) => s + g.currentAmount, 0)
    const completedCount = statuses.filter((g: any) => g.isCompleted).length

    return {
      success: true,
      goals: statuses,
      summary: {
        totalGoals: statuses.length,
        completedGoals: completedCount,
        totalTarget,
        totalSaved,
        totalRemaining: totalTarget - totalSaved,
        overallProgress: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0,
      },
      message: `${statuses.length} savings goal(s). $${totalSaved.toFixed(2)} / $${totalTarget.toFixed(2)} total (${totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}%). ${completedCount} completed.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 39. get-financial-health-score
// ---------------------------------------------------------------------------

const getFinancialHealthScore: ToolDefinition = {
  name: 'get-financial-health-score',
  mcpUnavailableMessage: 'Financial health scoring is not available via the Shikin MCP server yet.',
  description:
    "Calculate the user's financial health score (0-100) with a breakdown across savings rate, budget adherence, debt-to-income, emergency fund, and spending consistency.",
  schema: z.object({}),
  execute: async () => {
    // TODO: Wire up health score service
    return {
      success: false,
      message:
        'Financial health score is not yet available in CLI mode. This will be wired up in a future release.',
    }
  },
}

// ---------------------------------------------------------------------------
// 40. get-spending-recap
// ---------------------------------------------------------------------------

const getSpendingRecap: ToolDefinition = {
  name: 'get-spending-recap',
  mcpUnavailableMessage:
    'Spending recap generation is not available via the Shikin MCP server yet.',
  description: 'Generate a natural-language spending recap for a given period.',
  schema: z.object({
    type: z
      .enum(['weekly', 'monthly'])
      .describe('Type of recap: weekly (past 7 days) or monthly (full month)'),
    period: z
      .string()
      .optional()
      .describe('Optional ISO date (YYYY-MM-DD) to target a specific month.'),
  }),
  execute: async () => {
    // TODO: Wire up recap service
    return {
      success: false,
      message:
        'Spending recap is not yet available in CLI mode. This will be wired up in a future release.',
    }
  },
}

// ---------------------------------------------------------------------------
// 41. get-debt-payoff-plan
// ---------------------------------------------------------------------------

const getDebtPayoffPlan: ToolDefinition = {
  name: 'get-debt-payoff-plan',
  description:
    'Calculate a debt payoff plan using snowball or avalanche strategy. Pulls credit card debts from accounts automatically.',
  schema: z.object({
    strategy: z
      .enum(['snowball', 'avalanche'])
      .optional()
      .default('avalanche')
      .describe(
        'Payoff strategy. Avalanche = highest APR first. Snowball = smallest balance first.'
      ),
    extraPayment: z
      .number()
      .optional()
      .default(0)
      .describe('Extra monthly payment in dollars on top of minimums.'),
  }),
  execute: async ({ strategy, extraPayment }) => {
    const accounts = await query<any>(
      `SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 AND balance < 0`
    )

    if (accounts.length === 0) {
      return {
        success: true,
        message: 'No credit card debts found. All credit card balances are zero or positive.',
        debts: [],
      }
    }

    const debts = accounts.map((a: any) => ({
      id: a.id,
      name: a.name,
      balance: Math.abs(a.balance),
      apr: 0, // Default — user should configure APR
      minPayment: Math.max(Math.round(Math.abs(a.balance) * 0.02), 2500), // 2% or $25 min
    }))

    // Sort based on strategy
    const sorted = [...debts].sort((a, b) => {
      if ((strategy ?? 'avalanche') === 'avalanche') {
        return b.apr - a.apr || a.balance - b.balance
      }
      return a.balance - b.balance
    })

    const totalDebt = debts.reduce((s: number, d: any) => s + d.balance, 0)
    const totalMinPayment = debts.reduce((s: number, d: any) => s + d.minPayment, 0)
    const extraCentavos = Math.round((extraPayment ?? 0) * 100)
    const monthlyPayment = totalMinPayment + extraCentavos

    // Simple estimate: total / monthly (no interest since APR defaults to 0)
    const months = monthlyPayment > 0 ? Math.ceil(totalDebt / monthlyPayment) : 0

    return {
      success: true,
      strategy: strategy ?? 'avalanche',
      debts: debts.map((d: any) => ({
        name: d.name,
        balance: fromCentavos(d.balance),
        apr: d.apr,
        minPayment: fromCentavos(d.minPayment),
      })),
      totalDebt: fromCentavos(totalDebt),
      monthsToPayoff: months,
      totalMinimumPayment: fromCentavos(totalMinPayment),
      extraMonthlyPayment: extraPayment ?? 0,
      payoffOrder: sorted.map((d: any) => d.name),
      message: `${strategy ?? 'avalanche'} strategy: ~${months} months to pay off $${fromCentavos(totalDebt).toFixed(2)} in debt.${extraPayment ? ` With $${extraPayment}/month extra payment.` : ''} Note: APR defaults to 0% — configure APR per account for accurate projections.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 42. convert-currency
// ---------------------------------------------------------------------------

const convertCurrency: ToolDefinition = {
  name: 'convert-currency',
  description: 'Convert an amount from one currency to another using stored exchange rates.',
  schema: z.object({
    amount: positiveMoneyAmount('The amount to convert (in regular units, e.g. 100.50)'),
    from: currencyCode('Source currency code (e.g. USD, EUR, GBP)'),
    to: currencyCode('Target currency code (e.g. MXN, JPY, BRL)'),
  }),
  execute: async ({ amount, from, to }) => {
    const fromUpper = from.toUpperCase()
    const toUpper = to.toUpperCase()

    if (fromUpper === toUpper) {
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: amount,
        rate: 1,
        message: `${amount} ${fromUpper} = ${amount} ${toUpper} (same currency)`,
      }
    }

    // Try to find a rate in exchange_rates table
    const directRate = await query<{ rate: number }>(
      `SELECT rate FROM exchange_rates
       WHERE base_currency = $1 AND target_currency = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [fromUpper, toUpper]
    )

    if (directRate.length > 0) {
      const rate = directRate[0].rate
      const converted = amount * rate
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: Number(converted.toFixed(2)),
        rate: Number(rate.toFixed(6)),
        message: `${amount} ${fromUpper} = ${converted.toFixed(2)} ${toUpper} (rate: ${rate.toFixed(4)})`,
      }
    }

    // Try inverse rate
    const inverseRate = await query<{ rate: number }>(
      `SELECT rate FROM exchange_rates
       WHERE base_currency = $1 AND target_currency = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [toUpper, fromUpper]
    )

    if (inverseRate.length > 0) {
      const rate = 1 / inverseRate[0].rate
      const converted = amount * rate
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: Number(converted.toFixed(2)),
        rate: Number(rate.toFixed(6)),
        message: `${amount} ${fromUpper} = ${converted.toFixed(2)} ${toUpper} (rate: ${rate.toFixed(4)})`,
      }
    }

    return {
      amount,
      from: fromUpper,
      to: toUpper,
      convertedAmount: null,
      rate: null,
      message: `No exchange rate found for ${fromUpper} to ${toUpper}. Import exchange rates first.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 43. split-transaction
// ---------------------------------------------------------------------------

const splitTransaction: ToolDefinition = {
  name: 'split-transaction',
  description:
    'Split a transaction across multiple categories. Use when a single transaction should be allocated to different spending categories.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'The ID of the transaction to split', 128),
    splits: z
      .array(
        z.object({
          categoryId: boundedText('Category ID', 'Category ID for this split portion', 128),
          amount: positiveMoneyAmount('Amount for this split in main currency unit'),
          notes: boundedText('Notes', 'Optional note for this split', 1000).optional(),
        })
      )
      .min(2)
      .describe('Array of split portions. Must have at least 2 splits.'),
  }),
  execute: async ({ transactionId, splits }) => {
    const transactions = await query<any>(
      'SELECT id, amount, description FROM transactions WHERE id = $1',
      [transactionId]
    )

    if (transactions.length === 0) {
      return { success: false, message: `Transaction ${transactionId} not found.` }
    }

    const transaction = transactions[0]
    const splitsCentavos = splits.map((s: any) => ({
      categoryId: s.categoryId,
      amount: toCentavos(s.amount),
      notes: s.notes ?? null,
    }))

    const splitsTotal = splitsCentavos.reduce((sum: number, s: any) => sum + s.amount, 0)
    if (splitsTotal !== transaction.amount) {
      return {
        success: false,
        message: `Split amounts total $${(splitsTotal / 100).toFixed(2)} but transaction amount is $${(transaction.amount / 100).toFixed(2)}. They must match exactly.`,
      }
    }

    // Mark original transaction as split
    await execute(
      "UPDATE transactions SET is_split = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1",
      [transactionId]
    )

    // Insert split records
    for (const split of splitsCentavos) {
      const splitId = generateId()
      await execute(
        `INSERT INTO transaction_splits (id, transaction_id, category_id, amount, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [splitId, transactionId, split.categoryId, split.amount, split.notes]
      )
    }

    return {
      success: true,
      transactionId,
      description: transaction.description,
      splitCount: splits.length,
      message: `Split "${transaction.description}" into ${splits.length} categories.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 44. get-education-tip
// ---------------------------------------------------------------------------

const getEducationTip: ToolDefinition = {
  name: 'get-education-tip',
  mcpUnavailableMessage: 'Education tips are not available via the Shikin MCP server yet.',
  description:
    'Get a contextual financial education tip. Use this when the user asks about financial concepts or when educational context would enhance the conversation.',
  schema: z.object({
    topic: z
      .enum(['budgeting', 'saving', 'investing', 'debt', 'general'])
      .optional()
      .describe('The financial topic to get a tip about'),
    action: z.string().optional().describe('The user action that triggered this tip'),
    query: z.string().optional().describe('A free-text query to match against tip content'),
  }),
  execute: async () => {
    // TODO: Wire up education service with tip database
    return {
      success: false,
      message:
        'Education tips are not yet available in CLI mode. This will be wired up in a future release.',
      disclaimer:
        'This is educational information, not financial advice. Consider consulting a qualified financial professional for personalized guidance.',
    }
  },
}

// ---------------------------------------------------------------------------
// Export all tools
// ---------------------------------------------------------------------------

export const tools: ToolDefinition[] = [
  addTransaction,
  updateTransaction,
  deleteTransaction,
  queryTransactions,
  getSpendingSummary,
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  listCategories,
  getBalanceOverview,
  analyzeSpendingTrends,
  saveMemory,
  recallMemories,
  forgetMemory,
  getCreditCardStatus,
  createBudget,
  getBudgetStatus,
  deleteBudget,
  getNetWorth,
  manageInvestment,
  getUpcomingBills,
  listSubscriptions,
  getSubscriptionSpending,
  writeNotebookTool,
  readNotebookTool,
  listNotebookTool,
  getFinancialNews,
  getCongressionalTrades,
  generatePortfolioReview,
  manageCategoryRules,
  getSpendingAnomalies,
  manageRecurringTransaction,
  materializeRecurring,
  getForecastedCashFlow,
  createGoal,
  updateGoal,
  getGoalStatus,
  getFinancialHealthScore,
  getSpendingRecap,
  getDebtPayoffPlan,
  convertCurrency,
  splitTransaction,
  getEducationTip,
]
