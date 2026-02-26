import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import dayjs from 'dayjs'

interface MonthlyBreakdown {
  month: string
  category_name: string
  total: number
}

interface MonthlyAggregate {
  month: string
  total_expenses: number
  total_income: number
}

export const analyzeSpendingTrends = tool({
  description:
    'Analyze spending trends over multiple months with category breakdowns and trend detection. Use this when the user asks about spending patterns, trends, or how their spending has changed over time.',
  inputSchema: zodSchema(
    z.object({
      months: z
        .number()
        .int()
        .min(2)
        .max(12)
        .optional()
        .default(3)
        .describe('Number of months to analyze (default 3, max 12)'),
    })
  ),
  execute: async ({ months }) => {
    const startDate = dayjs()
      .subtract(months - 1, 'month')
      .startOf('month')
      .format('YYYY-MM-DD')
    const endDate = dayjs().endOf('month').format('YYYY-MM-DD')

    // Per-month per-category breakdown
    const breakdown = await query<MonthlyBreakdown>(
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

    // Per-month aggregates
    const aggregates = await query<MonthlyAggregate>(
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

    // Build per-month data
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

    // Detect trends: compare most recent month vs previous month
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

      // Find categories that appear in either month
      const allCategories = new Set([...latestCategories.keys(), ...prevCategories.keys()])

      for (const cat of allCategories) {
        const latest = latestCategories.get(cat) || 0
        const prev = prevCategories.get(cat) || 0

        if (prev === 0) continue // skip new categories with no baseline

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
})
