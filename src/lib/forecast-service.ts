import { query } from '@/lib/database'
import dayjs from 'dayjs'

/** A single point in the cash flow forecast */
export interface ForecastPoint {
  date: string
  projected: number
  optimistic: number
  pessimistic: number
}

/** Full forecast result */
export interface CashFlowForecast {
  points: ForecastPoint[]
  currentBalance: number
  dailyBurnRate: number
  dailyIncome: number
  minBalance: { date: string; amount: number }
  dangerDates: string[]
}

interface DailyAggregate {
  type: string
  avg_daily: number
}

interface SubscriptionRow {
  amount: number
  billing_cycle: string
  is_active: number
}

/**
 * Generate a cash flow forecast by projecting daily balances forward.
 *
 * Algorithm:
 * 1. Get current total balance across all active accounts
 * 2. Estimate average daily income and expenses from last 90 days of transactions
 * 3. Factor in active subscriptions as known future expenses
 * 4. Project day-by-day: balance + expected_income - expected_expenses
 * 5. Optimistic scenario: 80% of avg expenses, Pessimistic: 120%
 */
export async function generateCashFlowForecast(
  days: number = 30,
  dangerThreshold: number = 0
): Promise<CashFlowForecast> {
  // 1. Current total balance across all non-archived accounts
  const balanceResult = await query<{ total: number }>(
    `SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE is_archived = 0`
  )
  const currentBalance = balanceResult[0]?.total ?? 0

  // 2. Get average daily income and expenses from last 90 days
  const ninetyDaysAgo = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')

  const dailyAverages = await query<DailyAggregate>(
    `SELECT type, CAST(SUM(amount) AS REAL) / 90.0 as avg_daily
     FROM transactions
     WHERE date >= ? AND date <= ? AND type IN ('expense', 'income')
     GROUP BY type`,
    [ninetyDaysAgo, today]
  )

  let avgDailyExpense = 0
  let avgDailyIncome = 0
  for (const row of dailyAverages) {
    if (row.type === 'expense') avgDailyExpense = row.avg_daily
    if (row.type === 'income') avgDailyIncome = row.avg_daily
  }

  // 3. Factor in subscriptions as additional known expenses
  const subscriptions = await query<SubscriptionRow>(
    `SELECT amount, billing_cycle, is_active FROM subscriptions WHERE is_active = 1`
  )

  let dailySubscriptionCost = 0
  for (const sub of subscriptions) {
    switch (sub.billing_cycle) {
      case 'weekly':
        dailySubscriptionCost += sub.amount / 7
        break
      case 'monthly':
        dailySubscriptionCost += sub.amount / 30
        break
      case 'quarterly':
        dailySubscriptionCost += sub.amount / 90
        break
      case 'yearly':
        dailySubscriptionCost += sub.amount / 365
        break
    }
  }

  // Combine: average expenses already include subscription payments from history,
  // so we don't double-count. Use the max of historical average or subscription baseline.
  const effectiveDailyExpense = Math.max(avgDailyExpense, dailySubscriptionCost)

  // 4. Project forward day-by-day
  const dailyNet = avgDailyIncome - effectiveDailyExpense
  const optimisticDailyNet = avgDailyIncome - effectiveDailyExpense * 0.8
  const pessimisticDailyNet = avgDailyIncome - effectiveDailyExpense * 1.2

  const points: ForecastPoint[] = []
  let runningProjected = currentBalance
  let runningOptimistic = currentBalance
  let runningPessimistic = currentBalance
  let minBalance = { date: '', amount: currentBalance }
  const dangerDates: string[] = []

  for (let i = 0; i <= days; i++) {
    const date = dayjs().add(i, 'day').format('YYYY-MM-DD')

    if (i > 0) {
      runningProjected += dailyNet
      runningOptimistic += optimisticDailyNet
      runningPessimistic += pessimisticDailyNet
    }

    points.push({
      date,
      projected: Math.round(runningProjected),
      optimistic: Math.round(runningOptimistic),
      pessimistic: Math.round(runningPessimistic),
    })

    if (runningProjected < minBalance.amount) {
      minBalance = { date, amount: Math.round(runningProjected) }
    }

    if (runningProjected < dangerThreshold) {
      dangerDates.push(date)
    }
  }

  return {
    points,
    currentBalance,
    dailyBurnRate: Math.round(effectiveDailyExpense),
    dailyIncome: Math.round(avgDailyIncome),
    minBalance,
    dangerDates,
  }
}
