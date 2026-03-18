import { query } from '@/lib/database'
import { fromCentavos } from '@/lib/money'
import dayjs from 'dayjs'

export interface SubScore {
  name: string
  score: number
  weight: number
  description: string
  tip: string
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'
export type Trend = 'improving' | 'declining' | 'stable'

export interface HealthScore {
  overall: number
  grade: Grade
  subscores: SubScore[]
  trend: Trend
  tips: string[]
  calculatedAt: string
}

function scoreToGrade(score: number): Grade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 65) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

function determineTrend(history: { score: number }[]): Trend {
  if (history.length < 2) return 'stable'
  const recent = history[history.length - 1].score
  const previous = history[history.length - 2].score
  const diff = recent - previous
  if (diff >= 5) return 'improving'
  if (diff <= -5) return 'declining'
  return 'stable'
}

async function calculateSavingsRate(): Promise<SubScore> {
  const start = dayjs().startOf('month').format('YYYY-MM-DD')
  const end = dayjs().format('YYYY-MM-DD')

  const incomeResult = await query<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE type = 'income' AND date >= ? AND date <= ?`,
    [start, end]
  )

  const expenseResult = await query<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE type = 'expense' AND date >= ? AND date <= ?`,
    [start, end]
  )

  const income = incomeResult[0]?.total ?? 0
  const expenses = expenseResult[0]?.total ?? 0

  let score: number
  let tip: string

  if (income <= 0) {
    score = 0
    tip = 'Start tracking your income to unlock savings insights'
  } else {
    const rate = (income - expenses) / income
    if (rate >= 0.2) {
      score = 100
      tip = 'Your savings rate is excellent — keep up the momentum'
    } else if (rate >= 0.1) {
      score = 70
      tip = 'You are saving well — a small spending adjustment could push you above 20%'
    } else if (rate >= 0) {
      score = 40
      tip = 'Look for one recurring expense you could reduce to boost your savings rate'
    } else {
      score = 0
      tip = 'Spending exceeds income this month — review recent transactions for quick wins'
    }
  }

  const rateDisplay = income > 0
    ? `${Math.round(((income - expenses) / income) * 100)}%`
    : 'N/A'

  return {
    name: 'Savings Rate',
    score,
    weight: 0.25,
    description: `Current savings rate: ${rateDisplay}`,
    tip,
  }
}

async function calculateBudgetAdherence(): Promise<SubScore> {
  const budgets = await query<{
    id: string
    amount: number
    category_id: string
    period: string
  }>(
    `SELECT id, amount, category_id, period FROM budgets WHERE is_active = 1`
  )

  if (budgets.length === 0) {
    return {
      name: 'Budget Adherence',
      score: 50,
      weight: 0.2,
      description: 'No active budgets set',
      tip: 'Create budgets for your top spending categories to stay on track',
    }
  }

  let withinCount = 0

  for (const budget of budgets) {
    const today = dayjs()
    let start: string
    const end = today.format('YYYY-MM-DD')

    switch (budget.period) {
      case 'weekly':
        start = today.subtract(6, 'day').format('YYYY-MM-DD')
        break
      case 'yearly':
        start = today.startOf('year').format('YYYY-MM-DD')
        break
      default:
        start = today.startOf('month').format('YYYY-MM-DD')
    }

    const spentResult = await query<{ total: number | null }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE category_id = ? AND type = 'expense' AND date >= ? AND date <= ?`,
      [budget.category_id, start, end]
    )

    const spent = spentResult[0]?.total ?? 0
    if (spent <= budget.amount) {
      withinCount++
    }
  }

  const score = Math.round((withinCount / budgets.length) * 100)

  return {
    name: 'Budget Adherence',
    score,
    weight: 0.2,
    description: `${withinCount} of ${budgets.length} budgets within limit`,
    tip:
      score >= 100
        ? 'All budgets are on track — great discipline'
        : `Focus on the ${budgets.length - withinCount} over-budget categor${budgets.length - withinCount === 1 ? 'y' : 'ies'} to improve your score`,
  }
}

async function calculateDebtToIncome(): Promise<SubScore> {
  // Get credit card balances (negative balance means debt)
  const ccResult = await query<{ total_balance: number | null }>(
    `SELECT COALESCE(SUM(ABS(balance)), 0) as total_balance FROM accounts
     WHERE type = 'credit_card' AND is_archived = 0`
  )

  // Get monthly income (current month)
  const start = dayjs().startOf('month').format('YYYY-MM-DD')
  const end = dayjs().format('YYYY-MM-DD')
  const incomeResult = await query<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE type = 'income' AND date >= ? AND date <= ?`,
    [start, end]
  )

  const debt = ccResult[0]?.total_balance ?? 0
  const income = incomeResult[0]?.total ?? 0

  if (income <= 0) {
    return {
      name: 'Debt-to-Income',
      score: debt === 0 ? 100 : 20,
      weight: 0.2,
      description: debt === 0 ? 'No credit card debt' : 'Track income to measure debt ratio',
      tip: debt === 0
        ? 'No credit card debt — well done'
        : 'Start tracking your income so Val can monitor your debt ratio',
    }
  }

  const ratio = debt / income
  let score: number
  let tip: string

  if (ratio < 0.1) {
    score = 100
    tip = 'Your debt-to-income ratio is very healthy'
  } else if (ratio <= 0.3) {
    score = 60
    tip = 'Consider paying down credit card balances to reduce interest costs'
  } else {
    score = 20
    tip = 'High credit card balances — prioritize paying above the minimum each month'
  }

  return {
    name: 'Debt-to-Income',
    score,
    weight: 0.2,
    description: `Debt ratio: ${Math.round(ratio * 100)}%`,
    tip,
  }
}

