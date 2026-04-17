import {
  dayjs,
  query,
  uniqueCurrencies,
  getDailySubscriptionCost,
  buildCashFlowForecast,
  type SubscriptionBillingCycle,
} from './shared.js'

export async function generateCashFlowForecastSummary(days: number) {
  const boundedDays = Math.max(1, Math.min(90, Math.round(days)))
  const currentBalances = query<{ currency: string; total: number }>(
    `SELECT currency, COALESCE(SUM(balance), 0) AS total
     FROM accounts
     WHERE is_archived = 0 AND type IN ('checking', 'savings', 'cash')
     GROUP BY currency`
  )

  const ninetyDaysAgo = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  const dailyAverages = query<{ currency: string; type: string; avg_daily: number }>(
    `SELECT currency, type, CAST(SUM(amount) AS REAL) / 90.0 AS avg_daily
     FROM transactions
     WHERE date >= $1 AND date <= $2 AND type IN ('expense', 'income')
     GROUP BY currency, type`,
    [ninetyDaysAgo, today]
  )

  const subscriptions = query<{
    currency: string
    amount: number
    billing_cycle: SubscriptionBillingCycle
  }>('SELECT amount, currency, billing_cycle FROM subscriptions WHERE is_active = 1')

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
    forecast: null,
    forecastsByCurrency,
    message:
      currenciesWithDanger.length > 0
        ? `Projected balances turn negative within ${boundedDays} days for ${currenciesWithDanger.join(', ')}. See forecastsByCurrency for per-currency projections; no FX conversion was applied.`
        : `Generated ${boundedDays}-day cash-flow forecast across ${forecastsByCurrency.length} currencies. See forecastsByCurrency for per-currency projections; no FX conversion was applied.`,
  }
}
