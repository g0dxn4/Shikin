import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { isCashFlowEligible } from '@shikin/finance-core'
import {
  aggregateCentavosByCurrency,
  convertCurrencyTotals,
  type ConversionRate,
} from '@shikin/finance-core'
import type { Transaction, TransactionSplitWithCategory } from '@/types/database'

export type DashboardTransaction = Pick<
  Transaction,
  | 'id'
  | 'type'
  | 'amount'
  | 'currency'
  | 'date'
  | 'status'
  | 'reporting_treatment'
  | 'transaction_kind'
  | 'is_archived'
  | 'category_id'
> & {
  category_name?: string | null
  category_color?: string | null
}

export type DashboardSplit = Pick<
  TransactionSplitWithCategory,
  | 'transaction_id'
  | 'category_id'
  | 'category_name'
  | 'category_color'
  | 'amount'
> & {
  date: string
}

export interface DashboardAnalyticsInput {
  transactions: DashboardTransaction[]
  splits: DashboardSplit[]
  preferredCurrency: string
  rates: ConversionRate[]
  now: Dayjs
}

export type ConversionState =
  | { kind: 'complete'; currency: string; missingCurrencies: [] }
  | { kind: 'fallback'; currency: string; missingTarget: string; missingCurrencies: [string] }
  | { kind: 'incomplete'; currency: string; missingCurrencies: string[] }

export interface PacePoint {
  day: number
  current: number | null
  previous: number | null
  priorAverage: number | null
  runRate: number | null
}

export interface PaceResult {
  currentMonth: string
  daysInMonth: number
  todayDay: number
  points: PacePoint[]
  spentMTD: number
  projectedMonthEnd: number
  priorAverageTotal: number
  vsPriorAverage: number
  conversion: ConversionState
}

export interface TrendMonth {
  key: string
  label: string
  isCurrent: boolean
  expenses: number
  income: number
  net: number
  conversion: ConversionState
}

export interface TrendResult {
  months: TrendMonth[]
  totalIncome: number
  totalExpenses: number
  totalNet: number
  conversion: ConversionState
}

export interface CategoryMeta {
  name: string
  color: string | null
}

export interface CategoryMonth {
  key: string
  label: string
  isCurrent: boolean
  byCategoryId: Record<string, number>
}

export interface CategoryBreakdownItem {
  categoryId: string
  name: string
  color: string | null
  amount: number
  percent: number
}

export interface SplitIntegrityNotice {
  transactionId: string
  difference: number
  currency: string
}

export interface CategoriesResult {
  months: CategoryMonth[]
  categoryMeta: Record<string, CategoryMeta>
  topCategoryIds: string[]
  otherCategoryId: string
  currentMonthBreakdown: CategoryBreakdownItem[]
  splitIntegrityNotices: SplitIntegrityNotice[]
  conversion: ConversionState
}

export interface DashboardAnalyticsResult {
  preferredCurrency: string
  conversion: ConversionState
  pace: PaceResult
  trend: TrendResult
  categories: CategoriesResult
}

const UNCATEGORIZED_ID = 'uncategorized'
const OTHER_CATEGORY_ID = 'other'

const CATEGORY_PALETTE = [
  '#7C5CFF',
  '#34D399',
  '#F59E0B',
  '#38BDF8',
  '#F87171',
  '#A78BFA',
  '#FBBF24',
  '#2DD4BF',
  '#FB7185',
  '#60A5FA',
]

function safeNormalizeCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9]{2,10}$/.test(normalized) ? normalized : null
}

function isEligibleForCashFlow(tx: DashboardTransaction): boolean {
  return isCashFlowEligible({
    type: tx.type,
    status: tx.status ?? 'posted',
    reportingTreatment: tx.reporting_treatment ?? 'normal',
    transactionKind: tx.transaction_kind ?? 'standard',
    isArchived: tx.is_archived ?? 0,
  })
}

