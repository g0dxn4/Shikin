import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import dayjs from 'dayjs'

interface BudgetRow {
  id: string
  name: string
  amount: number
  period: string
  category_id: string | null
  category_name: string | null
}

export const getBudgetStatus = tool({
  description:
    'Get budget status showing how much has been spent vs the budget amount for the current period. If no categoryId is given, returns all active budgets.',
  inputSchema: zodSchema(
    z.object({
      categoryId: z
        .string()
        .optional()
        .describe('Filter by category ID. Omit to see all budgets.'),
    })
  ),
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
      return {
        success: true,
        budgets: [],
        message: 'No active budgets found.',
      }
    }

    const today = dayjs()

    const statuses = await Promise.all(
      budgets.map(async (budget) => {
        // Determine period start/end
        let periodStart: string
        let periodEnd: string

        if (budget.period === 'weekly') {
          periodStart = today.startOf('week').format('YYYY-MM-DD')
          periodEnd = today.endOf('week').format('YYYY-MM-DD')
        } else if (budget.period === 'yearly') {
          periodStart = today.startOf('year').format('YYYY-MM-DD')
          periodEnd = today.endOf('year').format('YYYY-MM-DD')
        } else {
          // monthly (default)
          periodStart = today.startOf('month').format('YYYY-MM-DD')
          periodEnd = today.endOf('month').format('YYYY-MM-DD')
        }

        // Sum expenses for this category in the period
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
})
