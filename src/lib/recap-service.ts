import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { formatMoney } from '@/lib/money'
import dayjs from 'dayjs'

export interface RecapHighlight {
  label: string
  value: string
  change?: string
}

export interface Recap {
  id: string
  type: 'weekly' | 'monthly'
  period_start: string
  period_end: string
  title: string
  summary: string
  highlights: RecapHighlight[]
  generated_at: string
}

interface SpendingRow {
  category_name: string
  total: number
  count: number
}

interface TotalRow {
  total: number
}

interface BiggestRow {
  description: string
  amount: number
  category_name: string
}

interface BudgetRow {
  name: string
  budget_amount: number
  spent: number
}

/** Fetch total expenses in a date range */
async function getTotalExpenses(start: string, end: string): Promise<number> {
  const rows = await query<TotalRow>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'expense' AND date >= ? AND date <= ?`,
    [start, end]
  )
  return rows[0]?.total ?? 0
}

/** Fetch total income in a date range */
async function getTotalIncome(start: string, end: string): Promise<number> {
  const rows = await query<TotalRow>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income' AND date >= ? AND date <= ?`,
    [start, end]
  )
  return rows[0]?.total ?? 0
}

/** Fetch spending by category, sorted descending */
async function getSpendingByCategory(start: string, end: string): Promise<SpendingRow[]> {
  return query<SpendingRow>(
    `SELECT COALESCE(c.name, 'Uncategorized') as category_name, SUM(t.amount) as total, COUNT(*) as count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= ? AND t.date <= ?
     GROUP BY c.name
     ORDER BY total DESC`,
    [start, end]
  )
}

/** Fetch the biggest single expense */
async function getBiggestExpense(start: string, end: string): Promise<BiggestRow | null> {
  const rows = await query<BiggestRow>(
    `SELECT t.description, t.amount, COALESCE(c.name, 'Uncategorized') as category_name
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= ? AND t.date <= ?
     ORDER BY t.amount DESC LIMIT 1`,
    [start, end]
  )
  return rows[0] ?? null
}

