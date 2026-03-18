import type { Money } from '@/types/common'

export interface Debt {
  id: string
  name: string
  balance: Money // centavos
  apr: number // percentage, e.g. 24.99
  minPayment: Money // centavos
}

export interface MonthlySnapshot {
  month: number
  balances: Record<string, Money> // debt id -> remaining balance in centavos
  payments: Record<string, Money> // debt id -> payment made in centavos
  interestCharged: Record<string, Money> // debt id -> interest in centavos
  totalBalance: Money
}

export interface PayoffPlan {
  strategy: 'snowball' | 'avalanche'
  months: number
  totalInterestPaid: Money // centavos
  totalPaid: Money // centavos
  schedule: MonthlySnapshot[]
  debtPayoffOrder: { id: string; name: string; paidOffMonth: number }[]
}

export interface StrategyComparison {
  snowball: PayoffPlan
  avalanche: PayoffPlan
  interestSaved: Money // centavos — how much avalanche saves over snowball
  monthsDifference: number
}

/**
 * Calculate a debt payoff plan using either snowball or avalanche strategy.
 *
 * Snowball: pay minimums on all debts, throw extra at the smallest balance.
 * Avalanche: pay minimums on all debts, throw extra at the highest APR.
 */
export function calculatePayoffPlan(
  debts: Debt[],
  strategy: 'snowball' | 'avalanche',
  extraPayment: Money = 0
): PayoffPlan {
  if (debts.length === 0) {
    return {
      strategy,
      months: 0,
      totalInterestPaid: 0,
      totalPaid: 0,
      schedule: [],
      debtPayoffOrder: [],
    }
  }

  // Working balances (mutable copy)
  const balances: Record<string, number> = {}
  for (const d of debts) {
    balances[d.id] = d.balance
  }

  const schedule: MonthlySnapshot[] = []
  const debtPayoffOrder: { id: string; name: string; paidOffMonth: number }[] = []
  let totalInterestPaid = 0
  let totalPaid = 0
  let month = 0
  const MAX_MONTHS = 600 // 50 years safety limit

  while (month < MAX_MONTHS) {
    const totalBalance = Object.values(balances).reduce((s, b) => s + b, 0)
    if (totalBalance <= 0) break

    month++
    const monthPayments: Record<string, number> = {}
    const monthInterest: Record<string, number> = {}

    // 1. Charge monthly interest on each debt
    for (const d of debts) {
      if (balances[d.id] <= 0) continue
      const monthlyRate = d.apr / 100 / 12
      const interest = Math.round(balances[d.id] * monthlyRate)
      balances[d.id] += interest
      monthInterest[d.id] = interest
      totalInterestPaid += interest
    }

    // 2. Pay minimums on all active debts
    let availableExtra = extraPayment
    for (const d of debts) {
      if (balances[d.id] <= 0) {
        monthPayments[d.id] = 0
        continue
      }
      const payment = Math.min(d.minPayment, balances[d.id])
      balances[d.id] -= payment
      monthPayments[d.id] = payment
      totalPaid += payment

      // If a debt was paid off with just the minimum, the freed minimum becomes extra
      if (balances[d.id] <= 0) {
        availableExtra += d.minPayment - payment
        balances[d.id] = 0
      }
    }

    // 3. Apply extra payment to target debt based on strategy
    const activeDebts = debts.filter((d) => balances[d.id] > 0)

    if (activeDebts.length > 0 && availableExtra > 0) {
      // Sort to find target
      const sorted = [...activeDebts].sort((a, b) => {
        if (strategy === 'snowball') {
          return balances[a.id] - balances[b.id] // smallest balance first
        }
        return b.apr - a.apr // highest APR first
      })

      // Throw extra at the target, cascade overflow to next
      let remaining = availableExtra
      for (const target of sorted) {
        if (remaining <= 0) break
        const payment = Math.min(remaining, balances[target.id])
        balances[target.id] -= payment
        monthPayments[target.id] = (monthPayments[target.id] ?? 0) + payment
        totalPaid += payment
        remaining -= payment
        if (balances[target.id] <= 0) {
          balances[target.id] = 0
        }
      }
    }

    // Record payoff events
    for (const d of debts) {
      if (
        balances[d.id] === 0 &&
        monthPayments[d.id] > 0 &&
        !debtPayoffOrder.find((p) => p.id === d.id)
      ) {
        debtPayoffOrder.push({ id: d.id, name: d.name, paidOffMonth: month })
      }
    }

    const snapshot: MonthlySnapshot = {
      month,
      balances: { ...balances },
      payments: monthPayments,
      interestCharged: monthInterest,
      totalBalance: Object.values(balances).reduce((s, b) => s + b, 0),
    }
    schedule.push(snapshot)

    if (snapshot.totalBalance <= 0) break
  }

  return {
    strategy,
    months: month,
    totalInterestPaid,
    totalPaid,
    schedule,
    debtPayoffOrder,
  }
}

/**
 * Compare snowball and avalanche strategies side-by-side.
 */
export function compareStrategies(
  debts: Debt[],
  extraPayment: Money = 0
): StrategyComparison {
  const snowball = calculatePayoffPlan(debts, 'snowball', extraPayment)
  const avalanche = calculatePayoffPlan(debts, 'avalanche', extraPayment)

  return {
    snowball,
    avalanche,
    interestSaved: snowball.totalInterestPaid - avalanche.totalInterestPaid,
    monthsDifference: snowball.months - avalanche.months,
  }
}
