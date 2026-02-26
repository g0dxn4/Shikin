import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { query } from '@/lib/database'
import { fromCentavos } from '@/lib/money'
import dayjs from 'dayjs'

interface SpendingRow {
  category_name: string
  total: number
  count: number
}

export const getSpendingSummary = tool({
  description:
    'Get a summary of spending by category for a given time period. Use this when the user asks about their spending, expenses, or budget status.',
  inputSchema: zodSchema(
    z.object({
      period: z
        .enum(['week', 'month', 'year', 'custom'])
        .optional()
        .default('month')
        .describe('The time period to summarize'),
      startDate: z
        .string()
        .optional()
        .describe('Start date (YYYY-MM-DD) for custom period'),
      endDate: z
        .string()
        .optional()
        .describe('End date (YYYY-MM-DD) for custom period'),
    })
  ),
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

    const spending = await query<SpendingRow>(
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
})
