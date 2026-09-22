import {
  dayjs,
  query,
  readInsightBudgetComparison,
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
import { readCurrentAmounts } from '../dated-read.js'
import { CASH_FLOW_SQL, reportingReadFailure, readConvertedCashFlow } from '../reporting-read.js'

export async function calculateFinancialHealthScoreSummary() {
  const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  const sixMonthsAgo = dayjs().subtract(5, 'month').startOf('month').format('YYYY-MM-DD')
  const failure = reportingReadFailure(sixMonthsAgo, today)
  if (failure)
    return {
      ...failure,
      score: {
        overall: null,
        grade: null,
        subscores: [],
        trend: 'stable' as HealthTrend,
        tips: [failure.message],
        calculatedAt: new Date().toISOString(),
        mixedCurrency: false,
        omittedSubscores: [],
        scoresByCurrency: [],
      },
    }

  const currentMonthTotals = query<{ currency: string; type: string; total: number }>(
    `SELECT UPPER(TRIM(t.currency)) AS currency, t.type, COALESCE(SUM(t.amount), 0) AS total
     FROM transactions t
     WHERE t.date >= $1 AND t.date <= $2 AND ${CASH_FLOW_SQL}
     GROUP BY UPPER(TRIM(t.currency)), t.type`,
    [startOfMonth, today]
  )
  const debtBalances = query<{ currency: string; total_balance: number }>(
    `SELECT UPPER(TRIM(currency)) AS currency,
            COALESCE(SUM(MAX(-balance, 0)), 0) AS total_balance
     FROM accounts
     WHERE type = 'credit_card' AND is_archived = 0
     GROUP BY UPPER(TRIM(currency))`
  )
  const savingsBalances = query<{ currency: string; total: number }>(
    `SELECT UPPER(TRIM(currency)) AS currency, COALESCE(SUM(balance), 0) AS total
     FROM accounts
     WHERE type = 'savings' AND is_archived = 0
     GROUP BY UPPER(TRIM(currency))`
  )
  const trailingExpenseTotals = query<{ currency: string; total: number }>(
    `SELECT UPPER(TRIM(t.currency)) AS currency, COALESCE(SUM(t.amount), 0) AS total
     FROM transactions t
     WHERE t.date >= $1 AND t.date <= $2 AND t.type = 'expense' AND ${CASH_FLOW_SQL}
     GROUP BY UPPER(TRIM(t.currency))`,
    [dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD'), today]
  )
  const monthlyExpenseRows = query<{ month: string; currency: string; total: number }>(
    `SELECT substr(t.date, 1, 7) AS month, UPPER(TRIM(t.currency)) AS currency,
            COALESCE(SUM(t.amount), 0) AS total
     FROM transactions t
     WHERE t.date >= $1 AND t.date <= $2 AND t.type = 'expense' AND ${CASH_FLOW_SQL}
     GROUP BY substr(t.date, 1, 7), UPPER(TRIM(t.currency))`,
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

  const activeBudgets = query<BudgetScoreRow>(
    'SELECT id, amount, currency, category_id, period FROM budgets WHERE is_active = 1'
  )
  const budgetComparisons = activeBudgets.map((budget) => {
    const start =
      budget.period === 'weekly'
        ? dayjs().subtract(6, 'day').format('YYYY-MM-DD')
        : budget.period === 'yearly'
          ? dayjs().startOf('year').format('YYYY-MM-DD')
          : startOfMonth
    return readInsightBudgetComparison(budget, start, today)
  })
  const budgetSubscore = createBudgetAdherenceSubscore(activeBudgets, today)
  const current = readConvertedCashFlow(startOfMonth, today)
  const target = current.success ? current.toCurrency : null
  const trailing = readConvertedCashFlow(
    dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD'),
    today,
    target,
    { expensesOnly: true }
  )
  const history = readConvertedCashFlow(sixMonthsAgo, today, target, { expensesOnly: true })
  const savings = readCurrentAmounts(
    query<{ id: string; currency: string; amountCentavos: number }>(
      `SELECT id, UPPER(TRIM(currency)) AS currency, balance AS amountCentavos
     FROM accounts WHERE type = 'savings' AND is_archived = 0`
    ),
    target
  )
  const debt = readCurrentAmounts(
    query<{ id: string; currency: string; amountCentavos: number }>(
      `SELECT id, UPPER(TRIM(currency)) AS currency, MAX(-balance, 0) AS amountCentavos
     FROM accounts WHERE type = 'credit_card' AND is_archived = 0`
    ),
    target
  )
  const mainComplete =
    current.success &&
    current.complete &&
    trailing.success &&
    trailing.complete &&
    history.success &&
    history.complete &&
    savings.complete &&
    debt.complete &&
    budgetComparisons.every((budget) => budget.spending.success && budget.mainComparison.complete)
  const mainSubscores =
    mainComplete && current.success && trailing.success && history.success
      ? [
          createSavingsRateSubscore(current.incomeCentavos!, current.expenseCentavos!),
          budgetSubscore,
          createDebtToIncomeSubscore(current.incomeCentavos!, debt.totalCentavos!),
          createEmergencyFundSubscore(savings.totalCentavos!, trailing.expenseCentavos!, target!),
          createSpendingConsistencySubscore(
            monthKeys.map(
              (month) => history.months.find((row) => row.month === month)?.expenseCentavos ?? 0
            )
          ),
        ]
      : []
  const mainConversion = {
    complete: mainComplete,
    toCurrency: target,
    reason:
      current.reason ??
      trailing.reason ??
      history.reason ??
      savings.reason ??
      debt.reason ??
      (budgetComparisons.some(
        (budget) => !budget.spending.success || !budget.mainComparison.complete
      )
        ? 'incomplete_budget_comparison'
        : null),
    asOfDate: today,
    policy: 'current_balances_today_vs_transaction_date_cashflow' as const,
    basis: 'gross_cashflow' as const,
    current,
    trailing,
    history,
    savings,
    debt,
    budgetComparisons,
    score: mainComplete
      ? { ...summarizeHealthScores(mainSubscores), subscores: mainSubscores, calculatedAt }
      : null,
  }

  if (currencies.length <= 1) {
    const currency = currencies[0] ?? 'USD'
    const currentMonth = currentMonthByCurrency.get(currency) ?? { income: 0, expense: 0 }
    const subscores = [
      createSavingsRateSubscore(currentMonth.income, currentMonth.expense),
      budgetSubscore,
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
      mainConversion,
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
    mainConversion,
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
      'Financial health is shown per currency because your data spans multiple currencies. Budget adherence is omitted from native per-currency scores; mainConversion compares every budget in its durable denomination.',
  }
}
