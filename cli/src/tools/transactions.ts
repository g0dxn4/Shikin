import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  boundedText,
  isoDate,
  positiveMoneyAmount,
  unsupportedTransferMessage,
  resolveAccountId,
  crossCurrencyMoveMessage,
  unknownTransactionCurrencyFailure,
  getDistinctCurrencies,
  getCategoryIdentity,
  missingCurrencyRepairFailure,
  hasMissingCurrency,
  resolveCategoryId,
  type ToolDefinition,
} from './shared.js'

type TransactionRow = {
  id: string
  account_id: string
  category_id: string | null
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string | null
  description: string
  notes: string | null
  date: string
}

type QueriedTransactionRow = {
  id: string
  description: string
  amount: number
  type: 'expense' | 'income' | 'transfer'
  date: string
  notes: string | null
  category_name: string
  account_name: string
}

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
      'Category name (e.g. "Food & Dining", "Salary"). Must resolve to one existing category.',
      120
    ).optional(),
    date: isoDate('Transaction date in YYYY-MM-DD format. Defaults to today.').optional(),
    notes: boundedText('Notes', 'Additional notes about the transaction', 1000).optional(),
    accountId: boundedText(
      'Account ID',
      'Optional account ID to apply the transaction to. Required when multiple accounts exist.',
      128
    ).optional(),
  }),
  execute: async ({ amount, type, description, category, date, notes, accountId }) => {
    if (type === 'transfer') {
      return {
        success: false,
        message: unsupportedTransferMessage(),
      }
    }

    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const txDate = date || dayjs().format('YYYY-MM-DD')

    return transaction(() => {
      const resolvedCategory = resolveCategoryId(category)
      if (!resolvedCategory.success) {
        return {
          success: false,
          message: resolvedCategory.message,
        }
      }

      const resolvedAccount = resolveAccountId(accountId)
      if (!resolvedAccount.success) {
        return {
          success: false,
          message: resolvedAccount.message,
        }
      }

      execute(
        `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, notes, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          resolvedAccount.id,
          resolvedCategory.id,
          type,
          amountCentavos,
          resolvedAccount.currency,
          description,
          notes || null,
          txDate,
        ]
      )

      const balanceChange = type === 'income' ? amountCentavos : -amountCentavos
      execute(
        "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [balanceChange, resolvedAccount.id]
      )

      return {
        success: true,
        transaction: {
          id,
          accountId: resolvedAccount.id,
          amount,
          type,
          description,
          category: resolvedCategory.name,
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
      const existing = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]
      const oldAmountCentavos = tx.amount
      const oldType = tx.type
      const oldAccountId = tx.account_id

      if (!tx.currency) {
        return unknownTransactionCurrencyFailure(tx)
      }

      if (type === 'transfer') {
        return {
          success: false,
          message: unsupportedTransferMessage(),
        }
      }

      const newAmount = amount !== undefined ? toCentavos(amount) : oldAmountCentavos
      const newType = type || oldType
      const isMovingAccounts = accountId !== undefined && accountId !== oldAccountId
      const sourceCurrency = tx.currency
      let resolvedAccount:
        | { success: true; id: string; currency: string }
        | { success: false; message: string }
        | null = null

      if (isMovingAccounts) {
        resolvedAccount = resolveAccountId(accountId)
        if (!resolvedAccount.success) {
          return { success: false, message: resolvedAccount.message }
        }

        if (sourceCurrency && resolvedAccount.currency !== sourceCurrency) {
          return {
            success: false,
            message: crossCurrencyMoveMessage(
              'transaction',
              sourceCurrency,
              resolvedAccount.currency
            ),
          }
        }
      }

      const newAccountId = resolvedAccount?.success ? resolvedAccount.id : accountId || oldAccountId
      const newCurrency = sourceCurrency

      let newCategoryId = tx.category_id
      if (category !== undefined) {
        const resolvedCategory = resolveCategoryId(category)
        if (!resolvedCategory.success) {
          return { success: false, message: resolvedCategory.message }
        }
        newCategoryId = resolvedCategory.id
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
         SET amount = $1, type = $2, description = $3, category_id = $4, date = $5, notes = $6, account_id = $7, currency = $8,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $9`,
        [
          newAmount,
          newType,
          description !== undefined ? description : tx.description,
          newCategoryId,
          date || tx.date,
          notes !== undefined ? (notes === '' ? null : notes) : tx.notes,
          newAccountId,
          newCurrency,
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
      const existing = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ])

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

    const transactions = await query<QueriedTransactionRow>(
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
      transactions: transactions.map((t) => ({
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

    if (period === 'custom' && (!startDate || !endDate)) {
      return {
        success: false,
        message: 'Custom spending summaries require both startDate and endDate.',
      }
    }

    if (period === 'custom' && startDate && endDate) {
      start = startDate
      end = endDate
      if (dayjs(start).isAfter(dayjs(end), 'day')) {
        return {
          success: false,
          message: 'Custom spending summaries require startDate to be on or before endDate.',
        }
      }
    } else {
      const now = dayjs()
      end = now.format('YYYY-MM-DD')
      switch (period) {
        case 'week':
          start = now.subtract(6, 'day').format('YYYY-MM-DD')
          break
        case 'year':
          start = now.startOf('year').format('YYYY-MM-DD')
          break
        default:
          start = now.startOf('month').format('YYYY-MM-DD')
      }
    }

    const spending = await query<{
      currency: string
      category_id: string | null
      category_name: string
      total: number
      count: number
    }>(
      `SELECT
         t.currency as currency,
         t.category_id as category_id,
         COALESCE(c.name, 'Uncategorized') as category_name,
         SUM(t.amount) as total,
         COUNT(*) as count
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.type = 'expense'
          AND t.date >= $1
          AND t.date <= $2
        GROUP BY t.currency, t.category_id, c.name
        ORDER BY t.currency ASC, total DESC`,
      [start, end]
    )

    const totals = await query<{ currency: string; type: string; total: number }>(
      `SELECT currency, type, COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE type IN ('income', 'expense') AND date >= $1 AND date <= $2
       GROUP BY currency, type`,
      [start, end]
    )

    if (hasMissingCurrency([...spending, ...totals])) {
      return missingCurrencyRepairFailure('Spending summary')
    }

    const currencies = getDistinctCurrencies([...spending, ...totals])
    const totalsByCurrency = currencies.map((currency) => {
      const expenses =
        totals.find((row) => row.currency === currency && row.type === 'expense')?.total || 0
      const income =
        totals.find((row) => row.currency === currency && row.type === 'income')?.total || 0
      return {
        currency,
        totalExpenses: fromCentavos(expenses),
        totalIncome: fromCentavos(income),
        netSavings: fromCentavos(income - expenses),
      }
    })
    const singleCurrency = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null
    const emptyPeriodTotals =
      totalsByCurrency.length === 0 ? { totalExpenses: 0, totalIncome: 0, netSavings: 0 } : null

    return {
      period: { start, end },
      mixedCurrency: totalsByCurrency.length > 1,
      totalExpenses: singleCurrency?.totalExpenses ?? emptyPeriodTotals?.totalExpenses ?? null,
      totalIncome: singleCurrency?.totalIncome ?? emptyPeriodTotals?.totalIncome ?? null,
      netSavings: singleCurrency?.netSavings ?? emptyPeriodTotals?.netSavings ?? null,
      totalsByCurrency,
      byCategory: spending.map((row) => ({
        currency: row.currency,
        ...getCategoryIdentity(row.category_id, row.category_name),
        amount: fromCentavos(row.total),
        transactionCount: row.count,
        percentage:
          (totalsByCurrency.find((totalsRow) => totalsRow.currency === row.currency)
            ?.totalExpenses ?? 0) > 0
            ? Math.round(
                (fromCentavos(row.total) /
                  (totalsByCurrency.find((totalsRow) => totalsRow.currency === row.currency)
                    ?.totalExpenses ?? 0)) *
                  100
              )
            : 0,
      })),
      message:
        spending.length === 0
          ? `No expenses found for ${start} to ${end}.`
          : singleCurrency
            ? `Total spending from ${start} to ${end}: ${singleCurrency.currency} ${singleCurrency.totalExpenses.toFixed(2)} across ${spending.length} categories.`
            : `Found spending from ${start} to ${end} across ${totalsByCurrency.length} currencies. See totalsByCurrency and byCategory for per-currency breakdowns; no FX conversion was applied.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 6. list-accounts
// ---------------------------------------------------------------------------

export const transactionsTools: ToolDefinition[] = [
  addTransaction,
  updateTransaction,
  deleteTransaction,
  queryTransactions,
  getSpendingSummary,
]
