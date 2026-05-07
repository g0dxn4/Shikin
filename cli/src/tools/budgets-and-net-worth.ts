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
  positiveMoneyAmount,
  resolveCategoryId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

type BudgetRow = {
  id: string
  name: string
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
  category_id: string | null
  category_name: string | null
  is_active?: number
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
}

type BudgetUpsertMatch =
  | { success: true; budget: BudgetRow; matchedBy: 'budgetId' | 'category' | 'name' }
  | { success: true; budget: null; matchedBy: 'new' }
  | { success: false; reason?: string; message: string }

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

function budgetSnapshot(budget: BudgetRow) {
  return {
    id: budget.id,
    name: budget.name,
    amount: fromCentavos(budget.amount),
    amountCentavos: budget.amount,
    period: budget.period,
    categoryId: budget.category_id,
    categoryName: budget.category_name ?? null,
    isActive: budget.is_active === undefined ? true : budget.is_active === 1,
  }
}

function resolveBudgetCategory(categoryId?: string, categoryName?: string) {
  if (categoryId) {
    const rows = query<{ id: string; name: string }>(
      'SELECT id, name FROM categories WHERE id = $1 LIMIT 1',
      [categoryId]
    )
    if (rows.length === 0) {
      return { success: false as const, message: `Category ${categoryId} not found.` }
    }
    return { success: true as const, id: rows[0].id, name: rows[0].name }
  }

  if (!categoryName) return { success: true as const, id: null, name: null }
  return resolveCategoryId(categoryName)
}

function findBudgetForUpsert(input: {
  budgetId?: string
  name?: string
  categoryId: string | null
  period?: 'weekly' | 'monthly' | 'yearly'
}): BudgetUpsertMatch {
  if (input.budgetId) {
    const budget = query<BudgetRow>(
      `SELECT b.id, b.name, b.amount, b.period, b.category_id, b.is_active, c.name as category_name
       FROM budgets b
       LEFT JOIN categories c ON b.category_id = c.id
       WHERE b.id = $1
       LIMIT 1`,
      [input.budgetId]
    )[0]
    return budget
      ? { success: true, budget, matchedBy: 'budgetId' }
      : { success: true, budget: null, matchedBy: 'new' }
  }

  if (input.categoryId) {
    const periodFilter = input.period ? ' AND b.period = $2' : ''
    const params = input.period ? [input.categoryId, input.period] : [input.categoryId]
    const matches = query<BudgetRow>(
      `SELECT b.id, b.name, b.amount, b.period, b.category_id, b.is_active, c.name as category_name
       FROM budgets b
       LEFT JOIN categories c ON b.category_id = c.id
        WHERE b.category_id = $1${periodFilter}
        ORDER BY b.is_active DESC, b.name ASC, b.id ASC
        LIMIT 2`,
      params
    )
    if (matches.length === 1) return { success: true, budget: matches[0], matchedBy: 'category' }
    if (matches.length > 1) {
      const periodLabel = input.period ? `${input.period} budgets` : 'budgets'
      return {
        success: false,
        reason: 'budget_match_ambiguous',
        message: `Multiple ${periodLabel} already exist for category ${input.categoryId}. Use budgetId or period to update the intended one.`,
      }
    }
  }

  if (input.name) {
    const matches = query<BudgetRow>(
      `SELECT b.id, b.name, b.amount, b.period, b.category_id, b.is_active, c.name as category_name
       FROM budgets b
       LEFT JOIN categories c ON b.category_id = c.id
       WHERE LOWER(b.name) = LOWER($1)
       ORDER BY b.is_active DESC, b.name ASC, b.id ASC
       LIMIT 2`,
      [input.name]
    )
    if (matches.length === 1) return { success: true, budget: matches[0], matchedBy: 'name' }
    if (matches.length > 1) {
      return {
        success: false,
        reason: 'budget_match_ambiguous',
        message: `Budget name "${input.name}" matches multiple budgets. Use budgetId to update the intended one.`,
      }
    }
  }

  return { success: true, budget: null, matchedBy: 'new' }
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
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the budget without writing it'),
  }),
  execute: async ({ categoryId, categoryName, amount, period, name, dryRun }) => {
    let resolvedCategoryId = categoryId ?? null
    let resolvedCategoryName: string | null = null
    let resolvedName = name

    if (!resolvedCategoryId && categoryName) {
      const categories = await query<{ id: string; name: string }>(
        'SELECT id, name FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
        [`%${categoryName}%`]
      )
      if (categories.length > 0) {
        resolvedCategoryId = categories[0].id
        resolvedCategoryName = categories[0].name
        if (!resolvedName) resolvedName = categories[0].name + ' Budget'
      }
    }

    if (!resolvedName) resolvedName = 'Budget'

    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const createdBudget: BudgetRow = {
      id,
      name: resolvedName,
      amount: amountCentavos,
      period,
      category_id: resolvedCategoryId,
      category_name: resolvedCategoryName,
      is_active: 1,
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        wouldCreate: {
          id,
          name: resolvedName,
          categoryId: resolvedCategoryId,
          amount,
          amountCentavos,
          period,
        },
        message: `Dry run: ${period} budget "${resolvedName}" for $${amount.toFixed(2)} would be created.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO budgets (id, category_id, name, amount, period, is_active)
         VALUES ($1, $2, $3, $4, $5, 1)`,
        [id, resolvedCategoryId, resolvedName, amountCentavos, period]
      )
      writeAuditLog({
        entity: 'budget',
        entityId: id,
        action: 'create',
        before: null,
        after: { budget: budgetSnapshot(createdBudget) },
      })
    })

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

