import { query } from '@/lib/database'
import dayjs from 'dayjs'
import { convertCentavosAsOf } from '@shikin/finance-core/fx'
import {
  captureReportingContext,
  assertReportingContextCurrent,
  convertReportingAmount,
  readGrossProjection,
  sumReportingAmounts,
  type GrossProjection,
  type ReportingContext,
} from '@/lib/dated-reporting-read'
import type { Account } from '@/types/database'

/** A single point in the cash flow forecast */
export interface ForecastPoint {
  date: string
  projected: number
  optimistic: number
  pessimistic: number
}

/** Full forecast result */
export type CashFlowForecast = {
  currency: string
  missingCurrencies: string[]
  points: ForecastPoint[]
  dangerDates: string[]
  authority: ReportingContext
  estimateAsOf: string
  evidence: GrossProjection
  nativeBalances: Array<{ currency: string; amountCentavos: number }>
} & (
  | {
      complete: true
      currentBalance: number
      dailyBurnRate: number
      dailyIncome: number
      minBalance: { date: string; amount: number }
    }
  | {
      complete: false
      currentBalance: null
      dailyBurnRate: null
      dailyIncome: null
      minBalance: { date: string; amount: null }
    }
)

interface SubscriptionRow {
  amount: number
  currency: string
  billing_cycle: string
}

export interface ForecastScope {
  accountId?: string
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
  dangerThreshold: number = 0,
  scope: ForecastScope = {}
): Promise<CashFlowForecast> {
  const context = captureReportingContext()
  const params = scope.accountId ? [scope.accountId] : []
  const accounts = await query<Account>(
    `SELECT * FROM accounts WHERE is_archived = 0${scope.accountId ? ' AND id = ?' : ''}`,
    params
  )

  const ninetyDaysAgo = dayjs(context.today).subtract(90, 'day').format('YYYY-MM-DD')
  const today = context.today
  const history = await readGrossProjection(ninetyDaysAgo, today, context, {
    accountId: scope.accountId,
    activeAccountsOnly: true,
  })
  // 3. Factor in subscriptions as additional known expenses
  const subscriptions = await query<SubscriptionRow>(
    `SELECT s.amount, s.currency, s.billing_cycle FROM subscriptions s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.is_active = 1 AND (s.account_id IS NULL OR a.is_archived = 0)${scope.accountId ? ' AND s.account_id = ?' : ''}`,
    params
  )

  const missingCurrencies = new Set(history.missingCurrencies)
  let complete = history.complete
  const convert = (amount: number, currency: string) => {
    try {
      const result = convertReportingAmount(context, amount, currency)
      if (result?.complete) return result.amountCentavos
    } catch {
      /* Invalid source evidence is unavailable, not a zero-valued stock. */
    }
    complete = false
    missingCurrencies.add(currency || '?')
    return 0
  }
  const nativeBalances: Array<{ currency: string; amountCentavos: number }> = []
  for (const account of accounts) {
    try {
      const currency = account.currency.trim().toUpperCase()
      const native = convertCentavosAsOf({
        amountCentavos: account.balance,
        fromCurrency: currency,
        toCurrency: currency,
        asOfDate: context.today,
        rates: [],
      })
      if (native.complete) nativeBalances.push({ currency, amountCentavos: native.amountCentavos })
    } catch {
      complete = false
    }
  }
  const currentBalance = sumReportingAmounts(
    accounts.map((account) => convert(account.balance, account.currency))
  )
  const avgDailyExpense =
    sumReportingAmounts(
      history.parents.filter((row) => row.type === 'expense').map((row) => row.convertedAmount ?? 0)
    ) / 90
  const avgDailyIncome =
    sumReportingAmounts(
      history.parents.filter((row) => row.type === 'income').map((row) => row.convertedAmount ?? 0)
    ) / 90

  let dailySubscriptionCost = 0
  for (const sub of subscriptions) {
    if (sub.amount < 0) {
      complete = false
      continue
    }
    const amount = convert(sub.amount, sub.currency)
    switch (sub.billing_cycle) {
      case 'weekly':
        dailySubscriptionCost += amount / 7
        break
      case 'monthly':
        dailySubscriptionCost += amount / 30
        break
      case 'quarterly':
        dailySubscriptionCost += amount / 90
        break
      case 'yearly':
        dailySubscriptionCost += amount / 365
        break
      default:
        complete = false
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
  let minBalance = { date: today, amount: currentBalance }
  const dangerDates: string[] = []

  for (let i = 0; i <= days; i++) {
    const date = dayjs(today).add(i, 'day').format('YYYY-MM-DD')

    if (i > 0) {
      runningProjected += dailyNet
      runningOptimistic += optimisticDailyNet
      runningPessimistic += pessimisticDailyNet
    }

    if (
      ![runningProjected, runningOptimistic, runningPessimistic].every((value) =>
        Number.isSafeInteger(Math.round(value))
      )
    )
      complete = false

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

  assertReportingContextCurrent(context)
  const shared = {
    authority: context,
    currency: context.mainCurrency ?? '',
    missingCurrencies: [...missingCurrencies].sort(),
    estimateAsOf: context.today,
    evidence: history,
    nativeBalances,
  }
  if (!complete)
    return {
      ...shared,
      complete: false,
      points: [],
      currentBalance: null,
      dailyBurnRate: null,
      dailyIncome: null,
      minBalance: { date: today, amount: null },
      dangerDates: [],
    }
  return {
    ...shared,
    complete: true,
    points,
    currentBalance,
    dailyBurnRate: Math.round(effectiveDailyExpense),
    dailyIncome: Math.round(avgDailyIncome),
    minBalance,
    dangerDates,
  }
}
