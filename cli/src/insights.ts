import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear.js'
import { query, execute } from './database.js'
import { generateId } from './ulid.js'
import { fromCentavos, formatMoney } from './money.js'
import { noteExists, writeNote } from './notebook.js'

dayjs.extend(weekOfYear)

const UNCATEGORIZED = 'Uncategorized'

type SubscriptionBillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
type RecapType = 'weekly' | 'monthly'
type HealthTrend = 'improving' | 'declining' | 'stable'
type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'
type AnomalySeverity = 'low' | 'medium' | 'high'
type AnomalyType =
  | 'unusual_amount'
  | 'duplicate_charge'
  | 'spending_spike'
  | 'subscription_price_change'
  | 'large_transaction'

type SubscriptionRow = {
  id: string
  name: string
  amount: number
  currency: string
  billing_cycle: SubscriptionBillingCycle
  next_billing_date: string
  is_active: number
  category_name: string | null
  account_name: string | null
}

type AnomalyTransactionRow = {
  id: string
  description: string
  amount: number
  currency: string
  date: string
  category_id: string | null
  category_name: string | null
  type: string
}

type CategorySpendRow = {
  currency: string
  category_id: string | null
  category_name: string
  total: number
  count: number
}

type RecapHighlight = {
  label: string
  value: string
  change?: string
}

type RecapRecord = {
  id: string
  type: RecapType
  period_start: string
  period_end: string
  title: string
  summary: string
  highlights: RecapHighlight[]
  generated_at: string
}

type BudgetScoreRow = {
  id: string
  amount: number
  category_id: string
  period: string
}

type ReviewHolding = {
  symbol: string
  name: string
  shares: number
  currency: string
  value: number
  gainLossPercent: number
}

type EducationTopic = 'budgeting' | 'saving' | 'investing' | 'debt' | 'general'

type EducationTip = {
  id: string
  topic: EducationTopic
  title: string
  content: string
  learnMore?: string
}

type HealthSubscore = {
  name: string
  score: number
  weight: number
  description: string
  tip: string
}

const EDUCATION_TIPS: EducationTip[] = [
  {
    id: 'budget-50-30-20',
    topic: 'budgeting',
    title: 'The 50/30/20 Rule',
    content:
      'A common starting point is 50% of after-tax income for needs, 30% for wants, and 20% for savings or debt repayment.',
    learnMore: 'https://www.investopedia.com/ask/answers/022916/what-502030-budget-rule.asp',
  },
  {
    id: 'budget-zero-based',
    topic: 'budgeting',
    title: 'Zero-Based Budgeting',
    content:
      'Zero-based budgeting assigns every dollar of income a job so income minus planned spending equals zero.',
    learnMore: 'https://www.investopedia.com/terms/z/zbb.asp',
  },
  {
    id: 'budget-envelope',
    topic: 'budgeting',
    title: 'The Envelope Method',
    content:
      'The envelope method limits each spending category to a fixed amount so overspending becomes obvious quickly.',
    learnMore: 'https://www.investopedia.com/envelope-budgeting-system-5208026',
  },
  {
    id: 'saving-emergency-fund',
    topic: 'saving',
    title: 'Emergency Fund Basics',
    content:
      'Many people aim for 3 to 6 months of essential expenses in an easily accessible savings account.',
    learnMore: 'https://www.investopedia.com/terms/e/emergency_fund.asp',
  },
  {
    id: 'saving-compound-interest',
    topic: 'saving',
    title: 'The Power of Compound Interest',
    content:
      'Compound interest means returns can themselves earn returns, which makes time especially valuable.',
    learnMore: 'https://www.investopedia.com/terms/c/compoundinterest.asp',
  },
  {
    id: 'saving-pay-yourself-first',
    topic: 'saving',
    title: 'Pay Yourself First',
    content:
      'Saving immediately after income arrives can make progress more consistent than saving whatever remains later.',
    learnMore: 'https://www.investopedia.com/terms/p/payyourselffirst.asp',
  },
  {
    id: 'investing-dca',
    topic: 'investing',
    title: 'Dollar-Cost Averaging',
    content:
      'Investing a fixed amount on a regular schedule can reduce the emotional pressure of timing the market.',
    learnMore: 'https://www.investopedia.com/terms/d/dollarcostaveraging.asp',
  },
  {
    id: 'investing-diversification',
    topic: 'investing',
    title: 'Diversification',
    content:
      'Diversification spreads risk across assets, sectors, or geographies so one position matters less.',
    learnMore: 'https://www.investopedia.com/terms/d/diversification.asp',
  },
  {
    id: 'investing-index-vs-active',
    topic: 'investing',
    title: 'Index Funds vs. Active Management',
    content:
      'Index funds aim to match a benchmark at low cost, while active funds try to outperform through security selection.',
    learnMore:
      'https://www.investopedia.com/ask/answers/040315/what-difference-between-index-fund-and-actively-managed-fund.asp',
  },
  {
    id: 'debt-snowball-vs-avalanche',
    topic: 'debt',
    title: 'Snowball vs. Avalanche Method',
    content:
      'Snowball targets the smallest balances first, while avalanche prioritizes the highest interest rates first.',
    learnMore:
      'https://www.investopedia.com/articles/personal-finance/080716/debt-avalanche-vs-debt-snowball-which-best-you.asp',
  },
  {
    id: 'debt-good-vs-bad',
    topic: 'debt',
    title: 'Good Debt vs. Bad Debt',
    content:
      'Debt used to acquire appreciating assets is often viewed differently from debt used for short-lived consumption.',
    learnMore: 'https://www.investopedia.com/articles/pf/12/good-debt-bad-debt.asp',
  },
  {
    id: 'debt-credit-utilization',
    topic: 'debt',
    title: 'Credit Utilization Ratio',
    content:
      'Keeping revolving balances low relative to total credit limits is generally healthier for credit profiles.',
    learnMore: 'https://www.investopedia.com/terms/c/credit-utilization-rate.asp',
  },
  {
    id: 'general-inflation',
    topic: 'general',
    title: 'Understanding Inflation',
    content:
      'Inflation reduces the purchasing power of cash over time, which is why long-term goals often need growth assets.',
    learnMore: 'https://www.investopedia.com/terms/i/inflation.asp',
  },
  {
    id: 'general-opportunity-cost',
    topic: 'general',
    title: 'Opportunity Cost',
    content:
      'Every financial choice trades away an alternative, so good decisions consider what is being given up too.',
    learnMore: 'https://www.investopedia.com/terms/o/opportunitycost.asp',
  },
  {
    id: 'general-time-value',
    topic: 'general',
    title: 'Time Value of Money',
    content:
      'Money available today is more valuable than the same amount later because it can be used or invested immediately.',
    learnMore: 'https://www.investopedia.com/terms/t/timevalueofmoney.asp',
  },
]

