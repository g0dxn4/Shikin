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

import { listSubscriptionsSummary, getSubscriptionSpendingSummary } from '../insights.js'

type InvestmentRow = {
  id: string
  name: string
  symbol: string
  type: string
  shares: number
  avg_cost_basis: number
  currency: string
  account_id: string | null
  notes: string | null
}

type CreditCardBillRow = {
  name: string
  balance: number
  currency: string
  payment_due_day: number | null
}

type RecurringBillRow = {
  description: string
  amount: number
  currency: string
  date: string
  count: number
}

const manageInvestment: ToolDefinition = {
  name: 'manage-investment',
  description:
    'Add, update, or delete an investment holding. Use this to track stocks, ETFs, crypto, bonds, and other investments.',
  schema: z.object({
    action: z.enum(['add', 'update', 'delete']).describe('The action to perform'),
    investmentId: z.string().optional().describe('Required for update/delete. The investment ID.'),
    name: z.string().optional().describe('Investment name (e.g. "Apple Inc.")'),
    symbol: z.string().optional().describe('Ticker symbol (e.g. "AAPL")'),
    type: z
      .enum(['stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'other'])
      .optional()
      .describe('Investment type'),
    shares: z.number().optional().describe('Number of shares/units'),
    avgCost: z.number().optional().describe('Average cost basis per share in main currency unit'),
    currentPrice: z
      .number()
      .optional()
      .describe('Current price per share (will be saved to price history)'),
    currency: z.string().optional().default('USD').describe('Currency code'),
    accountId: z.string().optional().describe('Link to an account'),
    notes: z.string().optional().describe('Notes about the investment'),
  }),
  execute: async ({
    action,
    investmentId,
    name,
    symbol,
    type,
    shares,
    avgCost,
    currentPrice,
    currency,
    accountId,
    notes,
  }) => {
    if (action === 'add') {
      if (!name || !symbol) {
        return {
          success: false,
          message: 'Name and symbol are required when adding an investment.',
        }
      }

      const id = generateId()
      const avgCostCentavos = avgCost !== undefined ? toCentavos(avgCost) : 0

      await execute(
        `INSERT INTO investments (id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          accountId ?? null,
          symbol.toUpperCase(),
          name,
          type ?? 'stock',
          shares ?? 0,
          avgCostCentavos,
          currency,
          notes ?? null,
        ]
      )

      if (currentPrice !== undefined) {
        const priceId = generateId()
        const today = dayjs().format('YYYY-MM-DD')
        await execute(
          `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, date)
           VALUES ($1, $2, $3, $4, $5)`,
          [priceId, symbol.toUpperCase(), toCentavos(currentPrice), currency, today]
        )
      }

      return {
        success: true,
        investment: {
          id,
          name,
          symbol: symbol.toUpperCase(),
          type: type ?? 'stock',
          shares: shares ?? 0,
          avgCost: avgCost ?? 0,
        },
        message: `Added investment: ${name} (${symbol.toUpperCase()}) — ${shares ?? 0} shares at $${(avgCost ?? 0).toFixed(2)} avg cost.`,
      }
    }

    if (action === 'update') {
      if (!investmentId) {
        return { success: false, message: 'investmentId is required for update.' }
      }

      const existing = await query<InvestmentRow>('SELECT * FROM investments WHERE id = $1', [
        investmentId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Investment ${investmentId} not found.` }
      }

      const inv = existing[0]
      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (name !== undefined) {
        setClauses.push(`name = $${paramIdx++}`)
        params.push(name)
      }
      if (symbol !== undefined) {
        setClauses.push(`symbol = $${paramIdx++}`)
        params.push(symbol.toUpperCase())
      }
      if (type !== undefined) {
        setClauses.push(`type = $${paramIdx++}`)
        params.push(type)
      }
      if (shares !== undefined) {
        setClauses.push(`shares = $${paramIdx++}`)
        params.push(shares)
      }
      if (avgCost !== undefined) {
        setClauses.push(`avg_cost_basis = $${paramIdx++}`)
        params.push(toCentavos(avgCost))
      }
      if (currency !== undefined) {
        setClauses.push(`currency = $${paramIdx++}`)
        params.push(currency)
      }
      if (accountId !== undefined) {
        setClauses.push(`account_id = $${paramIdx++}`)
        params.push(accountId)
      }
      if (notes !== undefined) {
        setClauses.push(`notes = $${paramIdx++}`)
        params.push(notes)
      }

      if (setClauses.length === 0 && currentPrice === undefined) {
        return { success: false, message: 'No fields to update.' }
      }

      if (setClauses.length > 0) {
        setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
        params.push(investmentId)
        await execute(
          `UPDATE investments SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
          params
        )
      }

      if (currentPrice !== undefined) {
        const priceId = generateId()
        const today = dayjs().format('YYYY-MM-DD')
        const sym = symbol?.toUpperCase() ?? inv.symbol
        await execute(
          `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, date)
           VALUES ($1, $2, $3, $4, $5)`,
          [priceId, sym, toCentavos(currentPrice), currency ?? inv.currency, today]
        )
      }

      return {
        success: true,
        message: `Updated investment "${name ?? inv.name}".`,
      }
    }

    if (action === 'delete') {
      if (!investmentId) {
        return { success: false, message: 'investmentId is required for delete.' }
      }

      const existing = await query<InvestmentRow>('SELECT * FROM investments WHERE id = $1', [
        investmentId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Investment ${investmentId} not found.` }
      }

      await execute('DELETE FROM investments WHERE id = $1', [investmentId])

      return {
        success: true,
        message: `Deleted investment "${existing[0].name}" (${existing[0].symbol}).`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
}

// ---------------------------------------------------------------------------
// 22. get-upcoming-bills
// ---------------------------------------------------------------------------

const getUpcomingBills: ToolDefinition = {
  name: 'get-upcoming-bills',
  description:
    'Get upcoming bills from credit card due dates and recurring transactions. Returns a sorted list of bills due within the specified number of days.',
  schema: z.object({
    daysAhead: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .default(30)
      .describe('Number of days to look ahead (default: 30)'),
  }),
  execute: async ({ daysAhead }) => {
    const today = dayjs()
    const cutoff = today.add(daysAhead, 'day')
    const bills: Array<{
      name: string
      amount: number
      currency: string
      dueDate: string
      source: string
      daysUntilDue: number
    }> = []

    // Credit card payment due dates
    const creditCards = await query<CreditCardBillRow>(
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

    // Recurring transactions
    const recurringTx = await query<RecurringBillRow>(
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
      const lastDate = dayjs(tx.date)
      const estimatedNext = lastDate.add(30, 'day')
      if (
        (estimatedNext.isAfter(today) || estimatedNext.isSame(today, 'day')) &&
        (estimatedNext.isBefore(cutoff) || estimatedNext.isSame(cutoff, 'day'))
      ) {
        const isDuplicate = bills.some(
          (b) =>
            b.name.toLowerCase() === tx.description.toLowerCase() &&
            Math.abs(b.amount - fromCentavos(tx.amount)) < 1
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
      message:
        bills.length === 0
          ? `No upcoming bills in the next ${daysAhead} days.`
          : `${bills.length} upcoming bill(s) in the next ${daysAhead} days, totaling $${totalDue.toFixed(2)}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 23. list-subscriptions
// ---------------------------------------------------------------------------

const listSubscriptions: ToolDefinition = {
  name: 'list-subscriptions',
  description:
    'List subscriptions stored in Shikin. Shows amounts, billing cycles, next payment dates, and monthly/yearly cost equivalents.',
  schema: z.object({
    activeOnly: z
      .boolean()
      .optional()
      .default(true)
      .describe('Only show active subscriptions (default: true)'),
  }),
  execute: async ({ activeOnly }) => listSubscriptionsSummary(activeOnly),
}

// ---------------------------------------------------------------------------
// 24. get-subscription-spending
// ---------------------------------------------------------------------------

const getSubscriptionSpending: ToolDefinition = {
  name: 'get-subscription-spending',
  description:
    'Analyze subscription spending from Shikin data. Groups active subscriptions by category and billing cycle with monthly/yearly totals.',
  schema: z.object({}),
  execute: async () => getSubscriptionSpendingSummary(),
}

// ---------------------------------------------------------------------------
// 25. write-notebook
// ---------------------------------------------------------------------------

export const investmentsandsubscriptionsTools: ToolDefinition[] = [
  manageInvestment,
  getUpcomingBills,
  listSubscriptions,
  getSubscriptionSpending,
]
