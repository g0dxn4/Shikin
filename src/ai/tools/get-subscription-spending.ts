import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import Database from '@tauri-apps/plugin-sql'
import { homeDir } from '@tauri-apps/api/path'

interface SubbySubscription {
  name: string
  amount: number
  currency: string
  billing_cycle: string
  category_name: string | null
}

async function getSubbyDb(): Promise<Database> {
  const home = await homeDir()
  return Database.load(`sqlite:${home}/.local/share/com.newstella.subby/subby.db`)
}

export const getSubscriptionSpending = tool({
  description:
    'Analyze subscription spending from Subby. Groups subscriptions by category and shows monthly/yearly cost breakdown.',
  inputSchema: zodSchema(
    z.object({})
  ),
  execute: async () => {
    try {
      const db = await getSubbyDb()

      const subs = await db.select<SubbySubscription[]>(
        `SELECT s.name, s.amount, s.currency, s.billing_cycle, c.name as category_name
         FROM subscriptions s
         LEFT JOIN categories c ON s.category_id = c.id
         WHERE s.status = 'active'
         ORDER BY s.amount DESC`
      )

      if (subs.length === 0) {
        return {
          success: true,
          categories: [],
          message: 'No active subscriptions found in Subby.',
        }
      }

      // Normalize all to monthly
      function toMonthly(amount: number, cycle: string): number {
        switch (cycle) {
          case 'weekly': return amount * 4.33
          case 'monthly': return amount
          case 'quarterly': return amount / 3
          case 'yearly': return amount / 12
          default: return amount
        }
      }

      // Group by category
      const byCategory = new Map<string, { subscriptions: string[]; monthly: number }>()
      let totalMonthly = 0

      for (const sub of subs) {
        const cat = sub.category_name || 'Uncategorized'
        const monthly = toMonthly(sub.amount, sub.billing_cycle)
        totalMonthly += monthly

        const entry = byCategory.get(cat) || { subscriptions: [], monthly: 0 }
        entry.subscriptions.push(sub.name)
        entry.monthly += monthly
        byCategory.set(cat, entry)
      }

      const categories = Array.from(byCategory.entries())
        .map(([name, data]) => ({
          category: name,
          subscriptions: data.subscriptions,
          monthlyTotal: Math.round(data.monthly * 100) / 100,
          yearlyTotal: Math.round(data.monthly * 12 * 100) / 100,
          percentOfTotal: totalMonthly > 0 ? Math.round((data.monthly / totalMonthly) * 100) : 0,
        }))
        .sort((a, b) => b.monthlyTotal - a.monthlyTotal)

      return {
        success: true,
        categories,
        totals: {
          monthly: Math.round(totalMonthly * 100) / 100,
          yearly: Math.round(totalMonthly * 12 * 100) / 100,
          subscriptionCount: subs.length,
        },
        message: `${subs.length} active subscriptions across ${categories.length} categories. Monthly burn: $${totalMonthly.toFixed(2)}, yearly: $${(totalMonthly * 12).toFixed(2)}.`,
      }
    } catch {
      return {
        success: false,
        message: 'Could not connect to Subby. Make sure Subby is installed and has been run at least once.',
      }
    }
  },
})