const ACTION_TO_TIP: Record<string, string> = {
  'first-budget': 'budget-50-30-20',
  'create-budget': 'budget-zero-based',
  'first-investment': 'investing-dca',
  'add-investment': 'investing-diversification',
  'first-transaction': 'saving-pay-yourself-first',
  'credit-card-payment': 'debt-credit-utilization',
  'debt-payment': 'debt-snowball-vs-avalanche',
  'savings-deposit': 'saving-compound-interest',
  'view-spending': 'budget-envelope',
  'emergency-fund': 'saving-emergency-fund',
  'view-net-worth': 'general-inflation',
}

function getMonthlyMultiplier(cycle: SubscriptionBillingCycle): number {
  switch (cycle) {
    case 'weekly':
      return 52 / 12
    case 'monthly':
      return 1
    case 'quarterly':
      return 1 / 3
    case 'yearly':
      return 1 / 12
  }
}

function getYearlyMultiplier(cycle: SubscriptionBillingCycle): number {
  switch (cycle) {
    case 'weekly':
      return 52
    case 'monthly':
      return 12
    case 'quarterly':
      return 4
    case 'yearly':
      return 1
  }
}

function toDisplayAmount(centavos: number): number {
  return Math.round(fromCentavos(centavos) * 100) / 100
}

function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 65) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

function percentageChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+100%' : '0%'
  const pct = Math.round(((current - previous) / previous) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

function calculateStdDev(values: number[]): { mean: number; stdDev: number } {
  if (values.length < 3) {
    return { mean: 0, stdDev: 0 }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return { mean, stdDev: Math.sqrt(variance) }
}

function summarizeCurrencyTotals(
  rows: Array<{ currency: string; monthlyAmount: number; yearlyAmount: number }>
) {
  const totals = new Map<string, { monthlyTotal: number; yearlyTotal: number }>()
  for (const row of rows) {
    const existing = totals.get(row.currency) ?? { monthlyTotal: 0, yearlyTotal: 0 }
    existing.monthlyTotal += row.monthlyAmount
    existing.yearlyTotal += row.yearlyAmount
    totals.set(row.currency, existing)
  }

  const totalsByCurrency = [...totals.entries()]
    .map(([currency, values]) => ({
      currency,
      monthlyTotal: Math.round(values.monthlyTotal * 100) / 100,
      yearlyTotal: Math.round(values.yearlyTotal * 100) / 100,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency))

  const isSingleCurrency = totalsByCurrency.length === 1

  return {
    totalsByCurrency,
    isSingleCurrency,
    singleCurrency: isSingleCurrency ? (totalsByCurrency[0]?.currency ?? null) : null,
    monthlyTotal: isSingleCurrency ? (totalsByCurrency[0]?.monthlyTotal ?? null) : null,
    yearlyTotal: isSingleCurrency ? (totalsByCurrency[0]?.yearlyTotal ?? null) : null,
  }
}

function subscriptionEquivalentAmounts(amount: number, billingCycle: SubscriptionBillingCycle) {
  return {
    monthlyAmount: fromCentavos(amount * getMonthlyMultiplier(billingCycle)),
    yearlyAmount: fromCentavos(amount * getYearlyMultiplier(billingCycle)),
  }
}

function uniqueCurrencies(...groups: Array<Array<{ currency: string }>>): string[] {
  return [
    ...new Set(groups.flatMap((group) => group.map((row) => row.currency).filter(Boolean))),
  ].sort((a, b) => a.localeCompare(b))
}

function getDailySubscriptionCost(amount: number, billingCycle: SubscriptionBillingCycle): number {
  switch (billingCycle) {
    case 'weekly':
      return amount / 7
    case 'monthly':
      return amount / 30
    case 'quarterly':
      return amount / 90
    case 'yearly':
      return amount / 365
  }
}

function buildCashFlowForecast(
  currentBalance: number,
  avgDailyIncome: number,
  avgDailyExpense: number,
  dailySubscriptionCost: number,
  boundedDays: number
) {
  const effectiveDailyExpense = Math.max(avgDailyExpense, dailySubscriptionCost)
  const projectedNet = avgDailyIncome - effectiveDailyExpense
  const optimisticNet = avgDailyIncome - effectiveDailyExpense * 0.8
  const pessimisticNet = avgDailyIncome - effectiveDailyExpense * 1.2

  const points: Array<{
    date: string
    projected: number
    optimistic: number
    pessimistic: number
  }> = []
  let projectedBalance = currentBalance
  let optimisticBalance = currentBalance
  let pessimisticBalance = currentBalance
  let minBalance = { date: dayjs().format('YYYY-MM-DD'), amount: currentBalance }
  const dangerDates: string[] = []

  for (let offset = 0; offset <= boundedDays; offset += 1) {
    const date = dayjs().add(offset, 'day').format('YYYY-MM-DD')
    if (offset > 0) {
      projectedBalance += projectedNet
      optimisticBalance += optimisticNet
      pessimisticBalance += pessimisticNet
    }

    points.push({
      date,
      projected: toDisplayAmount(Math.round(projectedBalance)),
      optimistic: toDisplayAmount(Math.round(optimisticBalance)),
      pessimistic: toDisplayAmount(Math.round(pessimisticBalance)),
    })

    if (projectedBalance < minBalance.amount) {
      minBalance = { date, amount: Math.round(projectedBalance) }
    }
    if (projectedBalance < 0) {
      dangerDates.push(date)
    }
  }

  return {
    currentBalance: toDisplayAmount(currentBalance),
    dailyBurnRate: toDisplayAmount(Math.round(effectiveDailyExpense)),
    dailyIncome: toDisplayAmount(Math.round(avgDailyIncome)),
    minBalance: {
      date: minBalance.date,
      amount: toDisplayAmount(minBalance.amount),
    },
    dangerDates,
    points,
  }
}

function createSavingsRateSubscore(monthlyIncome: number, monthlyExpenses: number): HealthSubscore {
  let score = 0
  let tip = 'Start tracking your income to unlock savings insights'
  if (monthlyIncome > 0) {
    const rate = (monthlyIncome - monthlyExpenses) / monthlyIncome
    if (rate >= 0.2) {
      score = 100
      tip = 'Your savings rate is excellent.'
    } else if (rate >= 0.1) {
      score = 70
      tip = 'A small spending cut could move your savings rate above 20%.'
    } else if (rate >= 0) {
      score = 40
      tip = 'Look for one recurring expense to reduce.'
    } else {
      score = 0
      tip = 'Spending exceeds income this month. Review recent expenses first.'
    }
  }

  return {
    name: 'Savings Rate',
    score,
    weight: 0.25,
    description:
      monthlyIncome > 0
        ? `Current savings rate: ${Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)}%`
        : 'Current savings rate: N/A',
    tip,
  }
}

function createBudgetAdherenceSubscore(
  activeBudgets: BudgetScoreRow[],
  today: string
): HealthSubscore {
  if (activeBudgets.length === 0) {
    return {
      name: 'Budget Adherence',
      score: 50,
      weight: 0.2,
      description: 'No active budgets set',
      tip: 'Create budgets for your top spending categories.',
    }
  }

  let withinCount = 0
  for (const budget of activeBudgets) {
    let start = dayjs().startOf('month').format('YYYY-MM-DD')
    if (budget.period === 'weekly') start = dayjs().subtract(6, 'day').format('YYYY-MM-DD')
    if (budget.period === 'yearly') start = dayjs().startOf('year').format('YYYY-MM-DD')

    const spent =
      query<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE category_id = $1 AND type = 'expense' AND date >= $2 AND date <= $3`,
        [budget.category_id, start, today]
      )[0]?.total ?? 0
    if (spent <= budget.amount) withinCount += 1
  }

  const score = Math.round((withinCount / activeBudgets.length) * 100)
  return {
    name: 'Budget Adherence',
    score,
    weight: 0.2,
    description: `${withinCount} of ${activeBudgets.length} budgets within limit`,
    tip:
      score === 100
        ? 'All budgets are on track.'
        : `Focus on the ${activeBudgets.length - withinCount} over-budget categor${activeBudgets.length - withinCount === 1 ? 'y' : 'ies'}.`,
  }
}

function createDebtToIncomeSubscore(monthlyIncome: number, debtBalance: number): HealthSubscore {
  if (monthlyIncome <= 0) {
    return {
      name: 'Debt-to-Income',
      score: debtBalance === 0 ? 100 : 20,
      weight: 0.2,
      description: debtBalance === 0 ? 'No credit card debt' : 'Track income to measure debt ratio',
      tip:
        debtBalance === 0 ? 'No credit card debt.' : 'Track income so debt ratios are meaningful.',
    }
  }

  const ratio = debtBalance / monthlyIncome
  return {
    name: 'Debt-to-Income',
    score: ratio < 0.1 ? 100 : ratio <= 0.3 ? 60 : 20,
    weight: 0.2,
    description: `Debt ratio: ${Math.round(ratio * 100)}%`,
    tip:
      ratio < 0.1
        ? 'Your debt-to-income ratio is healthy.'
        : ratio <= 0.3
          ? 'Reducing card balances would improve this score.'
          : 'High revolving balances should be a priority.',
  }
}

function createEmergencyFundSubscore(
  savingsBalance: number,
  trailingThreeMonthExpenses: number,
  currency: string
): HealthSubscore {
  const avgMonthlyExpenses = trailingThreeMonthExpenses / 3
  if (avgMonthlyExpenses <= 0) {
    return {
      name: 'Emergency Fund',
      score: savingsBalance > 0 ? 75 : 50,
      weight: 0.2,
      description:
        savingsBalance > 0
          ? `Savings: ${formatMoney(savingsBalance, currency)}`
          : 'No savings accounts found',
      tip:
        savingsBalance > 0
          ? 'Track expenses to measure emergency-fund coverage.'
          : 'Open a savings account and start building a safety net.',
    }
  }

  const target = avgMonthlyExpenses * 3
  const coverage = savingsBalance / target
  const score = Math.min(100, Math.round(coverage * 100))
  return {
    name: 'Emergency Fund',
    score,
    weight: 0.2,
    description: `Covers ${(savingsBalance / avgMonthlyExpenses).toFixed(1)} months of expenses`,
    tip:
      score >= 100
        ? 'Emergency fund target is covered.'
        : `Aim for 3 months of expenses; you are ${Math.round(coverage * 100)}% there.`,
  }
}

function createSpendingConsistencySubscore(monthlyExpenseTotals: number[]): HealthSubscore {
  const nonZeroMonths = monthlyExpenseTotals.filter((value) => value > 0)
  if (nonZeroMonths.length < 2) {
    return {
      name: 'Spending Consistency',
      score: 50,
      weight: 0.15,
      description: 'Not enough data yet',
      tip: 'Keep tracking expenses to unlock consistency insights.',
    }
  }

  const mean = nonZeroMonths.reduce((sum, value) => sum + value, 0) / nonZeroMonths.length
  const variance =
    nonZeroMonths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nonZeroMonths.length
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0
  const score = cv <= 0.1 ? 100 : cv <= 0.25 ? 80 : cv <= 0.4 ? 60 : cv <= 0.6 ? 40 : 20

  return {
    name: 'Spending Consistency',
    score,
    weight: 0.15,
    description: `Variation: ${Math.round(cv * 100)}% across ${nonZeroMonths.length} months`,
    tip:
      score >= 80
        ? 'Spending patterns are steady.'
        : 'Large month-to-month swings make budgeting harder.',
  }
}

function summarizeHealthScores(subscores: HealthSubscore[]) {
  const totalWeight = subscores.reduce((sum, score) => sum + score.weight, 0)
  const overall =
    totalWeight > 0
      ? Math.round(
          subscores.reduce((sum, score) => sum + score.score * score.weight, 0) / totalWeight
        )
      : 0
  const tips = [...subscores]
    .sort((a, b) => a.score - b.score)
    .filter((score) => score.score < 100)
    .slice(0, 3)
    .map((score) => score.tip)

  return {
    overall,
    grade: scoreToGrade(overall),
    tips: tips.length > 0 ? tips : ['Your finances are looking strong across the board.'],
  }
}

function getDailyEducationTip(): EducationTip {
  const today = new Date()
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  )
  return EDUCATION_TIPS[dayOfYear % EDUCATION_TIPS.length]
}

function buildRecapRecord(
  type: RecapType,
  start: string,
  end: string,
  title: string,
  summary: string,
  highlights: RecapHighlight[]
): RecapRecord {
  return {
    id: generateId(),
    type,
    period_start: start,
    period_end: end,
    title,
    summary,
    highlights,
    generated_at: new Date().toISOString(),
  }
}

async function saveRecap(record: RecapRecord): Promise<void> {
  execute(
    `INSERT OR REPLACE INTO recaps (id, type, period_start, period_end, title, summary, highlights_json, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.type,
      record.period_start,
      record.period_end,
      record.title,
      record.summary,
      JSON.stringify(record.highlights),
      record.generated_at,
    ]
  )
}

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

export async function generatePortfolioReview(force: boolean) {
  const weekNum = dayjs().week()
  const year = dayjs().year()
  const weekLabel = `Week ${weekNum}, ${year}`
  const path = `weekly-reviews/${year}-W${String(weekNum).padStart(2, '0')}-review.md`

  if (!force && (await noteExists(path))) {
    return {
      success: true,
      skipped: true,
      path,
      message: `Portfolio review already exists for ${weekLabel}. Use --force to overwrite it.`,
    }
  }

  const investments = query<{
    symbol: string
    name: string
    shares: number
    avg_cost_basis: number
    currency: string
  }>('SELECT symbol, name, shares, avg_cost_basis, currency FROM investments ORDER BY name ASC')

  if (investments.length === 0) {
    return {
      success: false,
      message: 'No investments found. Add investments before generating a portfolio review.',
    }
  }

  let totalValue = 0
  let totalCostBasis = 0
  const totalsByCurrency = new Map<string, { value: number; costBasis: number }>()
  const holdings: ReviewHolding[] = []

  for (const investment of investments) {
    const latestPrice = query<{ price: number; currency: string }>(
      'SELECT price, currency FROM stock_prices WHERE symbol = $1 ORDER BY date DESC LIMIT 1',
      [investment.symbol]
    )[0]
    const currentPrice = latestPrice?.price ?? investment.avg_cost_basis
    const currentCurrency = latestPrice?.currency ?? investment.currency
    if (currentCurrency !== investment.currency) {
      return {
        success: false,
        message: `Investment ${investment.symbol} mixes ${investment.currency} cost basis with ${currentCurrency} price data. Normalize currencies before generating a portfolio review.`,
      }
    }
    const value = Math.round(investment.shares * currentPrice)
    const costBasis = Math.round(investment.shares * investment.avg_cost_basis)
    const gainLossPercent =
      costBasis > 0 ? Math.round(((value - costBasis) / costBasis) * 10000) / 100 : 0

    totalValue += value
    totalCostBasis += costBasis
    const currencyTotals = totalsByCurrency.get(investment.currency) ?? { value: 0, costBasis: 0 }
    currencyTotals.value += value
    currencyTotals.costBasis += costBasis
    totalsByCurrency.set(investment.currency, currencyTotals)
    holdings.push({
      symbol: investment.symbol,
      name: investment.name,
      shares: investment.shares,
      currency: investment.currency,
      value,
      gainLossPercent,
    })
  }

  const totalsByCurrencyList = [...totalsByCurrency.entries()]
    .map(([currency, totals]) => {
      const gainLoss = totals.value - totals.costBasis
      const gainLossPercent =
        totals.costBasis > 0 ? Math.round((gainLoss / totals.costBasis) * 10000) / 100 : 0
      return {
        currency,
        portfolioValue: toDisplayAmount(totals.value),
        costBasis: toDisplayAmount(totals.costBasis),
        gainLoss: toDisplayAmount(gainLoss),
        gainLossPercent,
      }
    })
    .sort((a, b) => a.currency.localeCompare(b.currency))
  const singleCurrency = totalsByCurrencyList.length === 1

  const sortedByPerformance = [...holdings].sort((a, b) => b.gainLossPercent - a.gainLossPercent)
  const topPerformer = sortedByPerformance[0] ?? null
  const worstPerformer = sortedByPerformance[sortedByPerformance.length - 1] ?? null
  const gainLoss = totalValue - totalCostBasis
  const gainLossPercent =
    totalCostBasis > 0 ? Math.round((gainLoss / totalCostBasis) * 10000) / 100 : 0

  const lines = [`# Portfolio Review — ${weekLabel}`, '', '## Performance']

  if (singleCurrency) {
    lines.push(
      `- **Portfolio value:** ${formatMoney(totalValue, totalsByCurrencyList[0].currency)}`
    )
    lines.push(`- **Cost basis:** ${formatMoney(totalCostBasis, totalsByCurrencyList[0].currency)}`)
    lines.push(
      `- **Total gain/loss:** ${gainLoss >= 0 ? '+' : ''}${formatMoney(gainLoss, totalsByCurrencyList[0].currency)} (${gainLossPercent >= 0 ? '+' : ''}${gainLossPercent.toFixed(2)}%)`
    )
  } else {
    lines.push('- **Totals by currency:**')
    for (const currencyTotal of totalsByCurrencyList) {
      lines.push(
        `  - ${currencyTotal.currency}: ${currencyTotal.portfolioValue.toFixed(2)} value, ${currencyTotal.costBasis.toFixed(2)} cost basis, ${currencyTotal.gainLoss >= 0 ? '+' : ''}${currencyTotal.gainLoss.toFixed(2)} (${currencyTotal.gainLossPercent >= 0 ? '+' : ''}${currencyTotal.gainLossPercent.toFixed(2)}%)`
      )
    }
  }

  if (topPerformer) {
    lines.push(
      `- **Top performer:** ${topPerformer.symbol} (${topPerformer.gainLossPercent >= 0 ? '+' : ''}${topPerformer.gainLossPercent.toFixed(2)}%)`
    )
  }

  if (worstPerformer && worstPerformer.symbol !== topPerformer?.symbol) {
    lines.push(
      `- **Worst performer:** ${worstPerformer.symbol} (${worstPerformer.gainLossPercent >= 0 ? '+' : ''}${worstPerformer.gainLossPercent.toFixed(2)}%)`
    )
  }

  lines.push('', '## Holdings', '', '| Symbol | Name | Shares | Value | Gain/Loss |')
  lines.push('|--------|------|--------|-------|-----------|')

  for (const holding of holdings) {
    lines.push(
      `| ${holding.symbol} | ${holding.name} | ${holding.shares} | ${formatMoney(holding.value, holding.currency)} | ${holding.gainLossPercent >= 0 ? '+' : ''}${holding.gainLossPercent.toFixed(2)}% |`
    )
  }

  lines.push(
    '',
    '## Notes',
    '',
    '*Auto-generated from current holdings and latest saved prices.*',
    '',
    '---',
    `*Generated on ${dayjs().format('YYYY-MM-DD HH:mm')}*`
  )

  await writeNote(path, lines.join('\n'))

  return {
    success: true,
    path,
    summary: {
      portfolioValue: singleCurrency ? toDisplayAmount(totalValue) : null,
      costBasis: singleCurrency ? toDisplayAmount(totalCostBasis) : null,
      gainLoss: singleCurrency ? toDisplayAmount(gainLoss) : null,
      gainLossPercent: singleCurrency ? gainLossPercent : null,
      totalsByCurrency: totalsByCurrencyList,
      holdingsCount: holdings.length,
      topPerformer: topPerformer
        ? { symbol: topPerformer.symbol, gainLossPercent: topPerformer.gainLossPercent }
        : null,
      worstPerformer: worstPerformer
        ? { symbol: worstPerformer.symbol, gainLossPercent: worstPerformer.gainLossPercent }
        : null,
    },
    message: `Generated portfolio review for ${weekLabel} at ${path}.`,
  }
}

export async function detectSpendingAnomaliesSummary(largeTransactionThreshold: number) {
  const thresholdCentavos = Math.round(largeTransactionThreshold * 100)
  const ledgerCurrencies = query<{ currency: string }>(
    `SELECT DISTINCT currency
     FROM transactions
     WHERE type = 'expense' AND currency IS NOT NULL AND TRIM(currency) != ''`
  )
  const hasMixedCurrencies = ledgerCurrencies.length > 1
  const anomalies: Array<{
    id: string
    type: AnomalyType
    severity: AnomalySeverity
    title: string
    description: string
    transactionId?: string
    amount?: number
    detectedAt: string
  }> = []

  const recentExpenseRows = query<AnomalyTransactionRow>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1
     ORDER BY t.date DESC`,
    [dayjs().subtract(30, 'day').format('YYYY-MM-DD')]
  )

  const checkedDescriptions = new Set<string>()
  const historyStart = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
  const recentWindowStart = dayjs().subtract(30, 'day').format('YYYY-MM-DD')

  for (const row of recentExpenseRows) {
    const descriptionKey = `${row.currency}:${row.description}`
    if (checkedDescriptions.has(descriptionKey)) continue
    checkedDescriptions.add(descriptionKey)

    const history = query<{ amount: number }>(
      `SELECT amount FROM transactions
       WHERE description = $1 AND currency = $2 AND type = 'expense' AND date >= $3 AND date < $4`,
      [row.description, row.currency, historyStart, recentWindowStart]
    )

    if (history.length < 3) continue

    const { mean, stdDev } = calculateStdDev(history.map((entry) => entry.amount))
    if (stdDev === 0) continue

    for (const recent of recentExpenseRows.filter(
      (entry) => entry.description === row.description && entry.currency === row.currency
    )) {
      const zScore = (recent.amount - mean) / stdDev
      if (zScore <= 2) continue
      anomalies.push({
        id: generateId(),
        type: 'unusual_amount',
        severity: zScore > 3 ? 'high' : 'medium',
        title: `Unusual charge at ${recent.description}`,
        description: `${formatMoney(recent.amount, recent.currency)} is ${zScore.toFixed(1)} standard deviations above the usual ${formatMoney(Math.round(mean), recent.currency)} for this merchant.`,
        transactionId: recent.id,
        amount: toDisplayAmount(recent.amount),
        detectedAt: new Date().toISOString(),
      })
    }
  }

  const duplicateWindowRows = query<AnomalyTransactionRow>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1
     ORDER BY t.date DESC`,
    [dayjs().subtract(7, 'day').format('YYYY-MM-DD')]
  )
  const duplicateGroups = new Map<string, AnomalyTransactionRow[]>()
  for (const row of duplicateWindowRows) {
    const key = `${row.currency}:${row.amount}:${row.description.toLowerCase()}`
    const group = duplicateGroups.get(key) ?? []
    group.push(row)
    duplicateGroups.set(key, group)
  }
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue
    for (let index = 0; index < group.length - 1; index += 1) {
      const current = group[index]
      const next = group[index + 1]
      const diffHours = Math.abs(dayjs(current.date).diff(dayjs(next.date), 'hour'))
      if (diffHours > 48) continue
      anomalies.push({
        id: generateId(),
        type: 'duplicate_charge',
        severity: 'medium',
        title: `Possible duplicate: ${current.description}`,
        description: `Two charges of ${formatMoney(current.amount, current.currency)} at ${current.description} landed within ${diffHours} hours.`,
        transactionId: current.id,
        amount: toDisplayAmount(current.amount),
        detectedAt: new Date().toISOString(),
      })
      break
    }
  }

  const currentMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  const historicalStart = dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
  const historicalEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')
  const currentCategorySpend = query<CategorySpendRow>(
    `SELECT t.currency, t.category_id, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name,
            SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.currency, t.category_id`,
    [currentMonthStart, today]
  )
  const historicalCategorySpend = query<CategorySpendRow>(
    `SELECT t.currency, t.category_id, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name,
            SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.currency, t.category_id`,
    [historicalStart, historicalEnd]
  )
  const averagesByCategory = new Map<string, number>()
  for (const row of historicalCategorySpend) {
    averagesByCategory.set(`${row.currency}:${row.category_id ?? 'uncategorized'}`, row.total / 3)
  }
  const projectionFactor = dayjs().daysInMonth() / dayjs().date()
  for (const row of currentCategorySpend) {
    const key = `${row.currency}:${row.category_id ?? 'uncategorized'}`
    const averageMonthly = averagesByCategory.get(key)
    if (!averageMonthly) continue
    const projected = row.total * projectionFactor
    const ratio = projected / averageMonthly
    if (ratio <= 1.5) continue
    anomalies.push({
      id: generateId(),
      type: 'spending_spike',
      severity: ratio > 2 ? 'high' : 'medium',
      title: `${row.category_name} spending spike`,
      description: `Current pace projects ${formatMoney(Math.round(projected), row.currency)} this month, about ${Math.round((ratio - 1) * 100)}% above the recent average.`,
      amount: toDisplayAmount(row.total),
      detectedAt: new Date().toISOString(),
    })
  }

  const recurringAmounts = query<{ description: string; currency: string; amounts: string }>(
    `SELECT description, currency, GROUP_CONCAT(amount, ',') AS amounts
     FROM (
       SELECT description, currency, amount, date
        FROM transactions
        WHERE type = 'expense' AND is_recurring = 1 AND date >= $1
        ORDER BY date ASC
      )
     GROUP BY description, currency
     HAVING COUNT(*) >= 2`,
    [dayjs().subtract(90, 'day').format('YYYY-MM-DD')]
  )
  for (const row of recurringAmounts) {
    const amounts = row.amounts.split(',').map(Number)
    const latest = amounts.at(-1)
    const previous = amounts.at(-2)
    if (latest === undefined || previous === undefined || latest === previous || previous <= 0)
      continue
    const changePct = Math.round(((latest - previous) / previous) * 100)
    anomalies.push({
      id: generateId(),
      type: 'subscription_price_change',
      severity: Math.abs(changePct) > 20 ? 'high' : Math.abs(changePct) > 10 ? 'medium' : 'low',
      title: `${row.description} price ${latest > previous ? 'increase' : 'decrease'}`,
      description: `${row.description} changed from ${formatMoney(previous, row.currency)} to ${formatMoney(latest, row.currency)} (${changePct > 0 ? '+' : ''}${changePct}%).`,
      amount: toDisplayAmount(latest),
      detectedAt: new Date().toISOString(),
    })
  }

  const largeTransactions = query<AnomalyTransactionRow>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.amount >= $1 AND t.date >= $2
     ORDER BY t.currency ASC, t.amount DESC`,
    [thresholdCentavos, dayjs().subtract(7, 'day').format('YYYY-MM-DD')]
  )
  for (const row of largeTransactions) {
    anomalies.push({
      id: generateId(),
      type: 'large_transaction',
      severity: row.amount >= thresholdCentavos * 2 ? 'high' : 'medium',
      title: `Large transaction: ${row.description}`,
      description: `${formatMoney(row.amount, row.currency)} expense on ${dayjs(row.date).format('MMM D')}.`,
      transactionId: row.id,
      amount: toDisplayAmount(row.amount),
      detectedAt: new Date().toISOString(),
    })
  }

  const severityRank: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 }
  anomalies.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

  return {
    success: true,
    totalAnomalies: anomalies.length,
    largeTransactionThresholdCurrencyMode: 'per_transaction_currency' as const,
    bySeverity: {
      high: anomalies.filter((item) => item.severity === 'high').length,
      medium: anomalies.filter((item) => item.severity === 'medium').length,
      low: anomalies.filter((item) => item.severity === 'low').length,
    },
    anomalies,
    message:
      anomalies.length === 0
        ? hasMixedCurrencies
          ? 'No spending anomalies detected. Large-transaction thresholds were evaluated independently within each currency.'
          : 'No spending anomalies detected.'
        : hasMixedCurrencies
          ? `Detected ${anomalies.length} anomaly${anomalies.length === 1 ? '' : 'ies'}. Large-transaction thresholds were evaluated independently within each currency.`
          : `Detected ${anomalies.length} anomaly${anomalies.length === 1 ? '' : 'ies'}.`,
  }
}

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

export async function generateSpendingRecapSummary(type: RecapType, period?: string) {
  const anchor = period ? dayjs(period) : dayjs()
  if (!anchor.isValid()) {
    return {
      success: false,
      message: 'Period must be a valid ISO date in YYYY-MM-DD format.',
    }
  }

  const end =
    type === 'weekly' ? anchor.format('YYYY-MM-DD') : anchor.endOf('month').format('YYYY-MM-DD')
  const start =
    type === 'weekly'
      ? anchor.subtract(6, 'day').format('YYYY-MM-DD')
      : anchor.startOf('month').format('YYYY-MM-DD')

  const previousStart =
    type === 'weekly'
      ? anchor.subtract(13, 'day').format('YYYY-MM-DD')
      : anchor.subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
  const previousEnd =
    type === 'weekly'
      ? anchor.subtract(7, 'day').format('YYYY-MM-DD')
      : anchor.subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

  const currentTotals = query<{ currency: string; type: string; total: number }>(
    `SELECT currency, type, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type IN ('expense', 'income') AND date >= $1 AND date <= $2
     GROUP BY currency, type`,
    [start, end]
  )
  const previousTotals = query<{ currency: string; type: string; total: number }>(
    `SELECT currency, type, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type IN ('expense', 'income') AND date >= $1 AND date <= $2
     GROUP BY currency, type`,
    [previousStart, previousEnd]
  )
  const categories = query<{
    currency: string
    category_name: string
    total: number
    count: number
  }>(
    `SELECT t.currency, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.currency, c.name
     ORDER BY t.currency ASC, total DESC`,
    [start, end]
  )
  const biggestExpenseRows = query<{
    currency: string
    description: string
    amount: number
    category_name: string
  }>(
    `SELECT t.currency, t.description, t.amount, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     ORDER BY t.currency ASC, t.amount DESC`,
    [start, end]
  )

  const currencies = uniqueCurrencies(currentTotals, previousTotals, categories, biggestExpenseRows)
  const currentTotalsByCurrency = new Map<string, { income: number; expense: number }>()
  for (const row of currentTotals) {
    const totals = currentTotalsByCurrency.get(row.currency) ?? { income: 0, expense: 0 }
    if (row.type === 'income') totals.income = row.total
    if (row.type === 'expense') totals.expense = row.total
    currentTotalsByCurrency.set(row.currency, totals)
  }
  const previousTotalsByCurrency = new Map<string, { income: number; expense: number }>()
  for (const row of previousTotals) {
    const totals = previousTotalsByCurrency.get(row.currency) ?? { income: 0, expense: 0 }
    if (row.type === 'income') totals.income = row.total
    if (row.type === 'expense') totals.expense = row.total
    previousTotalsByCurrency.set(row.currency, totals)
  }
  const biggestExpenseByCurrency = new Map<string, (typeof biggestExpenseRows)[number]>()
  for (const row of biggestExpenseRows) {
    if (!biggestExpenseByCurrency.has(row.currency)) {
      biggestExpenseByCurrency.set(row.currency, row)
    }
  }

  const summaryParts: string[] = []
  const highlights: RecapHighlight[] = []
  const weeklyLabel = `${dayjs(start).format('MMM D')} - ${dayjs(end).format('MMM D')}`
  const monthLabel = anchor.format('MMMM YYYY')

  if (currencies.length > 1) {
    const totalsByCurrency = currencies.map((currency) => {
      const current = currentTotalsByCurrency.get(currency) ?? { income: 0, expense: 0 }
      const previous = previousTotalsByCurrency.get(currency) ?? { income: 0, expense: 0 }
      const topCategories = categories
        .filter((category) => category.currency === currency)
        .slice(0, type === 'weekly' ? 3 : 5)
        .map((category) => ({
          category: category.category_name,
          total: toDisplayAmount(category.total),
          count: category.count,
        }))
      const biggestExpense = biggestExpenseByCurrency.get(currency)
      const savings = current.income - current.expense
      const savingsRate = current.income > 0 ? Math.round((savings / current.income) * 100) : 0

      return {
        currency,
        totalExpenses: toDisplayAmount(current.expense),
        totalIncome: toDisplayAmount(current.income),
        previousExpenses: toDisplayAmount(previous.expense),
        previousIncome: toDisplayAmount(previous.income),
        expenseChange: percentageChange(current.expense, previous.expense),
        incomeChange: percentageChange(current.income, previous.income),
        savings: type === 'monthly' ? toDisplayAmount(Math.max(savings, 0)) : undefined,
        savingsRate: type === 'monthly' ? savingsRate : undefined,
        topCategories,
        biggestExpense: biggestExpense
          ? {
              description: biggestExpense.description,
              amount: toDisplayAmount(biggestExpense.amount),
              category: biggestExpense.category_name,
            }
          : null,
      }
    })
    const hasCurrentActivity = totalsByCurrency.some(
      (totals) => totals.totalExpenses > 0 || totals.totalIncome > 0
    )

    if (!hasCurrentActivity) {
      summaryParts.push(
        type === 'weekly'
          ? 'No transactions recorded during this week.'
          : `No transactions recorded for ${monthLabel}.`
      )
    } else {
      summaryParts.push(
        `This ${type === 'weekly' ? 'period' : 'month'} spans ${totalsByCurrency.length} currencies, so amounts are shown separately with no FX conversion.`
      )
      for (const totals of totalsByCurrency) {
        if (type === 'weekly') {
          summaryParts.push(
            `${totals.currency}: spent ${formatMoney(Math.round(totals.totalExpenses * 100), totals.currency)} and earned ${formatMoney(Math.round(totals.totalIncome * 100), totals.currency)}.`
          )
        } else {
          summaryParts.push(
            `${totals.currency}: earned ${formatMoney(Math.round(totals.totalIncome * 100), totals.currency)} and spent ${formatMoney(Math.round(totals.totalExpenses * 100), totals.currency)}, saving ${formatMoney(Math.round((totals.savings ?? 0) * 100), totals.currency)} (${totals.savingsRate ?? 0}% savings rate).`
          )
        }

        if (totals.topCategories.length > 0) {
          summaryParts.push(
            `${totals.currency} top categories: ${totals.topCategories
              .map(
                (category) =>
                  `${category.category} (${formatMoney(Math.round(category.total * 100), totals.currency)})`
              )
              .join(type === 'weekly' ? ', ' : '; ')}.`
          )
        }
        if (totals.biggestExpense) {
          summaryParts.push(
            `${totals.currency} biggest expense: ${totals.biggestExpense.description} at ${formatMoney(Math.round(totals.biggestExpense.amount * 100), totals.currency)}.`
          )
        }

        highlights.push({
          label: `${totals.currency} ${type === 'weekly' ? 'Spent' : 'Income'}`,
          value:
            type === 'weekly'
              ? formatMoney(Math.round(totals.totalExpenses * 100), totals.currency)
              : formatMoney(Math.round(totals.totalIncome * 100), totals.currency),
          change: type === 'weekly' ? totals.expenseChange : totals.incomeChange,
        })
        highlights.push({
          label: `${totals.currency} ${type === 'weekly' ? 'Earned' : 'Expenses'}`,
          value:
            type === 'weekly'
              ? formatMoney(Math.round(totals.totalIncome * 100), totals.currency)
              : formatMoney(Math.round(totals.totalExpenses * 100), totals.currency),
          change: type === 'weekly' ? totals.incomeChange : totals.expenseChange,
        })
        if (type === 'monthly') {
          highlights.push({
            label: `${totals.currency} Savings Rate`,
            value: `${totals.savingsRate ?? 0}%`,
          })
        }
      }
    }

    const record = buildRecapRecord(
      type,
      start,
      end,
      type === 'weekly' ? `Weekly Recap: ${weeklyLabel}` : `Monthly Recap: ${monthLabel}`,
      summaryParts.join(' '),
      highlights
    )
    await saveRecap(record)

    return {
      success: true,
      recap: record,
      totalsByCurrency,
      message: `Generated ${type} recap with per-currency totals. See totalsByCurrency for exact figures; no FX conversion was applied.`,
    }
  }

  const summaryCurrency = currencies[0] ?? 'USD'
  const totals = currentTotalsByCurrency.get(summaryCurrency) ?? { income: 0, expense: 0 }
  const previous = previousTotalsByCurrency.get(summaryCurrency) ?? { income: 0, expense: 0 }
  const totalExpenses = totals.expense
  const totalIncome = totals.income
  const previousExpenses = previous.expense
  const previousIncome = previous.income
  const categoriesForCurrency = categories.filter(
    (category) => category.currency === summaryCurrency
  )
  const biggestExpense = biggestExpenseByCurrency.get(summaryCurrency)
  const expenseChange = percentageChange(totalExpenses, previousExpenses)
  const incomeChange = percentageChange(totalIncome, previousIncome)

  if (type === 'weekly') {
    if (totalExpenses === 0 && totalIncome === 0) {
      summaryParts.push('No transactions recorded during this week.')
    } else {
      summaryParts.push(
        `This week you spent ${formatMoney(totalExpenses, summaryCurrency)} and earned ${formatMoney(totalIncome, summaryCurrency)}.`
      )
      if (categoriesForCurrency.length > 0) {
        summaryParts.push(
          `Top categories: ${categoriesForCurrency
            .slice(0, 3)
            .map(
              (category) =>
                `${category.category_name} (${formatMoney(category.total, summaryCurrency)})`
            )
            .join(', ')}.`
        )
      }
      if (biggestExpense) {
        summaryParts.push(
          `Biggest expense: ${biggestExpense.description} at ${formatMoney(biggestExpense.amount, summaryCurrency)}.`
        )
      }
    }

    highlights.push({
      label: 'Total Spent',
      value: formatMoney(totalExpenses, summaryCurrency),
      change: expenseChange,
    })
    highlights.push({
      label: 'Total Earned',
      value: formatMoney(totalIncome, summaryCurrency),
      change: incomeChange,
    })
    if (categoriesForCurrency[0]) {
      highlights.push({
        label: 'Top Category',
        value: `${categoriesForCurrency[0].category_name} ${formatMoney(categoriesForCurrency[0].total, summaryCurrency)}`,
      })
    }

    const record = buildRecapRecord(
      'weekly',
      start,
      end,
      `Weekly Recap: ${weeklyLabel}`,
      summaryParts.join(' '),
      highlights
    )
    await saveRecap(record)
    return {
      success: true,
      recap: record,
      message: `Generated weekly recap for ${weeklyLabel}.`,
    }
  }

  const budgets = query<{ name: string; budget_amount: number; spent: number }>(
    `SELECT b.name, b.amount AS budget_amount,
            COALESCE((SELECT SUM(t.amount) FROM transactions t
              WHERE t.category_id = b.category_id AND t.type = 'expense'
              AND t.date >= $1 AND t.date <= $2), 0) AS spent
     FROM budgets b WHERE b.is_active = 1`,
    [start, end]
  )
  const savings = totalIncome - totalExpenses
  const savingsRate = totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0

  if (totalExpenses === 0 && totalIncome === 0) {
    summaryParts.push(`No transactions recorded for ${monthLabel}.`)
  } else {
    summaryParts.push(
      `In ${monthLabel}, you earned ${formatMoney(totalIncome, summaryCurrency)} and spent ${formatMoney(totalExpenses, summaryCurrency)}, saving ${formatMoney(Math.max(savings, 0), summaryCurrency)} (${savingsRate}% savings rate).`
    )
    if (categoriesForCurrency.length > 0) {
      summaryParts.push(
        `Top spending categories: ${categoriesForCurrency
          .slice(0, 5)
          .map(
            (category) =>
              `${category.category_name} (${formatMoney(category.total, summaryCurrency)})`
          )
          .join('; ')}.`
      )
    }
    if (biggestExpense) {
      summaryParts.push(
        `Largest single expense was ${biggestExpense.description} at ${formatMoney(biggestExpense.amount, summaryCurrency)}.`
      )
    }
    const overBudget = budgets.filter((budget) => budget.spent > budget.budget_amount)
    if (overBudget.length > 0) {
      summaryParts.push(`Over budget on: ${overBudget.map((budget) => budget.name).join(', ')}.`)
    }
  }

  highlights.push({
    label: 'Total Income',
    value: formatMoney(totalIncome, summaryCurrency),
    change: incomeChange,
  })
  highlights.push({
    label: 'Total Expenses',
    value: formatMoney(totalExpenses, summaryCurrency),
    change: expenseChange,
  })
  highlights.push({ label: 'Savings Rate', value: `${savingsRate}%` })
  if (categoriesForCurrency[0]) {
    highlights.push({
      label: 'Top Category',
      value: `${categoriesForCurrency[0].category_name} ${formatMoney(categoriesForCurrency[0].total, summaryCurrency)}`,
    })
  }

  const record = buildRecapRecord(
    'monthly',
    start,
    end,
    `Monthly Recap: ${monthLabel}`,
    summaryParts.join(' '),
    highlights
  )
  await saveRecap(record)
  return {
    success: true,
    recap: record,
    message: `Generated monthly recap for ${monthLabel}.`,
  }
}

export async function getEducationTipSummary(input: {
  topic?: EducationTopic
  action?: string
  query?: string
}) {
  let tip: EducationTip | undefined
  let source = 'daily'

  if (input.action) {
    const mappedTipId = ACTION_TO_TIP[input.action]
    if (mappedTipId) {
      tip = EDUCATION_TIPS.find((entry) => entry.id === mappedTipId)
      source = 'action'
    }
  }

  if (!tip && input.topic) {
    tip = EDUCATION_TIPS.find((entry) => entry.topic === input.topic)
    source = 'topic'
  }

  if (!tip && input.query) {
    const normalized = input.query.toLowerCase()
    tip = EDUCATION_TIPS.find(
      (entry) =>
        entry.id.includes(normalized) ||
        entry.title.toLowerCase().includes(normalized) ||
        entry.content.toLowerCase().includes(normalized)
    )
    source = 'query'
  }

  if (!tip) {
    tip = getDailyEducationTip()
  }

  return {
    success: true,
    tip,
    source,
    disclaimer:
      'This is educational information, not financial advice. Consider consulting a qualified financial professional for personalized guidance.',
    message: `Selected education tip: ${tip.title}.`,
  }
}
