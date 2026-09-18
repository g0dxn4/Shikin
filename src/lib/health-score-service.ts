import { isCashFlowEligible } from '@shikin/finance-core'
import { query } from '@/lib/database'
import { formatMoney } from '@/lib/money'
import { assertReportingReadComplete, CATEGORY_ALLOCATION_CTE } from '@/lib/reporting-read'
import { load } from '@/lib/storage'
import { useCurrencyStore } from '@/stores/currency-store'
import type { LedgerTreatment, ReportingTreatment, TransactionKind } from '@/types/database'
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

type ReportingRow = {
  type: string
  status: string | null
  ledger_treatment: LedgerTreatment | null
  reporting_treatment: ReportingTreatment | null
  transaction_kind: TransactionKind | null
  is_archived: number | null
  currency: string
  date: string
  category_id: string | null
  amount: number
  invalid_allocations: number
  invalid_reporting_data: number
}

type BudgetRow = { id: string; amount: number; category_id: string | null; period: string }
type AccountRow = { type: string; balance: number; currency: string }

function scoreToGrade(score: number): Grade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 65) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

function determineTrend(history: { score: number }[]): Trend {
  if (history.length < 2) return 'stable'
  const diff = history[history.length - 1].score - history[history.length - 2].score
  if (diff >= 5) return 'improving'
  if (diff <= -5) return 'declining'
  return 'stable'
}

function savingsRateScore(income: number, expenses: number): SubScore {
  const rate = income > 0 ? (income - expenses) / income : null
  const score = rate === null ? 0 : rate >= 0.2 ? 100 : rate >= 0.1 ? 70 : rate >= 0 ? 40 : 0
  return {
    name: 'Savings Rate',
    score,
    weight: 0.25,
    description: `Current savings rate: ${rate === null ? 'N/A' : `${Math.round(rate * 100)}%`}`,
    tip:
      rate === null
        ? 'Start tracking your income to unlock savings insights'
        : rate >= 0.2
          ? 'Your savings rate is excellent — keep up the momentum'
          : rate >= 0.1
            ? 'You are saving well — a small spending adjustment could push you above 20%'
            : rate >= 0
              ? 'Look for one recurring expense you could reduce to boost your savings rate'
              : 'Spending exceeds income this month — review recent transactions for quick wins',
  }
}

function budgetAdherenceScore(budgets: BudgetRow[], spending: Map<string, number>): SubScore {
  if (budgets.length === 0) {
    return {
      name: 'Budget Adherence',
      score: 50,
      weight: 0.2,
      description: 'No active budgets set',
      tip: 'Create budgets for your top spending categories to stay on track',
    }
  }
  const withinCount = budgets.filter(
    (budget) => (spending.get(budget.id) ?? 0) <= budget.amount
  ).length
  const score = Math.round((withinCount / budgets.length) * 100)
  return {
    name: 'Budget Adherence',
    score,
    weight: 0.2,
    description: `${withinCount} of ${budgets.length} budgets within limit`,
    tip:
      score === 100
        ? 'All budgets are on track — great discipline'
        : `Focus on the ${budgets.length - withinCount} over-budget categor${budgets.length - withinCount === 1 ? 'y' : 'ies'} to improve your score`,
  }
}

function debtToIncomeScore(income: number, debt: number): SubScore {
  if (income <= 0) {
    return {
      name: 'Debt-to-Income',
      score: debt === 0 ? 100 : 20,
      weight: 0.2,
      description: debt === 0 ? 'No credit card debt' : 'Track income to measure debt ratio',
      tip:
        debt === 0
          ? 'No credit card debt — well done'
          : 'Start tracking your income to monitor your debt ratio',
    }
  }
  const ratio = debt / income
  return {
    name: 'Debt-to-Income',
    score: ratio < 0.1 ? 100 : ratio <= 0.3 ? 60 : 20,
    weight: 0.2,
    description: `Debt ratio: ${Math.round(ratio * 100)}%`,
    tip:
      ratio < 0.1
        ? 'Your debt-to-income ratio is very healthy'
        : ratio <= 0.3
          ? 'Consider paying down credit card balances to reduce interest costs'
          : 'High credit card balances — prioritize paying above the minimum each month',
  }
}

