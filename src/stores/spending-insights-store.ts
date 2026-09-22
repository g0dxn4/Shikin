import {
  captureReportingContext,
  reportingContextIsCurrent,
  projectGrossRows,
  readGrossLedgerRows,
  sumReportingAmounts,
  type GrossProjection,
  type ReportingContext,
} from '@/lib/dated-reporting-read'
import { create } from 'zustand'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import dayjs from 'dayjs'

interface CategorySpending {
  categoryId: string | null
  categoryName: string
  categoryColor: string
  amount: number
}

export interface SpendingComparison {
  categoryName: string
  categoryColor: string
  current: number
  previous: number
  change: number
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

export type SpendingInsightsReason =
  | 'main_currency_unconfigured'
  | 'missing_exchange_rates'
  | 'invalid_currency_data'
  | 'invalid_category_allocations'
  | 'read_error'
  | null

interface SpendingInsightsState {
  momComparisons: SpendingComparison[]
  momCurrentTotal: number | null
  momPreviousTotal: number | null
  yoyComparisons: SpendingComparison[]
  yoyCurrentTotal: number | null
  yoyPreviousTotal: number | null
  insights: SpendingInsight[]
  isLoading: boolean
  complete: boolean
  currency: string
  missingCurrencies: string[]
  reason: SpendingInsightsReason
  error: string | null
  authority: ReportingContext | null
  evidence: GrossProjection[]
  loadComparisons: () => Promise<void>
}

interface CategorySpendingRead {
  complete: boolean
  currency: string
  missingCurrencies: string[]
  reason: SpendingInsightsReason
  categories: CategorySpending[]
  evidence: GrossProjection
}

async function getSpendingByCategory(
  startDate: string,
  endDate: string,
  context: ReportingContext
): Promise<CategorySpendingRead> {
  const rows = await readGrossLedgerRows(startDate, endDate)
  const evidence = projectGrossRows(
    rows.filter((row) => row.type === 'expense'),
    context
  )
  const merged = new Map<string, CategorySpending>()
  if (evidence.complete)
    for (const parent of evidence.parents)
      for (const row of parent.allocations) {
        const key = row.category_id ?? 'uncategorized'
        const existing = merged.get(key)
        merged.set(key, {
          categoryId: row.category_id ?? null,
          categoryName: row.category_name || existing?.categoryName || 'Uncategorized',
          categoryColor: row.category_color || existing?.categoryColor || '#6b7280',
          amount: sumReportingAmounts([existing?.amount ?? 0, row.convertedAmount!]),
        })
      }
  return {
    complete: evidence.complete,
    currency: context.mainCurrency ?? '',
    missingCurrencies: evidence.missingCurrencies,
    reason: evidence.reason,
    categories: [...merged.values()],
    evidence,
  }
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

  return comparisons.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}

function generateInsights(
  momComparisons: SpendingComparison[],
  avg3mByCategory: Map<string, number>,
  currency: string
): SpendingInsight[] {
  const insights: SpendingInsight[] = []
  let counter = 0

  for (const comp of momComparisons) {
    if (comp.current < 500 && comp.previous < 500) continue

    const avg3m = avg3mByCategory.get(comp.categoryName) ?? 0

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

    if (avg3m > 1000 && comp.current < avg3m * 0.5) {
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

    if (comp.previous === 0 && comp.current > 2000 && avg3m === 0) {
      insights.push({
        id: `insight-${counter++}`,
        type: 'new',
        categoryName: comp.categoryName,
        categoryColor: comp.categoryColor,
        message: `New spending: ${comp.categoryName} (${formatMoney(comp.current, currency)} this month)`,
        amount: comp.current,
        changePercent: 100,
        severity: 'info',
      })
    }
  }

  const severityOrder = { alert: 0, warning: 1, info: 2 }
  return insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}

function incompleteState(
  currency: string,
  missingCurrencies: string[],
  reason: SpendingInsightsReason,
  error: string | null = null
): Omit<SpendingInsightsState, 'isLoading' | 'loadComparisons'> {
  return {
    authority: null,
    evidence: [],
    momComparisons: [],
    momCurrentTotal: null,
    momPreviousTotal: null,
    yoyComparisons: [],
    yoyCurrentTotal: null,
    yoyPreviousTotal: null,
    insights: [],
    complete: false,
    currency,
    missingCurrencies,
    reason,
    error,
  }
}

let insightsRequestId = 0

export const useSpendingInsightsStore = create<SpendingInsightsState>((set) => ({
  authority: null,
  evidence: [],
  momComparisons: [],
  momCurrentTotal: null,
  momPreviousTotal: null,
  yoyComparisons: [],
  yoyCurrentTotal: null,
  yoyPreviousTotal: null,
  insights: [],
  isLoading: false,
  complete: false,
  currency: 'USD',
  missingCurrencies: [],
  reason: null,
  error: null,

  loadComparisons: async () => {
    const requestId = ++insightsRequestId
    const context = captureReportingContext()
    const displayCurrency = context.mainCurrency ?? ''
    set({ ...incompleteState(displayCurrency, [], null), isLoading: true })
    try {
      const now = dayjs(context.today)
      const currentMonthStart = now.startOf('month').format('YYYY-MM-DD')
      const currentMonthEnd = now.endOf('month').format('YYYY-MM-DD')
      const prevMonthStart = now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
      const prevMonthEnd = now.subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

      const [currentMonth, prevMonth] = await Promise.all([
        getSpendingByCategory(currentMonthStart, currentMonthEnd, context),
        getSpendingByCategory(prevMonthStart, prevMonthEnd, context),
      ])

      const sameMonthLastYearStart = now.subtract(1, 'year').startOf('month').format('YYYY-MM-DD')
      const sameMonthLastYearEnd = now.subtract(1, 'year').endOf('month').format('YYYY-MM-DD')
      const sameMonthLastYear = await getSpendingByCategory(
        sameMonthLastYearStart,
        sameMonthLastYearEnd,
        context
      )

      const threeMonthStart = now.subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
      const threeMonthSpending = await getSpendingByCategory(threeMonthStart, prevMonthEnd, context)

      if (requestId !== insightsRequestId || !reportingContextIsCurrent(context)) return

      const reads = [currentMonth, prevMonth, sameMonthLastYear, threeMonthSpending]
      const incomplete = reads.find((read) => !read.complete)
      if (incomplete) {
        const missing = [...new Set(reads.flatMap((read) => read.missingCurrencies))].sort()
        set({
          ...incompleteState(
            displayCurrency,
            missing,
            incomplete.reason ?? 'missing_exchange_rates'
          ),
          authority: context,
          evidence: reads.map((read) => read.evidence),
        })
        return
      }

      const momComparisons = buildComparisons(currentMonth.categories, prevMonth.categories)
      const momCurrentTotal = sumReportingAmounts(currentMonth.categories.map((c) => c.amount))
      const momPreviousTotal = sumReportingAmounts(prevMonth.categories.map((c) => c.amount))
      const yoyComparisons = buildComparisons(currentMonth.categories, sameMonthLastYear.categories)
      const avg3mByCategory = new Map<string, number>()
      for (const cat of threeMonthSpending.categories) {
        avg3mByCategory.set(cat.categoryName, cat.amount / 3)
      }

      set({
        authority: context,
        evidence: reads.map((read) => read.evidence),
        momComparisons,
        momCurrentTotal,
        momPreviousTotal,
        yoyComparisons,
        yoyCurrentTotal: momCurrentTotal,
        yoyPreviousTotal: sumReportingAmounts(sameMonthLastYear.categories.map((c) => c.amount)),
        insights: generateInsights(momComparisons, avg3mByCategory, displayCurrency),
        complete: true,
        currency: displayCurrency,
        missingCurrencies: [],
        reason: null,
        error: null,
      })
    } catch (error) {
      if (requestId !== insightsRequestId || !reportingContextIsCurrent(context)) return
      set(incompleteState(displayCurrency, [], 'read_error', getErrorMessage(error)))
    } finally {
      if (requestId === insightsRequestId) {
        set({ isLoading: false })
      }
    }
  },
}))