function buildConversionState(
  amounts: ReadonlyArray<{ currency: string; amountCentavos: number }>,
  preferredCurrency: string,
  rates: ConversionRate[]
): ConversionState {
  const validAmounts: Array<{ currency: string; amountCentavos: number }> = []
  const invalidCurrencies: string[] = []
  for (const amount of amounts) {
    const currency = safeNormalizeCurrency(amount.currency)
    if (!currency) {
      invalidCurrencies.push(amount.currency?.trim() || 'blank')
      continue
    }
    validAmounts.push({ currency, amountCentavos: amount.amountCentavos })
  }

  if (invalidCurrencies.length > 0) {
    return {
      kind: 'incomplete',
      currency: preferredCurrency,
      missingCurrencies: [...new Set(invalidCurrencies)].sort(),
    }
  }

  const preferred = safeNormalizeCurrency(preferredCurrency)
  if (!preferred) {
    return {
      kind: 'incomplete',
      currency: preferredCurrency.toUpperCase(),
      missingCurrencies: [preferredCurrency.toUpperCase()],
    }
  }

  if (validAmounts.length === 0) {
    return { kind: 'complete', currency: preferred, missingCurrencies: [] }
  }

  const totals = aggregateCentavosByCurrency(validAmounts)
  const result = convertCurrencyTotals(totals, preferred, rates)

  if (result.complete) {
    return { kind: 'complete', currency: preferred, missingCurrencies: [] }
  }

  if (result.converted.length === 0 && result.missingCurrencies.length === 1) {
    return {
      kind: 'fallback',
      currency: result.missingCurrencies[0],
      missingTarget: preferred,
      missingCurrencies: [result.missingCurrencies[0]],
    }
  }

  return {
    kind: 'incomplete',
    currency: preferred,
    missingCurrencies: [...result.missingCurrencies],
  }
}

function convertAmounts(
  amounts: ReadonlyArray<{ currency: string; amountCentavos: number }>,
  preferredCurrency: string,
  rates: ConversionRate[]
): { centavos: number; conversion: ConversionState } {
  const state = buildConversionState(amounts, preferredCurrency, rates)

  if (state.kind === 'complete') {
    const validAmounts = amounts
      .map((a) => ({ currency: safeNormalizeCurrency(a.currency), amountCentavos: a.amountCentavos }))
      .filter((a): a is { currency: string; amountCentavos: number } => a.currency !== null)
    const totals = aggregateCentavosByCurrency(validAmounts)
    const result = convertCurrencyTotals(totals, state.currency, rates)
    return { centavos: result.totalCentavos ?? 0, conversion: state }
  }

  if (state.kind === 'fallback') {
    const sourceCurrency = state.currency
    const total = amounts
      .filter((a) => safeNormalizeCurrency(a.currency) === sourceCurrency)
      .reduce((sum, a) => sum + a.amountCentavos, 0)
    return { centavos: total, conversion: state }
  }

  return { centavos: 0, conversion: state }
}

function cumulativeAmountsUpToDay(
  transactions: DashboardTransaction[],
  monthStart: Dayjs,
  maxDay: number
): Array<{ currency: string; amountCentavos: number }> {
  const amounts: Array<{ currency: string; amountCentavos: number }> = []
  const monthKey = monthStart.format('YYYY-MM')
  for (const tx of transactions) {
    const txDate = dayjs(tx.date)
    if (!txDate.isValid()) continue
    if (txDate.format('YYYY-MM') !== monthKey) continue
    if (txDate.date() > maxDay) continue
    amounts.push({ currency: tx.currency, amountCentavos: tx.amount })
  }
  return amounts
}

function totalAmountsInMonth(
  transactions: DashboardTransaction[],
  monthStart: Dayjs
): Array<{ currency: string; amountCentavos: number }> {
  return cumulativeAmountsUpToDay(transactions, monthStart, monthStart.daysInMonth())
}

function averageConvertedCumulative(
  eligibleExpenses: DashboardTransaction[],
  activePriorMonths: { start: Dayjs }[],
  day: number,
  preferredCurrency: string,
  rates: ConversionRate[]
): number {
  let sum = 0
  for (const prior of activePriorMonths) {
    const priorDays = prior.start.daysInMonth()
    const effectiveDay = Math.min(day, priorDays)
    const amounts = cumulativeAmountsUpToDay(eligibleExpenses, prior.start, effectiveDay)
    const { centavos } = convertAmounts(amounts, preferredCurrency, rates)
    sum += centavos
  }
  return activePriorMonths.length > 0 ? Math.round(sum / activePriorMonths.length) : 0
}