async function calculateEmergencyFund(): Promise<SubScore> {
  // Get savings account balances
  const savingsResult = await query<{ total: number | null }>(
    `SELECT COALESCE(SUM(balance), 0) as total FROM accounts
     WHERE type = 'savings' AND is_archived = 0`
  )

  // Get average monthly expenses (last 3 months)
  const threeMonthsAgo = dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  const expenseResult = await query<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE type = 'expense' AND date >= ? AND date <= ?`,
    [threeMonthsAgo, today]
  )

  const savings = savingsResult[0]?.total ?? 0
  const totalExpenses3Mo = expenseResult[0]?.total ?? 0
  const avgMonthlyExpenses = totalExpenses3Mo / 3
  const target = avgMonthlyExpenses * 3 // 3 months of expenses

  if (avgMonthlyExpenses <= 0) {
    return {
      name: 'Emergency Fund',
      score: savings > 0 ? 75 : 50,
      weight: 0.2,
      description: savings > 0
        ? `Savings: $${fromCentavos(savings).toFixed(0)}`
        : 'No savings accounts found',
      tip: savings > 0
        ? 'Track expenses to measure your emergency fund coverage'
        : 'Open a savings account and start building your safety net',
    }
  }

  const coverage = savings / target
  const score = Math.min(100, Math.round(coverage * 100))
  const months = (savings / avgMonthlyExpenses).toFixed(1)

  return {
    name: 'Emergency Fund',
    score,
    weight: 0.2,
    description: `Covers ${months} months of expenses`,
    tip:
      score >= 100
        ? 'Your emergency fund is fully stocked — consider investing the surplus'
        : `Aim for 3 months of expenses — you are ${Math.round(coverage * 100)}% of the way there`,
  }
}

async function calculateSpendingConsistency(): Promise<SubScore> {
  // Get monthly spending for last 6 months
  const monthlyTotals: number[] = []

  for (let i = 5; i >= 0; i--) {
    const m = dayjs().subtract(i, 'month')
    const start = m.startOf('month').format('YYYY-MM-DD')
    const end = m.endOf('month').format('YYYY-MM-DD')

    const result = await query<{ total: number | null }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'expense' AND date >= ? AND date <= ?`,
      [start, end]
    )

    monthlyTotals.push(result[0]?.total ?? 0)
  }

  const nonZeroMonths = monthlyTotals.filter((v) => v > 0)

  if (nonZeroMonths.length < 2) {
    return {
      name: 'Spending Consistency',
      score: 50,
      weight: 0.15,
      description: 'Not enough data yet',
      tip: 'Keep tracking expenses — consistency insights unlock after 2 months of data',
    }
  }

  const mean = nonZeroMonths.reduce((a, b) => a + b, 0) / nonZeroMonths.length
  const variance =
    nonZeroMonths.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / nonZeroMonths.length
  const stdDev = Math.sqrt(variance)
  const cv = mean > 0 ? stdDev / mean : 0 // coefficient of variation

  // cv < 0.1 = very consistent, cv > 0.5 = very inconsistent
  let score: number
  if (cv <= 0.1) score = 100
  else if (cv <= 0.25) score = 80
  else if (cv <= 0.4) score = 60
  else if (cv <= 0.6) score = 40
  else score = 20

  return {
    name: 'Spending Consistency',
    score,
    weight: 0.15,
    description: `Variation: ${Math.round(cv * 100)}% across ${nonZeroMonths.length} months`,
    tip:
      score >= 80
        ? 'Your spending is predictable — budgeting is easier when patterns are steady'
        : 'Large swings in monthly spending make budgeting harder — look for irregular big purchases',
  }
}

export async function calculateHealthScore(): Promise<HealthScore> {
  const subscores = await Promise.all([
    calculateSavingsRate(),
    calculateBudgetAdherence(),
    calculateDebtToIncome(),
    calculateEmergencyFund(),
    calculateSpendingConsistency(),
  ])

  const overall = Math.round(
    subscores.reduce((sum, s) => sum + s.score * s.weight, 0)
  )

  // Get historical scores from localStorage for trend
  const historyRaw = localStorage.getItem('valute-health-score-history')
  const history: { date: string; score: number }[] = historyRaw
    ? JSON.parse(historyRaw)
    : []

  const trend = determineTrend(history)

  // Collect top tips (from lowest-scoring subscores first)
  const tips = [...subscores]
    .sort((a, b) => a.score - b.score)
    .filter((s) => s.score < 100)
    .map((s) => s.tip)
    .slice(0, 3)

  if (tips.length === 0) {
    tips.push('Your finances are looking strong across the board')
  }

  return {
    overall,
    grade: scoreToGrade(overall),
    subscores,
    trend,
    tips,
    calculatedAt: new Date().toISOString(),
  }
}
