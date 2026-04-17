import {
  query,
  UNCATEGORIZED,
  toDisplayAmount,
  summarizeCurrencyTotals,
  subscriptionEquivalentAmounts,
  type SubscriptionBillingCycle,
  type SubscriptionRow,
} from './shared.js'

export async function listSubscriptionsSummary(activeOnly: boolean) {
  const rows = query<SubscriptionRow>(
    `SELECT s.id, s.name, s.amount, s.currency, s.billing_cycle, s.next_billing_date, s.is_active,
            c.name AS category_name, a.name AS account_name
     FROM subscriptions s
     LEFT JOIN categories c ON s.category_id = c.id
     LEFT JOIN accounts a ON s.account_id = a.id
     ${activeOnly ? 'WHERE s.is_active = 1' : ''}
     ORDER BY s.next_billing_date ASC, s.name ASC`
  )

  const subscriptions = rows.map((row) => {
    const { monthlyAmount, yearlyAmount } = subscriptionEquivalentAmounts(
      row.amount,
      row.billing_cycle
    )
    return {
      id: row.id,
      name: row.name,
      amount: toDisplayAmount(row.amount),
      currency: row.currency,
      billingCycle: row.billing_cycle,
      nextBillingDate: row.next_billing_date,
      isActive: row.is_active === 1,
      category: row.category_name ?? UNCATEGORIZED,
      account: row.account_name,
      monthlyAmount,
      yearlyAmount,
    }
  })

  const currencyTotals = summarizeCurrencyTotals(subscriptions)

  return {
    success: true,
    subscriptions,
    summary: {
      count: subscriptions.length,
      activeCount: subscriptions.filter((row) => row.isActive).length,
      inactiveCount: subscriptions.filter((row) => !row.isActive).length,
      monthlyTotal: currencyTotals.monthlyTotal,
      yearlyTotal: currencyTotals.yearlyTotal,
      totalsByCurrency: currencyTotals.totalsByCurrency,
    },
    message:
      subscriptions.length === 0
        ? 'No subscriptions found.'
        : currencyTotals.isSingleCurrency &&
            currencyTotals.monthlyTotal !== null &&
            currencyTotals.yearlyTotal !== null
          ? `${subscriptions.length} subscription(s), about ${currencyTotals.singleCurrency} ${currencyTotals.monthlyTotal.toFixed(2)} per month and ${currencyTotals.singleCurrency} ${currencyTotals.yearlyTotal.toFixed(2)} per year.`
          : `${subscriptions.length} subscription(s) across ${currencyTotals.totalsByCurrency.length} currencies. See totalsByCurrency for exact monthly and yearly breakdowns.`,
  }
}

export async function getSubscriptionSpendingSummary() {
  const rows = query<SubscriptionRow>(
    `SELECT s.id, s.name, s.amount, s.currency, s.billing_cycle, s.next_billing_date, s.is_active,
            c.name AS category_name, a.name AS account_name
     FROM subscriptions s
     LEFT JOIN categories c ON s.category_id = c.id
     LEFT JOIN accounts a ON s.account_id = a.id
     WHERE s.is_active = 1
     ORDER BY s.name ASC`
  )

  const categoryMap = new Map<
    string,
    { currency: string; count: number; monthlyTotal: number; yearlyTotal: number }
  >()
  const cycleMap = new Map<
    string,
    {
      currency: string
      billingCycle: SubscriptionBillingCycle
      count: number
      monthlyTotal: number
    }
  >()

  for (const row of rows) {
    const category = row.category_name ?? UNCATEGORIZED
    const { monthlyAmount, yearlyAmount } = subscriptionEquivalentAmounts(
      row.amount,
      row.billing_cycle
    )
    const categoryKey = `${row.currency}:${category}`
    const cycleKey = `${row.currency}:${row.billing_cycle}`

    const categoryTotals = categoryMap.get(categoryKey) ?? {
      currency: row.currency,
      count: 0,
      monthlyTotal: 0,
      yearlyTotal: 0,
    }
    categoryTotals.count += 1
    categoryTotals.monthlyTotal += monthlyAmount
    categoryTotals.yearlyTotal += yearlyAmount
    categoryMap.set(categoryKey, categoryTotals)

    const cycleTotals = cycleMap.get(cycleKey) ?? {
      currency: row.currency,
      billingCycle: row.billing_cycle,
      count: 0,
      monthlyTotal: 0,
    }
    cycleTotals.count += 1
    cycleTotals.monthlyTotal += monthlyAmount
    cycleMap.set(cycleKey, cycleTotals)
  }

  const categories = [...categoryMap.entries()]
    .map(([key, totals]) => ({
      category: key.split(':').slice(1).join(':'),
      currency: totals.currency,
      count: totals.count,
      monthlyTotal: Math.round(totals.monthlyTotal * 100) / 100,
      yearlyTotal: Math.round(totals.yearlyTotal * 100) / 100,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.monthlyTotal - a.monthlyTotal)

  const billingCycles = [...cycleMap.entries()]
    .map(([, totals]) => ({
      currency: totals.currency,
      billingCycle: totals.billingCycle,
      count: totals.count,
      monthlyTotal: Math.round(totals.monthlyTotal * 100) / 100,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.monthlyTotal - a.monthlyTotal)

  const currencyTotals = summarizeCurrencyTotals(
    rows.map((row) => ({
      currency: row.currency,
      ...subscriptionEquivalentAmounts(row.amount, row.billing_cycle),
    }))
  )

  return {
    success: true,
    categories,
    billingCycles,
    summary: {
      activeSubscriptions: rows.length,
      monthlyTotal: currencyTotals.monthlyTotal,
      yearlyTotal: currencyTotals.yearlyTotal,
      totalsByCurrency: currencyTotals.totalsByCurrency,
    },
    message:
      rows.length === 0
        ? 'No active subscriptions found.'
        : currencyTotals.isSingleCurrency && currencyTotals.monthlyTotal !== null
          ? `${rows.length} active subscription(s), costing about ${currencyTotals.singleCurrency} ${currencyTotals.monthlyTotal.toFixed(2)} per month.`
          : `${rows.length} active subscription(s) across ${currencyTotals.totalsByCurrency.length} currencies. See totalsByCurrency for exact totals.`,
  }
}