export function buildDashboardAnalytics(
  input: DashboardAnalyticsInput
): DashboardAnalyticsResult {
  const { transactions, splits, preferredCurrency, rates, now } = input

  // Split index by transaction id.
  const splitsByTransaction = new Map<string, DashboardSplit[]>()
  for (const split of splits) {
    const list = splitsByTransaction.get(split.transaction_id) ?? []
    list.push(split)
    splitsByTransaction.set(split.transaction_id, list)
  }

  const eligibleTransactions = transactions.filter(isEligibleForCashFlow)
  const eligibleExpenses = eligibleTransactions.filter((tx) => tx.type === 'expense')

  // Global conversion state from every eligible cash-flow amount.
  const allEligibleAmounts = eligibleTransactions.map((tx) => ({
    currency: tx.currency,
    amountCentavos: tx.amount,
  }))
  const globalConversion = buildConversionState(allEligibleAmounts, preferredCurrency, rates)

  // ── Pace ───────────────────────────────────────────────────────────────
  const currentMonthStart = now.startOf('month')
  const currentMonthKey = currentMonthStart.format('YYYY-MM')
  const daysInMonth = currentMonthStart.daysInMonth()
  const todayDay = Math.min(now.date(), daysInMonth)

  const previousMonthStart = currentMonthStart.subtract(1, 'month')
  const previousMonthDays = previousMonthStart.daysInMonth()
  const previousMonthFullAmounts = totalAmountsInMonth(eligibleExpenses, previousMonthStart)

  // Up to 3 prior months with at least one eligible expense.
  const activePriorMonths: { start: Dayjs }[] = []
  for (let i = 2; activePriorMonths.length < 3; i++) {
    const candidateStart = currentMonthStart.subtract(i, 'month')
    if (i > 24) break
    const candidateAmounts = totalAmountsInMonth(eligibleExpenses, candidateStart)
    if (candidateAmounts.length > 0) {
      activePriorMonths.push({ start: candidateStart })
    }
  }

  const spentMTDAmounts = cumulativeAmountsUpToDay(eligibleExpenses, currentMonthStart, todayDay)
  const { centavos: spentMTD } = convertAmounts(spentMTDAmounts, preferredCurrency, rates)

  const projectedMonthEnd = todayDay > 0 ? Math.round((spentMTD / todayDay) * daysInMonth) : 0

  let priorAverageTotal = 0
  if (activePriorMonths.length > 0) {
    let sum = 0
    for (const prior of activePriorMonths) {
      const { centavos } = convertAmounts(
        totalAmountsInMonth(eligibleExpenses, prior.start),
        preferredCurrency,
        rates
      )
      sum += centavos
    }
    priorAverageTotal = Math.round(sum / activePriorMonths.length)
  }

  const vsPriorAverage = spentMTD - priorAverageTotal

  const pacePoints: PacePoint[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const currentRaw =
      day <= todayDay
        ? cumulativeAmountsUpToDay(eligibleExpenses, currentMonthStart, day)
        : null

    const previousRaw =
      day <= previousMonthDays
        ? cumulativeAmountsUpToDay(eligibleExpenses, previousMonthStart, day)
        : previousMonthFullAmounts

    const priorAverageRaw =
      activePriorMonths.length > 0
        ? averageConvertedCumulative(eligibleExpenses, activePriorMonths, day, preferredCurrency, rates)
        : 0

    const runRateRaw = Math.round((projectedMonthEnd / daysInMonth) * day)

    pacePoints.push({
      day,
      current: currentRaw !== null ? convertAmounts(currentRaw, preferredCurrency, rates).centavos : null,
      previous: convertAmounts(previousRaw, preferredCurrency, rates).centavos,
      priorAverage: priorAverageRaw,
      runRate: runRateRaw,
    })
  }

  // ── Trend ───────────────────────────────────────────────────────────────
  const trendMonths: TrendMonth[] = []
  for (let i = 11; i >= 0; i--) {
    const monthStart = currentMonthStart.subtract(i, 'month')
    const key = monthStart.format('YYYY-MM')
    const isCurrent = key === currentMonthKey

    const incomeAmounts = eligibleTransactions
      .filter((tx) => {
        if (tx.type !== 'income') return false
        const txDate = dayjs(tx.date)
        if (!txDate.isValid()) return false
        if (txDate.format('YYYY-MM') !== key) return false
        if (isCurrent && txDate.date() > todayDay) return false
        return true
      })
      .map((tx) => ({ currency: tx.currency, amountCentavos: tx.amount }))

    const expenseAmounts = eligibleTransactions
      .filter((tx) => {
        if (tx.type !== 'expense') return false
        const txDate = dayjs(tx.date)
        if (!txDate.isValid()) return false
        if (txDate.format('YYYY-MM') !== key) return false
        if (isCurrent && txDate.date() > todayDay) return false
        return true
      })
      .map((tx) => ({ currency: tx.currency, amountCentavos: tx.amount }))

    const { centavos: income } = convertAmounts(incomeAmounts, preferredCurrency, rates)
    const { centavos: expenses } = convertAmounts(expenseAmounts, preferredCurrency, rates)

    trendMonths.push({
      key,
      label: monthStart.format('MMM'),
      isCurrent,
      expenses,
      income,
      net: income - expenses,
      conversion: globalConversion,
    })
  }

  const totalIncome = trendMonths.reduce((sum, m) => sum + m.income, 0)
  const totalExpenses = trendMonths.reduce((sum, m) => sum + m.expenses, 0)
  const totalNet = totalIncome - totalExpenses

  // ── Categories ──────────────────────────────────────────────────────────
  const categoryAmountsByMonth = new Map<string, Map<string, Array<{ currency: string; amountCentavos: number }>>>()
  const categoryMeta = new Map<string, CategoryMeta>()
  const splitIntegrityNotices: SplitIntegrityNotice[] = []

  for (let i = 11; i >= 0; i--) {
    const monthStart = currentMonthStart.subtract(i, 'month')
    const key = monthStart.format('YYYY-MM')
    categoryAmountsByMonth.set(key, new Map<string, Array<{ currency: string; amountCentavos: number }>>())
  }

  for (const tx of eligibleExpenses) {
    const txDate = dayjs(tx.date)
    if (!txDate.isValid()) continue
    const key = txDate.format('YYYY-MM')
    const monthMap = categoryAmountsByMonth.get(key)
    if (!monthMap) continue
    if (key === currentMonthKey && txDate.date() > todayDay) continue

    const txSplits = splitsByTransaction.get(tx.id)
    if (txSplits && txSplits.length > 0) {
      const splitTotal = txSplits.reduce((sum, s) => sum + s.amount, 0)
      if (splitTotal !== tx.amount) {
        splitIntegrityNotices.push({
          transactionId: tx.id,
          difference: tx.amount - splitTotal,
          currency: tx.currency,
        })
      }
      for (const split of txSplits) {
        const categoryId = split.category_id ?? UNCATEGORIZED_ID
        const displayName = split.category_name ?? (categoryId === UNCATEGORIZED_ID ? 'Uncategorized' : categoryId)
        categoryMeta.set(categoryId, { name: displayName, color: split.category_color })
        const list = monthMap.get(categoryId) ?? []
        list.push({ currency: tx.currency, amountCentavos: split.amount })
        monthMap.set(categoryId, list)
      }
    } else {
      const categoryId = tx.category_id ?? UNCATEGORIZED_ID
      const displayName =
        tx.category_name ?? (categoryId === UNCATEGORIZED_ID ? 'Uncategorized' : categoryId)
      categoryMeta.set(categoryId, { name: displayName, color: tx.category_color ?? null })
      const list = monthMap.get(categoryId) ?? []
      list.push({ currency: tx.currency, amountCentavos: tx.amount })
      monthMap.set(categoryId, list)
    }
  }

  const categoryMonths: CategoryMonth[] = []
  for (let i = 11; i >= 0; i--) {
    const monthStart = currentMonthStart.subtract(i, 'month')
    const key = monthStart.format('YYYY-MM')
    const monthMap = categoryAmountsByMonth.get(key) ?? new Map<string, Array<{ currency: string; amountCentavos: number }>>()
    const convertedMap: Record<string, number> = {}
    for (const [categoryId, amounts] of monthMap.entries()) {
      const { centavos } = convertAmounts(amounts, preferredCurrency, rates)
      convertedMap[categoryId] = centavos
    }
    categoryMonths.push({
      key,
      label: monthStart.format('MMM'),
      isCurrent: key === currentMonthKey,
      byCategoryId: convertedMap,
    })
  }

  // Top categories by total converted amount over the 12-month window.
  const totalsByCategory = new Map<string, number>()
  for (const month of categoryMonths) {
    for (const [categoryId, amount] of Object.entries(month.byCategoryId)) {
      totalsByCategory.set(categoryId, (totalsByCategory.get(categoryId) ?? 0) + amount)
    }
  }

  const rankedCategoryIds = [...totalsByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)

  const topCategoryIds = rankedCategoryIds.slice(0, 6)
  const hasOther = rankedCategoryIds.length > topCategoryIds.length

  // Stable colors for categories without one.
  const finalCategoryMeta: Record<string, CategoryMeta> = {}
  let paletteIndex = 0
  for (const categoryId of rankedCategoryIds) {
    const meta = categoryMeta.get(categoryId) ?? { name: categoryId, color: null }
    const color = meta.color ?? CATEGORY_PALETTE[paletteIndex % CATEGORY_PALETTE.length]
    paletteIndex++
    finalCategoryMeta[categoryId] = { name: meta.name, color }
  }
  if (hasOther) {
    finalCategoryMeta[OTHER_CATEGORY_ID] = { name: 'Other', color: '#6B7280' }
  }
  finalCategoryMeta[UNCATEGORIZED_ID] = finalCategoryMeta[UNCATEGORIZED_ID] ?? {
    name: 'Uncategorized',
    color: '#9CA3AF',
  }

  // Current-MTD ranked breakdown.
  const currentMonthMap = categoryMonths.find((m) => m.isCurrent)?.byCategoryId ?? {}
  const currentMonthTotal = Object.values(currentMonthMap).reduce((sum, a) => sum + a, 0)
  const currentMonthBreakdown: CategoryBreakdownItem[] = []
  for (const categoryId of rankedCategoryIds) {
    const amount = currentMonthMap[categoryId] ?? 0
    if (amount <= 0) continue
    currentMonthBreakdown.push({
      categoryId,
      name: finalCategoryMeta[categoryId]?.name ?? categoryId,
      color: finalCategoryMeta[categoryId]?.color ?? null,
      amount,
      percent: currentMonthTotal > 0 ? Math.round((amount / currentMonthTotal) * 1000) / 10 : 0,
    })
  }

  // Convert split integrity notices to display currency.
  const convertedIntegrityNotices = splitIntegrityNotices.map((notice) => {
    const { centavos } = convertAmounts(
      [{ currency: notice.currency, amountCentavos: Math.abs(notice.difference) }],
      preferredCurrency,
      rates
    )
    return { ...notice, difference: notice.difference < 0 ? -centavos : centavos }
  })

  return {
    preferredCurrency,
    conversion: globalConversion,
    pace: {
      currentMonth: currentMonthKey,
      daysInMonth,
      todayDay,
      points: pacePoints,
      spentMTD,
      projectedMonthEnd,
      priorAverageTotal,
      vsPriorAverage,
      conversion: globalConversion,
    },
    trend: {
      months: trendMonths,
      totalIncome,
      totalExpenses,
      totalNet,
      conversion: globalConversion,
    },
    categories: {
      months: categoryMonths,
      categoryMeta: finalCategoryMeta,
      topCategoryIds,
      otherCategoryId: OTHER_CATEGORY_ID,
      currentMonthBreakdown,
      splitIntegrityNotices: convertedIntegrityNotices,
      conversion: globalConversion,
    },
  }
}

export function formatDashboardNotice(
  conversion: ConversionState
): string | null {
  if (conversion.kind === 'fallback') {
    return `Showing ${conversion.currency}; ${conversion.missingTarget} conversion unavailable`
  }
  if (conversion.kind === 'incomplete') {
    if (conversion.missingCurrencies.length === 1) {
      return `Conversion unavailable for ${conversion.missingCurrencies[0]}`
    }
    return `Conversion unavailable for ${conversion.missingCurrencies.join(', ')}`
  }
  return null
}
