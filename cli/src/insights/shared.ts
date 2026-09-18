import { writeAuditLog } from '../tools/shared.js'
import { readBudgetSpending } from '../reporting-read.js'
import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear.js'
import { query, execute, transaction } from '../database.js'
import { generateId } from '../ulid.js'
import { fromCentavos, formatMoney } from '../money.js'
import { noteExists, writeNote } from '../notebook.js'
export {
  ACTION_TO_TIP,
  EDUCATION_TIPS,
  getDailyEducationTip,
  type EducationTip,
  type EducationTopic,
} from './education-content.js'

dayjs.extend(weekOfYear)

export { dayjs, query, generateId, formatMoney, noteExists, writeNote }

export const UNCATEGORIZED = 'Uncategorized'

export type SubscriptionBillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
export type RecapType = 'weekly' | 'monthly'
export type HealthTrend = 'improving' | 'declining' | 'stable'
type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type AnomalySeverity = 'low' | 'medium' | 'high'
export type AnomalyType =
  | 'unusual_amount'
  | 'duplicate_charge'
  | 'spending_spike'
  | 'subscription_price_change'
  | 'large_transaction'

export type SubscriptionRow = {
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

export type AnomalyTransactionRow = {
  id: string
  description: string
  amount: number
  currency: string
  date: string
  category_id: string | null
  category_name: string | null
  type: string
}

export type CategorySpendRow = {
  currency: string
  category_id: string | null
  category_name: string
  total: number
  count: number
}

export type RecapHighlight = {
  label: string
  value: string
  change?: string
}

export type RecapRecord = {
  id: string
  type: RecapType
  period_start: string
  period_end: string
  title: string
  summary: string
  highlights: RecapHighlight[]
  generated_at: string
  basis: 'gross_cashflow'
  currencies: string[]
  currencyScope: 'all'
}

export type BudgetScoreRow = {
  id: string
  amount: number
  category_id: string | null
  period: string
}

export type ReviewHolding = {
  symbol: string
  name: string
  shares: number
  currency: string
  value: number
  gainLossPercent: number
}

export type HealthSubscore = {
  name: string
  score: number
  weight: number
  description: string
  tip: string
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

export function toDisplayAmount(centavos: number): number {
  return Math.round(fromCentavos(centavos) * 100) / 100
}

function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 65) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

export function percentageChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+100%' : '0%'
  const pct = Math.round(((current - previous) / previous) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

export function calculateStdDev(values: number[]): { mean: number; stdDev: number } {
  if (values.length < 3) {
    return { mean: 0, stdDev: 0 }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return { mean, stdDev: Math.sqrt(variance) }
}

export function summarizeCurrencyTotals(
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

export function subscriptionEquivalentAmounts(
  amount: number,
  billingCycle: SubscriptionBillingCycle
) {
  return {
    monthlyAmount: fromCentavos(amount * getMonthlyMultiplier(billingCycle)),
    yearlyAmount: fromCentavos(amount * getYearlyMultiplier(billingCycle)),
  }
}

export function uniqueCurrencies(...groups: Array<Array<{ currency: string }>>): string[] {
  return [
    ...new Set(groups.flatMap((group) => group.map((row) => row.currency).filter(Boolean))),
  ].sort((a, b) => a.localeCompare(b))
}

export function getDailySubscriptionCost(
  amount: number,
  billingCycle: SubscriptionBillingCycle
): number {
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

export function buildCashFlowForecast(
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

export function createSavingsRateSubscore(
  monthlyIncome: number,
  monthlyExpenses: number
): HealthSubscore {
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

export function createBudgetAdherenceSubscore(
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

    const spending = readBudgetSpending(budget.category_id, start, today)
    if (!spending.success) {
      return {
        name: 'Budget Adherence',
        score: 0,
        weight: 0,
        description: spending.message,
        tip: 'Resolve incomplete budget reporting before using this subscore.',
      }
    }
    const spent = spending.total
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

export function createDebtToIncomeSubscore(
  monthlyIncome: number,
  debtBalance: number
): HealthSubscore {
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

export function createEmergencyFundSubscore(
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

export function createSpendingConsistencySubscore(monthlyExpenseTotals: number[]): HealthSubscore {
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

export function summarizeHealthScores(subscores: HealthSubscore[]) {
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

export function buildRecapRecord(
  type: RecapType,
  start: string,
  end: string,
  title: string,
  summary: string,
  highlights: RecapHighlight[],
  currencies: string[]
): RecapRecord {
  return {
    id: generateId(),
    basis: 'gross_cashflow',
    currencyScope: 'all',
    currencies: [...currencies].sort(),
    type,
    period_start: start,
    period_end: end,
    title,
    summary,
    highlights,
    generated_at: new Date().toISOString(),
  }
}

export async function saveRecap(record: RecapRecord): Promise<void> {
  // Explicit save writes only recaps and audit_log, atomically. Unchanged re-saves are no-ops.
  transaction(() => {
    // Every recap in the current schema is gross_cashflow with currencyScope=all.
    // Logical identity is (type, inclusive period, gross_cashflow, all), NOT the
    // currencies observed in today's data. Reuse the latest matching ULID; preserve
    // any historical duplicates. A future basis needs an explicit schema dimension.
    const before = query<RecapRecord & { highlights_json: string }>(
      `SELECT * FROM recaps WHERE type = $1 AND period_start = $2 AND period_end = $3
       ORDER BY generated_at DESC, id DESC LIMIT 1`,
      [record.type, record.period_start, record.period_end]
    )[0]
    if (before) record.id = before.id
    const highlightsJson = JSON.stringify(record.highlights)
    if (
      before &&
      before.title === record.title &&
      before.summary === record.summary &&
      before.highlights_json === highlightsJson
    ) {
      record.generated_at = before.generated_at
      return
    }
    execute(
      `INSERT INTO recaps (id, type, period_start, period_end, title, summary, highlights_json, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
         highlights_json = excluded.highlights_json, generated_at = excluded.generated_at`,
      [
        record.id,
        record.type,
        record.period_start,
        record.period_end,
        record.title,
        record.summary,
        highlightsJson,
        record.generated_at,
      ]
    )
    writeAuditLog({
      entity: 'recap',
      entityId: record.id,
      action: before ? 'replace' : 'create',
      before: before ?? null,
      after: record,
      source: 'save-spending-recap',
    })
  })
}
