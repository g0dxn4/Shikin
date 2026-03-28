import { create } from 'zustand'
import { query } from '@/lib/database'
import { fromCentavos } from '@/lib/money'
import dayjs from 'dayjs'

// ── Types ─────────────────────────────────────────────────────────────────

export interface CategorySpending {
  categoryId: string | null
  categoryName: string
  categoryColor: string
  amount: number // dollars
}

export interface SpendingComparison {
  categoryName: string
  categoryColor: string
  current: number // dollars
  previous: number // dollars
  change: number // dollars (positive = spending more)
  changePercent: number
}

export interface SpendingInsight {
  id: string
  type: 'increase' | 'decrease' | 'new' | 'gone'
  categoryName: string
  categoryColor: string
  message: string
  amount: number
  changePercent: number
  severity: 'info' | 'warning' | 'alert'
}

interface SpendingInsightsState {
  // MoM comparisons
  momComparisons: SpendingComparison[]
  momCurrentTotal: number
  momPreviousTotal: number

  // YoY comparisons
  yoyComparisons: SpendingComparison[]
  yoyCurrentTotal: number
  yoyPreviousTotal: number

  // "You're spending more on X" insights
  insights: SpendingInsight[]

  isLoading: boolean

  loadComparisons: () => Promise<void>
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface RawRow {
  category_id: string | null
  category_name: string | null
  category_color: string | null
  total: number
}

async function getSpendingByCategory(
  startDate: string,
  endDate: string
): Promise<CategorySpending[]> {
  const rows = await query<RawRow>(
    `SELECT
       t.category_id,
       c.name as category_name,
       c.color as category_color,
       COALESCE(SUM(t.amount), 0) as total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.type = 'expense'
       AND t.date >= ?
       AND t.date <= ?
     GROUP BY t.category_id
     ORDER BY total DESC`,
    [startDate, endDate]
  )

  return rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name || 'Uncategorized',
    categoryColor: r.category_color || '#6b7280',
    amount: fromCentavos(r.total),
  }))
}

function buildComparisons(
  current: CategorySpending[],
  previous: CategorySpending[]
): SpendingComparison[] {
  const prevMap = new Map(previous.map((p) => [p.categoryName, p]))
  const allCategories = new Set([
    ...current.map((c) => c.categoryName),
    ...previous.map((p) => p.categoryName),
  ])

  const comparisons: SpendingComparison[] = []

  for (const name of allCategories) {
    const curr = current.find((c) => c.categoryName === name)
    const prev = prevMap.get(name)
    const currentAmt = curr?.amount ?? 0
    const previousAmt = prev?.amount ?? 0
    const change = currentAmt - previousAmt
    const changePercent = previousAmt > 0 ? (change / previousAmt) * 100 : currentAmt > 0 ? 100 : 0

    comparisons.push({
      categoryName: name,
      categoryColor: curr?.categoryColor ?? prev?.categoryColor ?? '#6b7280',
      current: currentAmt,
      previous: previousAmt,
      change,
      changePercent,
    })
  }

  // Sort by absolute change descending
  return comparisons.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}

