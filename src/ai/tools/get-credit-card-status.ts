import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import type { Account } from '@/types/database'
import dayjs from 'dayjs'

function nextDateForDay(day: number): string {
  const today = dayjs()
  const thisMonth = today.date(Math.min(day, today.daysInMonth()))
  if (thisMonth.isAfter(today) || thisMonth.isSame(today, 'day')) {
    return thisMonth.format('YYYY-MM-DD')
  }
  const nextMonth = today.add(1, 'month')
  return nextMonth.date(Math.min(day, nextMonth.daysInMonth())).format('YYYY-MM-DD')
}

export const getCreditCardStatus = tool({
  description:
    'Get credit card status including balance, credit limit, available credit, utilization, and upcoming dates. If no accountId is provided, returns status for all credit cards.',
  inputSchema: zodSchema(
    z.object({
      accountId: z
        .string()
        .optional()
        .describe('Specific credit card account ID. Omit to get all credit cards.'),
    })
  ),
  execute: async ({ accountId }) => {
    let cards: Account[]

    if (accountId) {
      cards = await query<Account>(
        "SELECT * FROM accounts WHERE id = $1 AND type = 'credit_card' AND is_archived = 0",
        [accountId]
      )
      if (cards.length === 0) {
        return { success: false, message: `Credit card ${accountId} not found.` }
      }
    } else {
      cards = await query<Account>(
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
        nextClosingDate: card.statement_closing_day ? nextDateForDay(card.statement_closing_day) : null,
        nextPaymentDueDate: card.payment_due_day ? nextDateForDay(card.payment_due_day) : null,
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
})