function emergencyFundScore(savings: number, expenses: number, currency: string): SubScore {
  const average = expenses / 3
  if (average <= 0) {
    return {
      name: 'Emergency Fund',
      score: savings > 0 ? 75 : 50,
      weight: 0.2,
      description:
        savings > 0 ? `Savings: ${formatMoney(savings, currency)}` : 'No savings accounts found',
      tip:
        savings > 0
          ? 'Track expenses to measure your emergency fund coverage'
          : 'Open a savings account and start building your safety net',
    }
  }
  const coverage = savings / (average * 3)
  const score = Math.min(100, Math.round(coverage * 100))
  return {
    name: 'Emergency Fund',
    score,
    weight: 0.2,
    description: `Covers ${(savings / average).toFixed(1)} months of expenses`,
    tip:
      score >= 100
        ? 'Your emergency fund is fully stocked — consider investing the surplus'
        : `Aim for 3 months of expenses — you are ${Math.round(coverage * 100)}% of the way there`,
  }
}

function spendingConsistencyScore(monthlyTotals: number[]): SubScore {
  const nonZero = monthlyTotals.filter((value) => value > 0)
  if (nonZero.length < 2) {
    return {
      name: 'Spending Consistency',
      score: 50,
      weight: 0.15,
      description: 'Not enough data yet',
      tip: 'Keep tracking expenses — consistency insights unlock after 2 months of data',
    }
  }
  const mean = nonZero.reduce((sum, value) => sum + value, 0) / nonZero.length
  const variance = nonZero.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nonZero.length
  const cv = Math.sqrt(variance) / mean
  const score = cv <= 0.1 ? 100 : cv <= 0.25 ? 80 : cv <= 0.4 ? 60 : cv <= 0.6 ? 40 : 20
  return {
    name: 'Spending Consistency',
    score,
    weight: 0.15,
    description: `Variation: ${Math.round(cv * 100)}% across ${nonZero.length} months`,
    tip:
      score >= 80
        ? 'Your spending is predictable — budgeting is easier when patterns are steady'
        : 'Large swings in monthly spending make budgeting harder — look for irregular big purchases',
  }
}

