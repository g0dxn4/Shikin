import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { query } from '@/lib/database'
import { fromCentavos } from '@/lib/money'
import { calculatePayoffPlan, compareStrategies } from '@/lib/debt-service'
import type { Debt } from '@/lib/debt-service'
import type { Account } from '@/types/database'

export const getDebtPayoffPlan = tool({
  description:
    'Calculate a debt payoff plan using snowball or avalanche strategy. Returns payoff timeline, total interest, and monthly schedule summary. Pulls credit card debts from accounts automatically.',
  inputSchema: zodSchema(
    z.object({
      strategy: z
        .enum(['snowball', 'avalanche'])
        .optional()
        .default('avalanche')
        .describe(
          'Payoff strategy. Avalanche = highest APR first (saves most interest). Snowball = smallest balance first (psychological wins).'
        ),
      extraPayment: z
        .number()
        .optional()
        .default(0)
        .describe('Extra monthly payment in dollars (on top of minimums). E.g. 200 for $200/month extra.'),
    })
  ),
  execute: async ({ strategy, extraPayment }) => {
    // Pull credit card accounts with negative balances
    const accounts = await query<Account>(
      `SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 AND balance < 0`
    )

    if (accounts.length === 0) {
      return {
        success: true,
        message: 'No credit card debts found. All credit card balances are zero or positive.',
        debts: [],
      }
    }

    const debts: Debt[] = accounts.map((a) => ({
      id: a.id,
      name: a.name,
      balance: Math.abs(a.balance),
      apr: 0, // Default APR — user should configure this
      minPayment: Math.max(Math.round(Math.abs(a.balance) * 0.02), 2500),
    }))

    const extraCentavos = Math.round((extraPayment ?? 0) * 100)
    const plan = calculatePayoffPlan(debts, strategy ?? 'avalanche', extraCentavos)
    const comparison = compareStrategies(debts, extraCentavos)

    const debtSummaries = debts.map((d) => ({
      name: d.name,
      balance: fromCentavos(d.balance),
      apr: d.apr,
      minPayment: fromCentavos(d.minPayment),
    }))

    return {
      success: true,
      strategy: plan.strategy,
      debts: debtSummaries,
      totalDebt: fromCentavos(debts.reduce((s, d) => s + d.balance, 0)),
      monthsToPayoff: plan.months,
      totalInterestPaid: fromCentavos(plan.totalInterestPaid),
      totalPaid: fromCentavos(plan.totalPaid),
      extraMonthlyPayment: extraPayment ?? 0,
      payoffOrder: plan.debtPayoffOrder.map((d) => ({
        name: d.name,
        paidOffInMonth: d.paidOffMonth,
      })),
      comparison: {
        avalancheMonths: comparison.avalanche.months,
        avalancheInterest: fromCentavos(comparison.avalanche.totalInterestPaid),
        snowballMonths: comparison.snowball.months,
        snowballInterest: fromCentavos(comparison.snowball.totalInterestPaid),
        interestSaved: fromCentavos(comparison.interestSaved),
      },
      message: `${plan.strategy} strategy: ${plan.months} months to pay off $${fromCentavos(debts.reduce((s, d) => s + d.balance, 0)).toFixed(2)} in debt. Total interest: $${fromCentavos(plan.totalInterestPaid).toFixed(2)}.${extraPayment ? ` With $${extraPayment}/month extra payment.` : ''}`,
    }
  },
})