function generateInsights(
  momComparisons: SpendingComparison[],
  avg3mByCategory: Map<string, number>
): SpendingInsight[] {
  const insights: SpendingInsight[] = []
  let counter = 0

  for (const comp of momComparisons) {
    // Skip tiny amounts
    if (comp.current < 5 && comp.previous < 5) continue

    const avg3m = avg3mByCategory.get(comp.categoryName) ?? 0

    // "Spending more on X" — current month significantly above 3-month average
    if (avg3m > 0 && comp.current > avg3m * 1.2) {
      const overPercent = ((comp.current - avg3m) / avg3m) * 100
      const severity: SpendingInsight['severity'] =
        overPercent > 50 ? 'alert' : overPercent > 25 ? 'warning' : 'info'

      insights.push({
        id: `insight-${counter++}`,
        type: 'increase',
        categoryName: comp.categoryName,
        categoryColor: comp.categoryColor,
        message: `${comp.categoryName} is up ${Math.round(overPercent)}% vs your 3-month average`,
        amount: comp.current - avg3m,
        changePercent: overPercent,
        severity,
      })
    }

    // Spending dropped significantly
    if (avg3m > 10 && comp.current < avg3m * 0.5) {
      const dropPercent = ((avg3m - comp.current) / avg3m) * 100
      insights.push({
        id: `insight-${counter++}`,
        type: 'decrease',
        categoryName: comp.categoryName,
        categoryColor: comp.categoryColor,
        message: `${comp.categoryName} is down ${Math.round(dropPercent)}% vs your 3-month average`,
        amount: avg3m - comp.current,
        changePercent: -dropPercent,
        severity: 'info',
      })
    }

    // New spending category this month
    if (comp.previous === 0 && comp.current > 20 && avg3m === 0) {
      insights.push({
        id: `insight-${counter++}`,
        type: 'new',
        categoryName: comp.categoryName,
        categoryColor: comp.categoryColor,
        message: `New spending: ${comp.categoryName} ($${comp.current.toFixed(0)} this month)`,
        amount: comp.current,
        changePercent: 100,
        severity: 'info',
      })
    }
  }

  // Sort by severity: alert > warning > info
  const severityOrder = { alert: 0, warning: 1, info: 2 }
  return insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}

// ── Store ─────────────────────────────────────────────────────────────────

export const useSpendingInsightsStore = create<SpendingInsightsState>((set) => ({
  momComparisons: [],
  momCurrentTotal: 0,
  momPreviousTotal: 0,
  yoyComparisons: [],
  yoyCurrentTotal: 0,
  yoyPreviousTotal: 0,
  insights: [],
  isLoading: false,

  loadComparisons: async () => {
    set({ isLoading: true })
    try {
      const now = dayjs()

      // Month-over-month
      const currentMonthStart = now.startOf('month').format('YYYY-MM-DD')
      const currentMonthEnd = now.endOf('month').format('YYYY-MM-DD')
      const prevMonthStart = now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
      const prevMonthEnd = now.subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

      const [currentMonth, prevMonth] = await Promise.all([
        getSpendingByCategory(currentMonthStart, currentMonthEnd),
        getSpendingByCategory(prevMonthStart, prevMonthEnd),
      ])

      const momComparisons = buildComparisons(currentMonth, prevMonth)
      const momCurrentTotal = currentMonth.reduce((s, c) => s + c.amount, 0)
      const momPreviousTotal = prevMonth.reduce((s, c) => s + c.amount, 0)

      // Year-over-year (same month last year)
      const sameMonthLastYearStart = now.subtract(1, 'year').startOf('month').format('YYYY-MM-DD')
      const sameMonthLastYearEnd = now.subtract(1, 'year').endOf('month').format('YYYY-MM-DD')

      const sameMonthLastYear = await getSpendingByCategory(
        sameMonthLastYearStart,
        sameMonthLastYearEnd
      )
      const yoyComparisons = buildComparisons(currentMonth, sameMonthLastYear)
      const yoyCurrentTotal = momCurrentTotal
      const yoyPreviousTotal = sameMonthLastYear.reduce((s, c) => s + c.amount, 0)

      // 3-month average for insights
      const threeMonthStart = now.subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
      const threeMonthSpending = await getSpendingByCategory(threeMonthStart, prevMonthEnd)
      const avg3mByCategory = new Map<string, number>()
      for (const cat of threeMonthSpending) {
        avg3mByCategory.set(cat.categoryName, cat.amount / 3)
      }

      const insights = generateInsights(momComparisons, avg3mByCategory)

      set({
        momComparisons,
        momCurrentTotal,
        momPreviousTotal,
        yoyComparisons,
        yoyCurrentTotal,
        yoyPreviousTotal,
        insights,
      })
    } finally {
      set({ isLoading: false })
    }
  },
}))