/** Fetch budget adherence for active budgets */
async function getBudgetAdherence(start: string, end: string): Promise<BudgetRow[]> {
  return query<BudgetRow>(
    `SELECT b.name, b.amount as budget_amount,
       COALESCE((SELECT SUM(t.amount) FROM transactions t
         WHERE t.category_id = b.category_id AND t.type = 'expense'
         AND t.date >= ? AND t.date <= ?), 0) as spent
     FROM budgets b WHERE b.is_active = 1`,
    [start, end]
  )
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+100%' : '0%'
  const pct = Math.round(((current - previous) / previous) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

/** Save a recap to the database */
async function saveRecap(recap: Recap): Promise<void> {
  await execute(
    `INSERT OR REPLACE INTO recaps (id, type, period_start, period_end, title, summary, highlights_json, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recap.id,
      recap.type,
      recap.period_start,
      recap.period_end,
      recap.title,
      recap.summary,
      JSON.stringify(recap.highlights),
      recap.generated_at,
    ]
  )
}

/** Load recaps from database */
export async function loadRecapHistory(limit: number = 20): Promise<Recap[]> {
  interface RecapRow {
    id: string
    type: 'weekly' | 'monthly'
    period_start: string
    period_end: string
    title: string
    summary: string
    highlights_json: string
    generated_at: string
  }
  const rows = await query<RecapRow>(
    'SELECT * FROM recaps ORDER BY generated_at DESC LIMIT ?',
    [limit]
  )
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    period_start: r.period_start,
    period_end: r.period_end,
    title: r.title,
    summary: r.summary,
    highlights: JSON.parse(r.highlights_json) as RecapHighlight[],
    generated_at: r.generated_at,
  }))
}

/** Load the latest recap of a given type */
export async function loadLatestRecap(type: 'weekly' | 'monthly'): Promise<Recap | null> {
  interface RecapRow {
    id: string
    type: 'weekly' | 'monthly'
    period_start: string
    period_end: string
    title: string
    summary: string
    highlights_json: string
    generated_at: string
  }
  const rows = await query<RecapRow>(
    'SELECT * FROM recaps WHERE type = ? ORDER BY generated_at DESC LIMIT 1',
    [type]
  )
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id,
    type: r.type,
    period_start: r.period_start,
    period_end: r.period_end,
    title: r.title,
    summary: r.summary,
    highlights: JSON.parse(r.highlights_json) as RecapHighlight[],
    generated_at: r.generated_at,
  }
}

/**
 * Generate a human-readable weekly recap for the past 7 days.
 */
export async function generateWeeklyRecap(): Promise<Recap> {
  const now = dayjs()
  const end = now.format('YYYY-MM-DD')
  const start = now.subtract(6, 'day').format('YYYY-MM-DD')

  // Previous week for comparison
  const prevEnd = now.subtract(7, 'day').format('YYYY-MM-DD')
  const prevStart = now.subtract(13, 'day').format('YYYY-MM-DD')

  const [totalExpenses, totalIncome, prevExpenses, prevIncome, categories, biggest] =
    await Promise.all([
      getTotalExpenses(start, end),
      getTotalIncome(start, end),
      getTotalExpenses(prevStart, prevEnd),
      getTotalIncome(prevStart, prevEnd),
      getSpendingByCategory(start, end),
      getBiggestExpense(start, end),
    ])

  const top3 = categories.slice(0, 3)
  const expenseChange = pctChange(totalExpenses, prevExpenses)
  const incomeChange = pctChange(totalIncome, prevIncome)

  // Build natural language summary
  const parts: string[] = []

  if (totalExpenses === 0 && totalIncome === 0) {
    parts.push('No transactions recorded this week. A fresh start or a quiet period -- either way, your balances stayed put.')
  } else {
    parts.push(
      `This week you spent ${formatMoney(totalExpenses)} and earned ${formatMoney(totalIncome)}.`
    )

    if (prevExpenses > 0) {
      const direction = totalExpenses > prevExpenses ? 'up' : totalExpenses < prevExpenses ? 'down' : 'flat'
      if (direction !== 'flat') {
        parts.push(`Spending is ${direction} ${expenseChange.replace(/[+-]/, '')} compared to last week.`)
      }
    }

    if (top3.length > 0) {
      const catNames = top3.map((c) => `${c.category_name} (${formatMoney(c.total)})`).join(', ')
      parts.push(`Top categories: ${catNames}.`)
    }

    if (biggest) {
      parts.push(
        `Biggest single expense: ${biggest.description} at ${formatMoney(biggest.amount)} in ${biggest.category_name}.`
      )
    }
  }

  const highlights: RecapHighlight[] = [
    { label: 'Total Spent', value: formatMoney(totalExpenses), change: expenseChange },
    { label: 'Total Earned', value: formatMoney(totalIncome), change: incomeChange },
  ]

  if (top3.length > 0) {
    highlights.push({
      label: 'Top Category',
      value: `${top3[0].category_name} ${formatMoney(top3[0].total)}`,
    })
  }

  if (biggest) {
    highlights.push({
      label: 'Biggest Expense',
      value: `${biggest.description} ${formatMoney(biggest.amount)}`,
    })
  }

  const weekLabel = `${dayjs(start).format('MMM D')} - ${dayjs(end).format('MMM D')}`
  const recap: Recap = {
    id: generateId(),
    type: 'weekly',
    period_start: start,
    period_end: end,
    title: `Weekly Recap: ${weekLabel}`,
    summary: parts.join(' '),
    highlights,
    generated_at: now.toISOString(),
  }

  await saveRecap(recap)
  return recap
}

/**
 * Generate a human-readable monthly recap.
 * @param month Optional ISO date string (YYYY-MM-DD) — uses that month. Defaults to current month.
 */
export async function generateMonthlyRecap(month?: string): Promise<Recap> {
  const target = month ? dayjs(month) : dayjs()
  const start = target.startOf('month').format('YYYY-MM-DD')
  const end = target.endOf('month').format('YYYY-MM-DD')

  // Previous month for comparison
  const prevTarget = target.subtract(1, 'month')
  const prevStart = prevTarget.startOf('month').format('YYYY-MM-DD')
  const prevEnd = prevTarget.endOf('month').format('YYYY-MM-DD')

  const [
    totalExpenses,
    totalIncome,
    prevExpenses,
    prevIncome,
    categories,
    biggest,
    budgets,
  ] = await Promise.all([
    getTotalExpenses(start, end),
    getTotalIncome(start, end),
    getTotalExpenses(prevStart, prevEnd),
    getTotalIncome(prevStart, prevEnd),
    getSpendingByCategory(start, end),
    getBiggestExpense(start, end),
    getBudgetAdherence(start, end),
  ])

  const savings = totalIncome - totalExpenses
  const savingsRate = totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0

  const expenseChange = pctChange(totalExpenses, prevExpenses)
  const incomeChange = pctChange(totalIncome, prevIncome)

  const parts: string[] = []
  const monthName = target.format('MMMM YYYY')

  if (totalExpenses === 0 && totalIncome === 0) {
    parts.push(`No transactions recorded for ${monthName}. Nothing in, nothing out.`)
  } else {
    parts.push(
      `In ${monthName}, you earned ${formatMoney(totalIncome)} and spent ${formatMoney(totalExpenses)}, saving ${formatMoney(Math.max(savings, 0))} (${savingsRate}% savings rate).`
    )

    if (prevExpenses > 0 || prevIncome > 0) {
      const spendDir = totalExpenses > prevExpenses ? 'increased' : totalExpenses < prevExpenses ? 'decreased' : 'stayed the same'
      parts.push(
        `Compared to ${prevTarget.format('MMMM')}, spending ${spendDir} (${expenseChange}) and income changed ${incomeChange}.`
      )
    }

    if (categories.length > 0) {
      const breakdown = categories
        .slice(0, 5)
        .map((c) => {
          const pct = totalExpenses > 0 ? Math.round((c.total / totalExpenses) * 100) : 0
          return `${c.category_name}: ${formatMoney(c.total)} (${pct}%)`
        })
        .join('; ')
      parts.push(`Spending breakdown: ${breakdown}.`)
    }

    if (biggest) {
      parts.push(
        `Largest single expense was ${biggest.description} at ${formatMoney(biggest.amount)}.`
      )
    }

    // Budget adherence
    if (budgets.length > 0) {
      const overBudget = budgets.filter((b) => b.spent > b.budget_amount)
      const underBudget = budgets.filter((b) => b.spent <= b.budget_amount)
      if (overBudget.length > 0) {
        const names = overBudget.map((b) => b.name).join(', ')
        parts.push(`Over budget on: ${names}.`)
      }
      if (underBudget.length > 0 && overBudget.length > 0) {
        parts.push(`Stayed within budget on ${underBudget.length} other${underBudget.length > 1 ? ' categories' : ' category'}.`)
      } else if (underBudget.length > 0) {
        parts.push(`All ${underBudget.length} budget${underBudget.length > 1 ? 's' : ''} stayed on track.`)
      }
    }
  }

  const highlights: RecapHighlight[] = [
    { label: 'Total Income', value: formatMoney(totalIncome), change: incomeChange },
    { label: 'Total Expenses', value: formatMoney(totalExpenses), change: expenseChange },
    { label: 'Savings Rate', value: `${savingsRate}%` },
  ]

  if (categories.length > 0) {
    highlights.push({
      label: 'Top Category',
      value: `${categories[0].category_name} ${formatMoney(categories[0].total)}`,
    })
  }

  if (budgets.length > 0) {
    const overCount = budgets.filter((b) => b.spent > b.budget_amount).length
    highlights.push({
      label: 'Budget Status',
      value: overCount === 0 ? 'All on track' : `${overCount} over budget`,
    })
  }

  const recap: Recap = {
    id: generateId(),
    type: 'monthly',
    period_start: start,
    period_end: end,
    title: `Monthly Recap: ${monthName}`,
    summary: parts.join(' '),
    highlights,
    generated_at: dayjs().toISOString(),
  }

  await saveRecap(recap)
  return recap
}