export async function calculateHealthScore(): Promise<HealthScore> {
  const today = dayjs()
  const sixMonthsAgo = today.subtract(5, 'month').startOf('month')
  const readStart = [sixMonthsAgo, today.startOf('year')]
    .map((date) => date.format('YYYY-MM-DD'))
    .sort()[0]
  const readEnd = today.format('YYYY-MM-DD')
  await assertReportingReadComplete(readStart, readEnd)

  const [rows, budgets, accounts] = await Promise.all([
    query<ReportingRow>(
      `${CATEGORY_ALLOCATION_CTE}
       SELECT type, status, ledger_treatment, reporting_treatment, transaction_kind, is_archived,
              currency, date, category_id, amount, invalid_allocations, invalid_reporting_data
       FROM reporting_allocations WHERE date >= ? AND date <= ?`,
      [readStart, readEnd]
    ),
    query<BudgetRow>('SELECT id, amount, category_id, period FROM budgets WHERE is_active = 1'),
    query<AccountRow>(
      "SELECT type, balance, currency FROM accounts WHERE is_archived = 0 AND type IN ('credit_card', 'savings')"
    ),
  ])

  const { convertToPreferred, preferredCurrency } = useCurrencyStore.getState()
  const convert = (amount: number, currency: string) => {
    if (!Number.isSafeInteger(amount))
      throw new Error('Financial health is unavailable because a centavo total is unsafe.')
    const result = convertToPreferred(amount, currency)
    if (!result.complete)
      throw new Error('Financial health is unavailable until all currencies can be converted.')
    return result.amountCentavos
  }

  const eligible = rows.filter((row) =>
    isCashFlowEligible({
      type: row.type,
      status: row.status,
      ledgerTreatment: row.ledger_treatment,
      reportingTreatment: row.reporting_treatment,
      transactionKind: row.transaction_kind,
      isArchived: row.is_archived,
    })
  )
  if (eligible.some((row) => row.invalid_allocations || row.invalid_reporting_data)) {
    throw new Error('Financial health is unavailable because reporting data requires repair.')
  }

  const convertedRows = eligible.map((row) => ({
    ...row,
    converted: convert(row.amount, row.currency),
  }))
  const sumRows = (selected: typeof convertedRows) => {
    let total = 0
    for (const row of selected) {
      total += row.converted
      if (!Number.isSafeInteger(total)) {
        throw new Error('Financial health is unavailable because a converted total is unsafe.')
      }
    }
    return total
  }
  const monthStart = today.startOf('month').format('YYYY-MM-DD')
  const trailingStart = today.subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
  const current = convertedRows.filter((row) => row.date >= monthStart)
  const income = sumRows(current.filter((row) => row.type === 'income'))
  const expenses = sumRows(current.filter((row) => row.type === 'expense'))
  const trailingExpenses = sumRows(
    convertedRows.filter((row) => row.type === 'expense' && row.date >= trailingStart)
  )

  let savings = 0
  let debt = 0
  for (const account of accounts) {
    if (!Number.isSafeInteger(account.balance))
      throw new Error('Financial health is unavailable because an account balance is unsafe.')
    if (account.type === 'savings') savings += convert(account.balance, account.currency)
    if (account.type === 'credit_card')
      debt += convert(Math.max(-account.balance, 0), account.currency)
    if (!Number.isSafeInteger(savings) || !Number.isSafeInteger(debt)) {
      throw new Error('Financial health is unavailable because an account total is unsafe.')
    }
  }

  const budgetSpending = new Map<string, number>()
  for (const budget of budgets) {
    const start =
      budget.period === 'weekly'
        ? today.subtract(6, 'day').format('YYYY-MM-DD')
        : budget.period === 'yearly'
          ? today.startOf('year').format('YYYY-MM-DD')
          : monthStart
    const planned = convert(budget.amount, 'USD')
    budget.amount = planned
    budgetSpending.set(
      budget.id,
      sumRows(
        convertedRows.filter(
          (row) =>
            row.type === 'expense' &&
            row.date >= start &&
            row.date <= readEnd &&
            (budget.category_id === null || row.category_id === budget.category_id)
        )
      )
    )
  }

  const monthKeys = Array.from({ length: 6 }, (_, index) =>
    today.subtract(5 - index, 'month').format('YYYY-MM')
  )
  const monthlyTotals = monthKeys.map((month) =>
    sumRows(convertedRows.filter((row) => row.type === 'expense' && row.date.startsWith(month)))
  )
  const subscores = [
    savingsRateScore(income, expenses),
    budgetAdherenceScore(budgets, budgetSpending),
    debtToIncomeScore(income, debt),
    emergencyFundScore(savings, trailingExpenses, preferredCurrency),
    spendingConsistencyScore(monthlyTotals),
  ]
  const overall = Math.round(subscores.reduce((sum, score) => sum + score.score * score.weight, 0))

  const store = await load()
  const historyRaw = await store.get('health_score_history')
  const history: { date: string; score: number }[] = historyRaw
    ? typeof historyRaw === 'string'
      ? JSON.parse(historyRaw)
      : (historyRaw as { date: string; score: number }[])
    : []
  const tips = [...subscores]
    .sort((a, b) => a.score - b.score)
    .filter((score) => score.score < 100)
    .map((score) => score.tip)
    .slice(0, 3)
  if (tips.length === 0) tips.push('Your finances are looking strong across the board')

  return {
    overall,
    grade: scoreToGrade(overall),
    subscores,
    trend: determineTrend(history),
    tips,
    calculatedAt: new Date().toISOString(),
  }
}
