import { create } from 'zustand'
import { isCashFlowEligible } from '@shikin/finance-core'
import { query } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { useCurrencyStore } from '@/stores/currency-store'
import type { ReportingTreatment, TransactionKind } from '@/types/database'
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
  | 'missing_exchange_rates'
  | 'invalid_currency_data'
  | 'read_error'
  | null

interface SpendingInsightsState {
  momComparisons: SpendingComparison[]
  momCurrentTotal: number
  momPreviousTotal: number
  yoyComparisons: SpendingComparison[]
  yoyCurrentTotal: number
  yoyPreviousTotal: number
  insights: SpendingInsight[]
  isLoading: boolean
  complete: boolean
  currency: string
  missingCurrencies: string[]
  reason: SpendingInsightsReason
  error: string | null
  loadComparisons: () => Promise<void>
}

interface RawRow {
  category_id: string | null
  category_name: string | null
  category_color: string | null
  currency: string | null
  type: string
  status: string | null
  reporting_treatment: string | null
  transaction_kind: string | null
  is_archived: number | boolean | null
  total: number
}

interface CategorySpendingRead {
  complete: boolean
  currency: string
  missingCurrencies: string[]
  reason: SpendingInsightsReason
  categories: CategorySpending[]
}

async function getSpendingByCategory(
  startDate: string,
  endDate: string
): Promise<CategorySpendingRead> {
  const currencyState = useCurrencyStore.getState()
  const preferredCurrency = currencyState.preferredCurrency
  const rows = await query<RawRow>(
    `SELECT
       t.category_id,
       c.name as category_name,
       c.color as category_color,
       t.currency,
       t.type,
       t.status,
       t.reporting_treatment,
       t.transaction_kind,
       t.is_archived,
       COALESCE(SUM(t.amount), 0) as total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= ? AND t.date <= ?
     GROUP BY t.category_id, c.name, c.color, t.currency, t.type, t.status,
              t.reporting_treatment, t.transaction_kind, t.is_archived
     ORDER BY total DESC`,
    [startDate, endDate]
  )

  const missingCurrencies = new Set<string>()
  let reason: SpendingInsightsReason = null
  const merged = new Map<string, CategorySpending>()

  for (const row of rows) {
    if (row.type !== 'expense') continue
    if (
      !isCashFlowEligible({
        type: row.type,
        status: row.status ?? 'posted',
        reportingTreatment: (row.reporting_treatment ?? 'normal') as ReportingTreatment,
        transactionKind: (row.transaction_kind ?? 'standard') as TransactionKind,
        isArchived: row.is_archived ?? 0,
      })
    ) {
      continue
    }

    const converted = currencyState.convertToPreferred(row.total, row.currency ?? '')
    if (!converted.complete) {
      for (const currency of converted.missingCurrencies) missingCurrencies.add(currency)
      if (converted.reason === 'invalid_currency_data') {
        reason = 'invalid_currency_data'
        missingCurrencies.add(row.currency?.trim() || 'unknown')
      } else {
        reason = reason ?? 'missing_exchange_rates'
      }
      continue
    }

    const key = row.category_id ?? 'uncategorized'
    const existing = merged.get(key)
    merged.set(key, {
      categoryId: row.category_id,
      categoryName: row.category_name || existing?.categoryName || 'Uncategorized',
      categoryColor: row.category_color || existing?.categoryColor || '#6b7280',
      amount: (existing?.amount ?? 0) + converted.amountCentavos,
    })
  }

  if (missingCurrencies.size > 0) {
    return {
      complete: false,
      currency: preferredCurrency,
      missingCurrencies: [...missingCurrencies].sort(),
      reason,
      categories: [],
    }
  }

  return {
    complete: true,
    currency: preferredCurrency,
    missingCurrencies: [],
    reason: null,
    categories: [...merged.values()],
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
    momComparisons: [],
    momCurrentTotal: 0,
    momPreviousTotal: 0,
    yoyComparisons: [],
    yoyCurrentTotal: 0,
    yoyPreviousTotal: 0,
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
  momComparisons: [],
  momCurrentTotal: 0,
  momPreviousTotal: 0,
  yoyComparisons: [],
  yoyCurrentTotal: 0,
  yoyPreviousTotal: 0,
  insights: [],
  isLoading: false,
  complete: true,
  currency: 'USD',
  missingCurrencies: [],
  reason: null,
  error: null,

  loadComparisons: async () => {
    const requestId = ++insightsRequestId
    const displayCurrency = useCurrencyStore.getState().preferredCurrency
    set({ isLoading: true, error: null })
    try {
      const now = dayjs()
      const currentMonthStart = now.startOf('month').format('YYYY-MM-DD')
      const currentMonthEnd = now.endOf('month').format('YYYY-MM-DD')
      const prevMonthStart = now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
      const prevMonthEnd = now.subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

      const [currentMonth, prevMonth] = await Promise.all([
        getSpendingByCategory(currentMonthStart, currentMonthEnd),
        getSpendingByCategory(prevMonthStart, prevMonthEnd),
      ])

      const sameMonthLastYearStart = now.subtract(1, 'year').startOf('month').format('YYYY-MM-DD')
      const sameMonthLastYearEnd = now.subtract(1, 'year').endOf('month').format('YYYY-MM-DD')
      const sameMonthLastYear = await getSpendingByCategory(
        sameMonthLastYearStart,
        sameMonthLastYearEnd
      )

      const threeMonthStart = now.subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
      const threeMonthSpending = await getSpendingByCategory(threeMonthStart, prevMonthEnd)

      if (requestId !== insightsRequestId) return

      const reads = [currentMonth, prevMonth, sameMonthLastYear, threeMonthSpending]
      const incomplete = reads.find((read) => !read.complete)
      if (incomplete) {
        const missing = [...new Set(reads.flatMap((read) => read.missingCurrencies))].sort()
        set(
          incompleteState(displayCurrency, missing, incomplete.reason ?? 'missing_exchange_rates')
        )
        return
      }

      const momComparisons = buildComparisons(currentMonth.categories, prevMonth.categories)
      const momCurrentTotal = currentMonth.categories.reduce((s, c) => s + c.amount, 0)
      const momPreviousTotal = prevMonth.categories.reduce((s, c) => s + c.amount, 0)
      const yoyComparisons = buildComparisons(currentMonth.categories, sameMonthLastYear.categories)
      const avg3mByCategory = new Map<string, number>()
      for (const cat of threeMonthSpending.categories) {
        avg3mByCategory.set(cat.categoryName, cat.amount / 3)
      }

      set({
        momComparisons,
        momCurrentTotal,
        momPreviousTotal,
        yoyComparisons,
        yoyCurrentTotal: momCurrentTotal,
        yoyPreviousTotal: sameMonthLastYear.categories.reduce((s, c) => s + c.amount, 0),
        insights: generateInsights(momComparisons, avg3mByCategory, displayCurrency),
        complete: true,
        currency: displayCurrency,
        missingCurrencies: [],
        reason: null,
        error: null,
      })
    } catch (error) {
      if (requestId !== insightsRequestId) return
      set(incompleteState(displayCurrency, [], 'read_error', getErrorMessage(error)))
    } finally {
      if (requestId === insightsRequestId) {
        set({ isLoading: false })
      }
    }
  },
}))
