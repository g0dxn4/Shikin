import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import type { Account } from '@/types/database'
import Database from '@tauri-apps/plugin-sql'
import { homeDir } from '@tauri-apps/api/path'
import dayjs from 'dayjs'

interface UpcomingBill {
  name: string
  amount: number
  currency: string
  dueDate: string
  source: 'credit_card' | 'subscription' | 'recurring'
  daysUntilDue: number
}

function nextDateForDay(day: number): dayjs.Dayjs {
  const today = dayjs()
  const thisMonth = today.date(Math.min(day, today.daysInMonth()))
  if (thisMonth.isAfter(today) || thisMonth.isSame(today, 'day')) {
    return thisMonth
  }
  const nextMonth = today.add(1, 'month')
  return nextMonth.date(Math.min(day, nextMonth.daysInMonth()))
}

export const getUpcomingBills = tool({
  description:
    'Get upcoming bills from credit card due dates, Subby subscriptions, and recurring transactions. Returns a sorted list of bills due within the specified number of days.',
  inputSchema: zodSchema(
    z.object({
      daysAhead: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .default(30)
        .describe('Number of days to look ahead (default: 30)'),
    })
  ),
  execute: async ({ daysAhead }) => {
    const today = dayjs()
    const cutoff = today.add(daysAhead, 'day')
    const bills: UpcomingBill[] = []

    // 1. Credit card payment due dates
    const creditCards = await query<Account>(
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

    // 2. Subscriptions from Subby
    try {
      const home = await homeDir()
      const subbyDb = await Database.load(`sqlite:${home}/.local/share/com.newstella.subby/subby.db`)

      const subs = await subbyDb.select<Array<{
        name: string
        amount: number
        currency: string
        next_payment_date: string | null
      }>>(
        `SELECT name, amount, currency, next_payment_date
         FROM subscriptions
         WHERE status = 'active' AND next_payment_date IS NOT NULL
         ORDER BY next_payment_date ASC`
      )

      for (const sub of subs) {
        if (sub.next_payment_date) {
          const dueDate = dayjs(sub.next_payment_date)
          if ((dueDate.isAfter(today) || dueDate.isSame(today, 'day')) &&
              (dueDate.isBefore(cutoff) || dueDate.isSame(cutoff, 'day'))) {
            bills.push({
              name: sub.name,
              amount: sub.amount,
              currency: sub.currency,
              dueDate: dueDate.format('YYYY-MM-DD'),
              source: 'subscription',
              daysUntilDue: dueDate.diff(today, 'day'),
            })
          }
        }
      }
    } catch {
      // Subby not available — continue without subscription data
    }

    // 3. Recurring transactions (pattern from last 2 months)
    const recurringTx = await query<{
      description: string
      amount: number
      currency: string
      date: string
      count: number
    }>(
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
      // Estimate next date as ~30 days after last occurrence
      const lastDate = dayjs(tx.date)
      const estimatedNext = lastDate.add(30, 'day')
      if ((estimatedNext.isAfter(today) || estimatedNext.isSame(today, 'day')) &&
          (estimatedNext.isBefore(cutoff) || estimatedNext.isSame(cutoff, 'day'))) {
        // Avoid duplicates with subscriptions
        const isDuplicate = bills.some(
          (b) => b.name.toLowerCase() === tx.description.toLowerCase() && Math.abs(b.amount - fromCentavos(tx.amount)) < 1
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

    // Sort by due date
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
      message: bills.length === 0
        ? `No upcoming bills in the next ${daysAhead} days.`
        : `${bills.length} upcoming bill(s) in the next ${daysAhead} days, totaling $${totalDue.toFixed(2)}.`,
    }
  },
})
