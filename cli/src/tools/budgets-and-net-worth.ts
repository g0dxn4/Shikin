import {
  z,
  query,
  execute,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  nextDateForDay,
  type ToolDefinition,
} from './shared.js'

type CreditCardRow = {
  id: string
  name: string
  currency: string
  balance: number
  credit_limit: number | null
  statement_closing_day: number | null
  payment_due_day: number | null
}

type BudgetRow = {
  id: string
  name: string
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
  category_id: string | null
  category_name: string | null
}

type NetWorthAccountRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
}

type InvestmentWithLatestPriceRow = {
  id: string
  name: string
  symbol: string
  type: string
  shares: number
  avg_cost_basis: number
  currency: string
  latest_price: number | null
}

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
    let cards: CreditCardRow[]

    if (accountId) {
      cards = await query<CreditCardRow>(
        "SELECT * FROM accounts WHERE id = $1 AND type = 'credit_card' AND is_archived = 0",
        [accountId]
      )
      if (cards.length === 0) {
        return { success: false, message: `Credit card ${accountId} not found.` }
      }
    } else {
      cards = await query<CreditCardRow>(
        "SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 ORDER BY name"
      )
      if (cards.length === 0) {
        return { success: false, message: 'No credit cards found.' }
      }
    }

    const statuses = cards.map((card) => {
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
    let budgets: BudgetRow[]

    if (categoryId) {
      budgets = await query<BudgetRow>(
        `SELECT b.id, b.name, b.amount, b.period, b.category_id, c.name as category_name
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         WHERE b.is_active = 1 AND b.category_id = $1`,
        [categoryId]
      )
    } else {
      budgets = await query<BudgetRow>(
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
      budgets.map(async (budget) => {
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
    const accounts = await query<NetWorthAccountRow>(
      'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY type, name'
    )

    const investments = await query<InvestmentWithLatestPriceRow>(
      `SELECT i.*,
              (SELECT sp.price FROM stock_prices sp WHERE sp.symbol = i.symbol ORDER BY sp.date DESC LIMIT 1) as latest_price
       FROM investments i
       ORDER BY i.name`
    )

    let totalAssets = 0
    let totalLiabilities = 0

    const accountBreakdown = accounts.map((acc) => {
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

    const investmentBreakdown = investments.map((inv) => {
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

export const budgetsandnetworthTools: ToolDefinition[] = [
  getCreditCardStatus,
  createBudget,
  getBudgetStatus,
  deleteBudget,
  getNetWorth,
]
