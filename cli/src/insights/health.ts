import {
  dayjs,
  query,
  uniqueCurrencies,
  createSavingsRateSubscore,
  createBudgetAdherenceSubscore,
  createDebtToIncomeSubscore,
  createEmergencyFundSubscore,
  createSpendingConsistencySubscore,
  summarizeHealthScores,
  type BudgetScoreRow,
  type HealthTrend,
} from './shared.js'

export async function calculateFinancialHealthScoreSummary() {
  const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  const sixMonthsAgo = dayjs().subtract(5, 'month').startOf('month').format('YYYY-MM-DD')
  const currentMonthTotals = query<{ currency: string; type: string; total: number }>(
    `SELECT currency, type, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type IN ('income', 'expense') AND date >= $1 AND date <= $2
     GROUP BY currency, type`,
    [startOfMonth, today]
  )
  const debtBalances = query<{ currency: string; total_balance: number }>(
    `SELECT currency, COALESCE(SUM(ABS(balance)), 0) AS total_balance
     FROM accounts
     WHERE type = 'credit_card' AND is_archived = 0
     GROUP BY currency`
  )
  const savingsBalances = query<{ currency: string; total: number }>(
    `SELECT currency, COALESCE(SUM(balance), 0) AS total
     FROM accounts
     WHERE type = 'savings' AND is_archived = 0
     GROUP BY currency`
  )
  const trailingExpenseTotals = query<{ currency: string; total: number }>(
    `SELECT currency, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type = 'expense' AND date >= $1 AND date <= $2
     GROUP BY currency`,
    [dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD'), today]
  )
  const monthlyExpenseRows = query<{ month: string; currency: string; total: number }>(
    `SELECT substr(date, 1, 7) AS month, currency, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type = 'expense' AND date >= $1 AND date <= $2
     GROUP BY substr(date, 1, 7), currency`,
    [sixMonthsAgo, today]
  )

  const currencies = uniqueCurrencies(
    currentMonthTotals,
    debtBalances,
    savingsBalances,
    trailingExpenseTotals,
    monthlyExpenseRows
  )
  const currentMonthByCurrency = new Map<string, { income: number; expense: number }>()
  for (const row of currentMonthTotals) {
    const totals = currentMonthByCurrency.get(row.currency) ?? { income: 0, expense: 0 }
    if (row.type === 'income') totals.income = row.total
    if (row.type === 'expense') totals.expense = row.total
    currentMonthByCurrency.set(row.currency, totals)
  }
  const debtByCurrency = new Map(debtBalances.map((row) => [row.currency, row.total_balance]))
  const savingsByCurrency = new Map(savingsBalances.map((row) => [row.currency, row.total]))
  const trailingExpensesByCurrency = new Map(
    trailingExpenseTotals.map((row) => [row.currency, row.total])
  )
  const monthlyExpenseByMonthCurrency = new Map(
    monthlyExpenseRows.map((row) => [`${row.month}:${row.currency}`, row.total])
  )
  const monthKeys = Array.from({ length: 6 }, (_, index) =>
    dayjs()
      .subtract(5 - index, 'month')
      .format('YYYY-MM')
  )
  const calculatedAt = new Date().toISOString()

  if (currencies.length <= 1) {
    const currency = currencies[0] ?? 'USD'
    const currentMonth = currentMonthByCurrency.get(currency) ?? { income: 0, expense: 0 }
    const activeBudgets = query<BudgetScoreRow>(
      'SELECT id, amount, category_id, period FROM budgets WHERE is_active = 1'
    )
    const subscores = [
      createSavingsRateSubscore(currentMonth.income, currentMonth.expense),
      createBudgetAdherenceSubscore(activeBudgets, today),
      createDebtToIncomeSubscore(currentMonth.income, debtByCurrency.get(currency) ?? 0),
      createEmergencyFundSubscore(
        savingsByCurrency.get(currency) ?? 0,
        trailingExpensesByCurrency.get(currency) ?? 0,
        currency
      ),
      createSpendingConsistencySubscore(
        monthKeys.map((month) => monthlyExpenseByMonthCurrency.get(`${month}:${currency}`) ?? 0)
      ),
    ]
    const summary = summarizeHealthScores(subscores)

    return {
      success: true,
      score: {
        overall: summary.overall,
        grade: summary.grade,
        subscores,
        trend: 'stable' as HealthTrend,
        tips: summary.tips,
        calculatedAt,
      },
      message: `Financial health score: ${summary.overall}/100 (${summary.grade}).`,
    }
  }

  const scoresByCurrency = currencies.map((currency) => {
    const currentMonth = currentMonthByCurrency.get(currency) ?? { income: 0, expense: 0 }
    const subscores = [
      createSavingsRateSubscore(currentMonth.income, currentMonth.expense),
      createDebtToIncomeSubscore(currentMonth.income, debtByCurrency.get(currency) ?? 0),
      createEmergencyFundSubscore(
        savingsByCurrency.get(currency) ?? 0,
        trailingExpensesByCurrency.get(currency) ?? 0,
        currency
      ),
      createSpendingConsistencySubscore(
        monthKeys.map((month) => monthlyExpenseByMonthCurrency.get(`${month}:${currency}`) ?? 0)
      ),
    ]
    const summary = summarizeHealthScores(subscores)

    return {
      currency,
      overall: summary.overall,
      grade: summary.grade,
      subscores,
      tips: summary.tips,
      omittedSubscores: ['Budget Adherence'],
    }
  })
  const tips = scoresByCurrency
    .flatMap((score) => score.tips.map((tip) => `${score.currency}: ${tip}`))
    .slice(0, 3)

  return {
    success: true,
    score: {
      overall: null,
      grade: null,
      subscores: [],
      trend: 'stable' as HealthTrend,
      tips:
        tips.length > 0
          ? tips
          : ['Financial health is shown per currency because your data spans multiple currencies.'],
      calculatedAt,
      mixedCurrency: true,
      omittedSubscores: ['Budget Adherence'],
      scoresByCurrency,
    },
    message:
      'Financial health is shown per currency because your data spans multiple currencies. Budget adherence is omitted because budgets are not currency-scoped.',
  }
}
