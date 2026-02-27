import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import Database from '@tauri-apps/plugin-sql'
import { homeDir } from '@tauri-apps/api/path'

interface SubbySubscription {
  id: string
  name: string
  amount: number
  currency: string
  billing_cycle: string
  next_payment_date: string | null
  category_name: string | null
  status: string
}

async function getSubbyDb(): Promise<Database> {
  const home = await homeDir()
  return Database.load(`sqlite:${home}/.local/share/com.newstella.subby/subby.db`)
}

export const listSubscriptions = tool({
  description:
    'List subscriptions from Subby (the subscription tracker app). Shows active subscriptions with their amounts, billing cycles, and next payment dates.',
  inputSchema: zodSchema(
    z.object({
      activeOnly: z
        .boolean()
        .optional()
        .default(true)
        .describe('Only show active subscriptions (default: true)'),
    })
  ),
  execute: async ({ activeOnly }) => {
    try {
      const db = await getSubbyDb()

      const statusFilter = activeOnly ? "AND s.status = 'active'" : ''
      const subs = await db.select<SubbySubscription[]>(
        `SELECT s.id, s.name, s.amount, s.currency, s.billing_cycle,
                s.next_payment_date, c.name as category_name, s.status
         FROM subscriptions s
         LEFT JOIN categories c ON s.category_id = c.id
         WHERE 1=1 ${statusFilter}
         ORDER BY s.next_payment_date ASC`
      )

      if (subs.length === 0) {
        return {
          success: true,
          subscriptions: [],
          message: 'No subscriptions found in Subby.',
        }
      }

      const totalMonthly = subs.reduce((sum, s) => {
        const amount = s.amount
        switch (s.billing_cycle) {
          case 'weekly': return sum + amount * 4.33
          case 'monthly': return sum + amount
          case 'quarterly': return sum + amount / 3
          case 'yearly': return sum + amount / 12
          default: return sum + amount
        }
      }, 0)

      return {
        success: true,
        subscriptions: subs.map((s) => ({
          id: s.id,
          name: s.name,
          amount: s.amount,
          currency: s.currency,
          billingCycle: s.billing_cycle,
          nextPaymentDate: s.next_payment_date,
          category: s.category_name,
          status: s.status,
        })),
        summary: {
          count: subs.length,
          estimatedMonthly: Math.round(totalMonthly * 100) / 100,
          estimatedYearly: Math.round(totalMonthly * 12 * 100) / 100,
        },
        message: `${subs.length} subscription(s). Estimated monthly: $${totalMonthly.toFixed(2)}.`,
      }
    } catch (error) {
      return {
        success: false,
        message: 'Could not connect to Subby. Make sure Subby is installed and has been run at least once.',
      }
    }
  },
})
