import { query } from '@/lib/database'
import dayjs from 'dayjs'
import { isCashFlowEligible } from '@shikin/finance-core'
import { useCurrencyStore } from '@/stores/currency-store'
import type { Account, Transaction } from '@/types/database'

/** A single point in the cash flow forecast */
export interface ForecastPoint {
  date: string
  projected: number
  optimistic: number
  pessimistic: number
}

/** Full forecast result */
export interface CashFlowForecast {
  complete: boolean
  currency: string
  missingCurrencies: string[]
  points: ForecastPoint[]
  currentBalance: number
  dailyBurnRate: number
  dailyIncome: number
  minBalance: { date: string; amount: number }
  dangerDates: string[]
}

interface DailyAggregate extends Pick<
  Transaction,
  | 'type'
  | 'status'
  | 'ledger_treatment'
  | 'reporting_treatment'
  | 'transaction_kind'
  | 'is_archived'
  | 'currency'
> {
  amount: number
}

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
  const params = scope.accountId ? [scope.accountId] : []
  const accounts = await query<Account>(
    `SELECT * FROM accounts WHERE is_archived = 0${scope.accountId ? ' AND id = ?' : ''}`,
    params
  )

  const ninetyDaysAgo = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  // Group only identical eligibility/currency dimensions, then use the canonical helper.
  const dailyAverages = await query<DailyAggregate>(
    `SELECT t.type, t.currency, t.status, t.ledger_treatment, t.reporting_treatment, t.transaction_kind, t.is_archived,
            SUM(t.amount) AS amount
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.date >= ? AND t.date <= ? AND a.is_archived = 0
       ${scope.accountId ? 'AND t.account_id = ?' : ''}
     GROUP BY t.type, t.currency, t.status, t.ledger_treatment, t.reporting_treatment, t.transaction_kind, t.is_archived`,
    [ninetyDaysAgo, today, ...params]
  )
  // 3. Factor in subscriptions as additional known expenses
  const subscriptions = await query<SubscriptionRow>(
    `SELECT s.amount, s.currency, s.billing_cycle FROM subscriptions s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.is_active = 1 AND (s.account_id IS NULL OR a.is_archived = 0)${scope.accountId ? ' AND s.account_id = ?' : ''}`,
    params
  )

  // Snapshot conversion preferences for this read; never mix currencies or publish partial totals.
  const { convertToPreferred, preferredCurrency } = useCurrencyStore.getState()
  const missingCurrencies = new Set<string>()
  let complete = true
  const convert = (amount: number, currency: string) => {
    const result = convertToPreferred(amount, currency)
    if (result.complete) return result.amountCentavos
    complete = false
    result.missingCurrencies.forEach((code) => missingCurrencies.add(code))
    if (!result.missingCurrencies.length) missingCurrencies.add(currency || '?')
    return 0
  }
  const currentBalance = accounts.reduce(
    (sum, account) => sum + convert(account.balance, account.currency),
    0
  )
  let avgDailyExpense = 0
  let avgDailyIncome = 0
  for (const row of dailyAverages) {
    if (
      !isCashFlowEligible({
        type: row.type,
        status: row.status,
        ledgerTreatment: row.ledger_treatment,
        reportingTreatment: row.reporting_treatment,
        transactionKind: row.transaction_kind,
        isArchived: row.is_archived,
      })
    )
      continue
    const daily = convert(row.amount, row.currency) / 90
    if (row.type === 'expense') avgDailyExpense += daily
    if (row.type === 'income') avgDailyIncome += daily
  }

  let dailySubscriptionCost = 0
  for (const sub of subscriptions) {
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
    complete,
    currency: preferredCurrency,
    missingCurrencies: [...missingCurrencies].sort(),
    points: complete ? points : [],
    currentBalance,
    dailyBurnRate: Math.round(effectiveDailyExpense),
    dailyIncome: Math.round(avgDailyIncome),
    minBalance,
    dangerDates,
  }
}
