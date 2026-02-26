import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import type { Account } from '@/types/database'
import dayjs from 'dayjs'

interface MonthlyTotal {
  total_income: number
  total_expenses: number
}

export const getBalanceOverview = tool({
  description:
    'Get a complete balance overview including total balance, per-account breakdown, and month-over-month change. Use this when the user asks about their overall financial situation or net worth.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    // Get all active accounts
    const accounts = await query<Account>(
      'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY name'
    )

    const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0)

    // Current month income & expenses
    const currentMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')
    const currentMonthEnd = dayjs().endOf('month').format('YYYY-MM-DD')

    const currentMonth = await query<MonthlyTotal>(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses
       FROM transactions
       WHERE date >= $1 AND date <= $2`,
      [currentMonthStart, currentMonthEnd]
    )

    // Previous month income & expenses
    const prevMonthStart = dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
    const prevMonthEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

    const prevMonth = await query<MonthlyTotal>(
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
      accounts: accounts.map((a) => ({
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
})
