import { readCurrentAmounts } from '../dated-read.js'
import {
  z,
  query,
  toCentavos,
  fromCentavos,
  dayjs,
  normalizeCurrencyCode,
  type ToolDefinition,
} from './shared.js'
import { CASH_FLOW_SQL } from '@shikin/finance-core'
import { getCreditCardBillEntries, type CreditCardBillEntry } from '../statement-read.js'

type RecurringBillRow = {
  description: string
  amount: number
  currency: string
  date: string
  count: number
}

type UpcomingBillEntry = {
  name: string
  amount: number
  currency: string
  dueDate: string
  source: string
  daysUntilDue: number
}

// ---------------------------------------------------------------------------
// 22. get-upcoming-bills
// ---------------------------------------------------------------------------
export const getUpcomingBills: ToolDefinition = {
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
    const bills: Array<CreditCardBillEntry | UpcomingBillEntry> = []

    bills.push(...getCreditCardBillEntries(daysAhead))

    // Recurring transactions
    const recurringTx = await query<RecurringBillRow>(
      `SELECT t.description, t.amount, UPPER(TRIM(t.currency)) AS currency,
              MAX(t.date) as date, COUNT(*) as count
       FROM transactions t
       WHERE t.is_recurring = 1 AND t.type = 'expense'
         AND t.date >= $1 AND ${CASH_FLOW_SQL}
       GROUP BY t.description, t.amount, UPPER(TRIM(t.currency))
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
            normalizeCurrencyCode(b.currency) === normalizeCurrencyCode(tx.currency) &&
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

    const totals = new Map<string, number>()
    for (const bill of bills) {
      const currency = normalizeCurrencyCode(bill.currency) || bill.currency.trim().toUpperCase()
      totals.set(currency, (totals.get(currency) ?? 0) + bill.amount)
    }
    const totalsByCurrency = [...totals.entries()]
      .map(([currency, totalAmount]) => ({
        currency,
        totalAmount: Math.round(totalAmount * 100) / 100,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
    const totalAmount =
      totalsByCurrency.length <= 1 ? (totalsByCurrency[0]?.totalAmount ?? 0) : null

    return {
      success: true,
      bills,
      mainConversion: {
        ...readCurrentAmounts(
          bills.map((bill, index) => ({
            id: `${bill.source}:${index}`,
            amountCentavos: toCentavos(bill.amount),
            currency: bill.currency,
          }))
        ),
        policy: 'planning_estimate_today',
      },
      summary: {
        count: bills.length,
        totalAmount,
        totalsByCurrency,
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
          : totalsByCurrency.length === 1
            ? `${bills.length} upcoming bill(s) in the next ${daysAhead} days, totaling ${totalsByCurrency[0].totalAmount.toFixed(2)} ${totalsByCurrency[0].currency}.`
            : `${bills.length} upcoming bill(s) in the next ${daysAhead} days across ${totalsByCurrency.length} currencies (${totalsByCurrency.map((total) => `${total.currency} ${total.totalAmount.toFixed(2)}`).join(', ')}); no FX conversion was applied.`,
    }
  },
}
