import { z, query, fromCentavos, type ToolDefinition } from './shared.js'

type DebtAccountRow = {
  id: string
  name: string
  balance: number
}

type DebtPlanRow = {
  id: string
  name: string
  balance: number
  apr: number
  minPayment: number
}

const getDebtPayoffPlan: ToolDefinition = {
  name: 'get-debt-payoff-plan',
  description:
    'Calculate a debt payoff plan using snowball or avalanche strategy. Pulls credit card debts from accounts automatically; MVP projections use 0% APR because accounts do not store APR yet.',
  schema: z.object({
    strategy: z
      .enum(['snowball', 'avalanche'])
      .optional()
      .default('avalanche')
      .describe(
        'Payoff strategy. Avalanche uses highest APR first when APR data exists; in this MVP accounts do not store APR, so avalanche falls back to smallest balance first. Snowball = smallest balance first.'
      ),
    extraPayment: z
      .number()
      .optional()
      .default(0)
      .describe('Extra monthly payment in dollars on top of minimums.'),
  }),
  execute: async ({ strategy, extraPayment }) => {
    const accounts = await query<DebtAccountRow>(
      `SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 AND balance < 0`
    )

    if (accounts.length === 0) {
      return {
        success: true,
        message: 'No credit card debts found. All credit card balances are zero or positive.',
        debts: [],
      }
    }

    const debts: DebtPlanRow[] = accounts.map((a) => ({
      id: a.id,
      name: a.name,
      balance: Math.abs(a.balance),
      apr: 0, // MVP: accounts have no APR column, so CLI projections exclude interest.
      minPayment: Math.max(Math.round(Math.abs(a.balance) * 0.02), 2500), // 2% or $25 min
    }))

    // Sort based on strategy
    const sorted = [...debts].sort((a, b) => {
      if ((strategy ?? 'avalanche') === 'avalanche') {
        return b.apr - a.apr || a.balance - b.balance
      }
      return a.balance - b.balance
    })

    const totalDebt = debts.reduce((s, d) => s + d.balance, 0)
    const totalMinPayment = debts.reduce((s, d) => s + d.minPayment, 0)
    const extraCentavos = Math.round((extraPayment ?? 0) * 100)
    const monthlyPayment = totalMinPayment + extraCentavos

    // Simple estimate: total / monthly (no interest since APR defaults to 0)
    const months = monthlyPayment > 0 ? Math.ceil(totalDebt / monthlyPayment) : 0

    return {
      success: true,
      strategy: strategy ?? 'avalanche',
      debts: debts.map((d) => ({
        name: d.name,
        balance: fromCentavos(d.balance),
        apr: d.apr,
        minPayment: fromCentavos(d.minPayment),
      })),
      totalDebt: fromCentavos(totalDebt),
      monthsToPayoff: months,
      totalMinimumPayment: fromCentavos(totalMinPayment),
      extraMonthlyPayment: extraPayment ?? 0,
      payoffOrder: sorted.map((d) => d.name),
      message: `${strategy ?? 'avalanche'} strategy: ~${months} months to pay off $${fromCentavos(totalDebt).toFixed(2)} in debt.${extraPayment ? ` With $${extraPayment}/month extra payment.` : ''} MVP limitation: APR defaults to 0% because accounts do not store APR yet, so interest is excluded from this estimate.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 39. get-debt-payoff-plan
// ---------------------------------------------------------------------------

export const debtTools: ToolDefinition[] = [getDebtPayoffPlan]