const upsertBudget: ToolDefinition = {
  name: 'upsert-budget',
  description:
    'Idempotently create or update a budget by budgetId, exact budget name, or category/period.',
  schema: z.object({
    budgetId: boundedText('Budget ID', 'Stable budget ID to update or create', 128).optional(),
    categoryId: boundedText('Category ID', 'Category ID to budget', 128).optional(),
    categoryName: boundedText(
      'Category name',
      'Category name to resolve for the budget (e.g. "Food & Dining")',
      120
    ).optional(),
    amount: positiveMoneyAmount('Budget amount in the main currency unit').optional(),
    period: z
      .enum(['weekly', 'monthly', 'yearly'])
      .optional()
      .describe('Budget period. Defaults to monthly when creating.'),
    name: boundedText('Budget name', 'Budget name to create or set', 120).optional(),
    active: z.boolean().optional().describe('Whether the budget should be active'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the budget upsert without writing it'),
  }),
  execute: async ({ budgetId, categoryId, categoryName, amount, period, name, active, dryRun }) => {
    if (!budgetId && !categoryId && !categoryName && !name) {
      return {
        success: false,
        reason: 'budget_stable_match_required',
        message:
          'Provide budgetId, name, categoryId, or categoryName so upsert-budget has a stable match key.',
      }
    }

    const resolvedCategory = resolveBudgetCategory(categoryId, categoryName)
    if (!resolvedCategory.success) return resolvedCategory

    const match = findBudgetForUpsert({
      budgetId,
      name,
      categoryId: resolvedCategory.id,
      period,
    })
    if (!match.success) return match

    if (!match.budget) {
      if (amount === undefined) {
        return { success: false, message: 'amount is required when creating a budget.' }
      }

      const id = budgetId ?? generateId()
      const createdPeriod = period ?? 'monthly'
      const resolvedName =
        name ?? (resolvedCategory.name ? `${resolvedCategory.name} Budget` : 'Budget')
      const amountCentavos = toCentavos(amount)
      const createdBudget: BudgetRow = {
        id,
        name: resolvedName,
        amount: amountCentavos,
        period: createdPeriod,
        category_id: resolvedCategory.id,
        category_name: resolvedCategory.name,
        is_active: active === false ? 0 : 1,
      }

      if (dryRun) {
        return {
          success: true,
          action: 'created' as const,
          dryRun: true,
          matchedBy: match.matchedBy,
          wouldCreate: budgetSnapshot(createdBudget),
          message: `Dry run: ${createdPeriod} budget "${resolvedName}" would be created.`,
        }
      }

      transaction(() => {
        execute(
          `INSERT INTO budgets (id, category_id, name, amount, period, is_active)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            resolvedCategory.id,
            resolvedName,
            amountCentavos,
            createdPeriod,
            active === false ? 0 : 1,
          ]
        )
        writeAuditLog({
          entity: 'budget',
          entityId: id,
          action: 'create',
          before: null,
          after: { budget: budgetSnapshot(createdBudget) },
        })
      })

      return {
        success: true,
        action: 'created' as const,
        matchedBy: match.matchedBy,
        budget: budgetSnapshot(createdBudget),
        message: `Created ${createdPeriod} budget "${resolvedName}".`,
      }
    }

    const existing = match.budget
    const updatedBudget: BudgetRow = {
      ...existing,
      name: name ?? existing.name,
      amount: amount !== undefined ? toCentavos(amount) : existing.amount,
      period: period ?? existing.period,
      category_id:
        categoryId !== undefined || categoryName !== undefined
          ? resolvedCategory.id
          : existing.category_id,
      category_name:
        categoryId !== undefined || categoryName !== undefined
          ? resolvedCategory.name
          : existing.category_name,
      is_active: active !== undefined ? (active ? 1 : 0) : existing.is_active,
    }

    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1
    const addSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIdx++}`)
      params.push(value)
    }

    if (name !== undefined && name !== existing.name) addSet('name', name)
    if (amount !== undefined && toCentavos(amount) !== existing.amount) {
      addSet('amount', toCentavos(amount))
    }
    if (period !== undefined && period !== existing.period) addSet('period', period)
    if (
      (categoryId !== undefined || categoryName !== undefined) &&
      resolvedCategory.id !== existing.category_id
    ) {
      addSet('category_id', resolvedCategory.id)
    }
    const activeValue = active === undefined ? undefined : active ? 1 : 0
    if (activeValue !== undefined && activeValue !== (existing.is_active ?? 1)) {
      addSet('is_active', activeValue)
    }

    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        matchedBy: match.matchedBy,
        changed: setClauses.length > 0,
        wouldUpdate: {
          budgetId: existing.id,
          before: budgetSnapshot(existing),
          after: budgetSnapshot(updatedBudget),
        },
        message: `Dry run: budget "${updatedBudget.name}" would be updated.`,
      }
    }

    if (setClauses.length > 0) {
      transaction(() => {
        setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
        params.push(existing.id)
        const updateResult = execute(
          `UPDATE budgets SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
          params
        )
        assertSingleRowUpdated(updateResult, `Budget ${existing.id} could not be updated safely.`)
        writeAuditLog({
          entity: 'budget',
          entityId: existing.id,
          action: 'update',
          before: { budget: budgetSnapshot(existing) },
          after: { budget: budgetSnapshot(updatedBudget) },
        })
      })
    }

    return {
      success: true,
      action: 'updated' as const,
      matchedBy: match.matchedBy,
      changed: setClauses.length > 0,
      budget: budgetSnapshot(updatedBudget),
      message: `Updated budget "${updatedBudget.name}".`,
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
             WHERE category_id = $1
               AND type = 'expense'
               AND COALESCE(NULLIF(TRIM(status), ''), 'posted') IN ('posted', 'cleared')
               AND date >= $2 AND date <= $3`,
            [budget.category_id, periodStart, periodEnd]
          )
        } else {
          spentResult = await query<{ total: number | null }>(
            `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
             WHERE type = 'expense'
               AND COALESCE(NULLIF(TRIM(status), ''), 'posted') IN ('posted', 'cleared')
               AND date >= $1 AND date <= $2`,
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
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the budget deletion without writing it'),
  }),
  execute: async ({ budgetId, dryRun }) => {
    const existing = await query<BudgetRow>(
      `SELECT b.id, b.name, b.amount, b.period, b.category_id, b.is_active, c.name as category_name
       FROM budgets b
       LEFT JOIN categories c ON b.category_id = c.id
       WHERE b.id = $1`,
      [budgetId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Budget ${budgetId} not found.` }
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        wouldDelete: {
          id: existing[0].id,
          name: existing[0].name,
        },
        message: `Dry run: budget "${existing[0].name}" would be deleted.`,
      }
    }

    transaction(() => {
      execute('DELETE FROM budgets WHERE id = $1', [budgetId])
      writeAuditLog({
        entity: 'budget',
        entityId: budgetId,
        action: 'delete',
        before: { budget: budgetSnapshot(existing[0]) },
        after: null,
      })
    })

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
  createBudget,
  upsertBudget,
  getBudgetStatus,
  deleteBudget,
  getNetWorth,
]
