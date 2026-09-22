import {
  dayjs,
  query,
  readSubscriptionEstimate,
  uniqueCurrencies,
  getDailySubscriptionCost,
  buildCashFlowForecast,
  type SubscriptionBillingCycle,
} from './shared.js'
import { readCurrentAmounts } from '../dated-read.js'
import { CASH_FLOW_SQL, reportingReadFailure, readConvertedCashFlow } from '../reporting-read.js'

export async function generateCashFlowForecastSummary(days: number) {
  const boundedDays = Math.max(1, Math.min(90, Math.round(days)))
  const currentBalances = query<{ currency: string; total: number }>(
    `SELECT UPPER(TRIM(currency)) AS currency, COALESCE(SUM(balance), 0) AS total
     FROM accounts
     WHERE is_archived = 0 AND type IN ('checking', 'savings', 'cash')
     GROUP BY UPPER(TRIM(currency))`
  )

  const ninetyDaysAgo = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  const failure = reportingReadFailure(ninetyDaysAgo, today)
  if (failure) return { ...failure, forecast: null, forecastsByCurrency: [] }

  const dailyAverages = query<{ currency: string; type: string; avg_daily: number }>(
    `SELECT UPPER(TRIM(t.currency)) AS currency, t.type,
            CAST(SUM(t.amount) AS REAL) / 90.0 AS avg_daily
     FROM transactions t
     WHERE t.date >= $1 AND t.date <= $2 AND ${CASH_FLOW_SQL}
     GROUP BY UPPER(TRIM(t.currency)), t.type`,
    [ninetyDaysAgo, today]
  )

  const subscriptions = query<{
    id: string
    currency: string
    amount: number
    billing_cycle: SubscriptionBillingCycle
  }>(
    'SELECT id, amount, UPPER(TRIM(currency)) AS currency, billing_cycle FROM subscriptions WHERE is_active = 1'
  )

  const balances = readCurrentAmounts(
    query<{ id: string; currency: string; amountCentavos: number }>(
      `SELECT id, UPPER(TRIM(currency)) AS currency, balance AS amountCentavos
     FROM accounts WHERE is_archived = 0 AND type IN ('checking', 'savings', 'cash')`
    )
  )
  const realized = readConvertedCashFlow(ninetyDaysAgo, today, balances.toCurrency)
  const plannedSubscriptions = readSubscriptionEstimate(subscriptions)
  const mainComplete =
    balances.complete && realized.success && realized.complete && plannedSubscriptions.complete
  const mainConversion = {
    complete: mainComplete,
    toCurrency: balances.toCurrency,
    asOfDate: today,
    policy: 'planning_estimate_today_with_dated_realized_inputs' as const,
    basis: 'gross_cashflow' as const,
    reason: balances.reason ?? realized.reason ?? plannedSubscriptions.reason,
    balances,
    realized,
    subscriptions: plannedSubscriptions,
    forecast:
      mainComplete && realized.success
        ? buildCashFlowForecast(
            balances.totalCentavos!,
            realized.incomeCentavos! / 90,
            realized.expenseCentavos! / 90,
            plannedSubscriptions.dailyCostCentavos!,
            boundedDays
          )
        : null,
  }

  const currencies = uniqueCurrencies(currentBalances, dailyAverages, subscriptions)
  const balanceByCurrency = new Map(currentBalances.map((row) => [row.currency, row.total]))
  const averageByCurrency = new Map<string, { income: number; expense: number }>()
  for (const row of dailyAverages) {
    const current = averageByCurrency.get(row.currency) ?? { income: 0, expense: 0 }
    if (row.type === 'expense') current.expense = row.avg_daily
    if (row.type === 'income') current.income = row.avg_daily
    averageByCurrency.set(row.currency, current)
  }
  const subscriptionCostByCurrency = new Map<string, number>()
  for (const subscription of subscriptions) {
    subscriptionCostByCurrency.set(
      subscription.currency,
      (subscriptionCostByCurrency.get(subscription.currency) ?? 0) +
        getDailySubscriptionCost(subscription.amount, subscription.billing_cycle)
    )
  }

  if (currencies.length <= 1) {
    const currency = currencies[0] ?? 'USD'
    const current = averageByCurrency.get(currency) ?? { income: 0, expense: 0 }
    const forecast = buildCashFlowForecast(
      balanceByCurrency.get(currency) ?? 0,
      current.income,
      current.expense,
      subscriptionCostByCurrency.get(currency) ?? 0,
      boundedDays
    )

    return {
      success: true,
      mainConversion,
      forecast,
      message:
        forecast.dangerDates.length > 0
          ? `Projected balance turns negative within ${boundedDays} days.`
          : `Generated ${boundedDays}-day cash-flow forecast.`,
    }
  }

  const forecastsByCurrency = currencies.map((currency) => {
    const current = averageByCurrency.get(currency) ?? { income: 0, expense: 0 }
    return {
      currency,
      ...buildCashFlowForecast(
        balanceByCurrency.get(currency) ?? 0,
        current.income,
        current.expense,
        subscriptionCostByCurrency.get(currency) ?? 0,
        boundedDays
      ),
    }
  })
  const currenciesWithDanger = forecastsByCurrency
    .filter((forecast) => forecast.dangerDates.length > 0)
    .map((forecast) => forecast.currency)

  return {
    success: true,
    mainConversion,
    forecast: null,
    forecastsByCurrency,
    message:
      currenciesWithDanger.length > 0
        ? `Projected balances turn negative within ${boundedDays} days for ${currenciesWithDanger.join(', ')}. See forecastsByCurrency for per-currency projections; no FX conversion was applied.`
        : `Generated ${boundedDays}-day cash-flow forecast across ${forecastsByCurrency.length} currencies. See forecastsByCurrency for per-currency projections; no FX conversion was applied.`,
  }
}
