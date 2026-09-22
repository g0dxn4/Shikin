import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { isCashFlowEligible } from '@shikin/finance-core'
import {
  convertDatedAmounts,
  apportionConvertedAmount,
  convertCentavosAsOf,
  type DatedExchangeRate,
} from '@shikin/finance-core/fx'
import {
  sumReportingAmounts,
  projectGrossRows,
  type GrossProjection,
} from '@/lib/dated-reporting-read'
import type { Transaction, TransactionSplitWithCategory } from '@/types/database'

export type DashboardTransaction = Pick<
  Transaction,
  | 'id'
  | 'type'
  | 'amount'
  | 'currency'
  | 'date'
  | 'status'
  | 'ledger_treatment'
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
  'id' | 'transaction_id' | 'category_id' | 'category_name' | 'category_color' | 'amount'
> & {
  date: string
}

export interface DashboardAnalyticsInput {
  transactions: DashboardTransaction[]
  splits: DashboardSplit[]
  preferredCurrency: string | null
  rates: readonly DatedExchangeRate[]
  now: Dayjs
}

export type ConversionState =
  | { kind: 'complete'; currency: string; missingCurrencies: [] }
  | { kind: 'fallback'; currency: string; missingTarget: string; missingCurrencies: [string] }
  | {
      kind: 'incomplete'
      currency: string
      missingCurrencies: string[]
      reason?:
        | 'invalid_category_allocations'
        | 'main_currency_unconfigured'
        | 'invalid_currency_data'
    }

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
  /** Validated dated evidence; full totals are null when any required source is unavailable. */
  evidence: GrossProjection
  fullTotals: {
    income: number | null
    expenses: number | null
    net: number | null
    spentMTD: number | null
  }
  preferredCurrency: string
  conversion: ConversionState
  cashFlowConversion: ConversionState
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

function safeNormalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9]{2,10}$/.test(normalized) ? normalized : null
}

function isEligibleForCashFlow(tx: DashboardTransaction): boolean {
  return isCashFlowEligible({
    type: tx.type,
    status: tx.status ?? 'posted',
    ledgerTreatment: tx.ledger_treatment,
    reportingTreatment: tx.reporting_treatment ?? 'normal',
    transactionKind: tx.transaction_kind ?? 'standard',
    isArchived: tx.is_archived ?? 0,
  })
}

function buildConversionState(
  amounts: ReadonlyArray<{ currency: string; amountCentavos: number; date: string }>,
  preferredCurrency: string,
  rates: readonly DatedExchangeRate[]
): ConversionState {
  return convertAmounts(amounts, preferredCurrency, rates).conversion
}

function convertAmounts(
  amounts: ReadonlyArray<{ currency: string; amountCentavos: number; date: string }>,
  preferredCurrency: string,
  rates: readonly DatedExchangeRate[]
): { centavos: number; conversion: ConversionState } {
  if (!preferredCurrency)
    return {
      centavos: 0,
      conversion: {
        kind: 'incomplete',
        currency: '',
        missingCurrencies: [],
        reason: 'main_currency_unconfigured',
      },
    }
  try {
    if (amounts.some((a) => a.amountCentavos < 0)) throw new Error('Invalid amount')
    const result = convertDatedAmounts(
      amounts.map((a, i) => ({
        ...a,
        id: String(i),
        currency: safeNormalizeCurrency(a.currency) ?? '',
      })),
      preferredCurrency,
      rates
    )
    return {
      centavos: result.knownTotalCentavos,
      conversion: result.complete
        ? { kind: 'complete', currency: preferredCurrency, missingCurrencies: [] }
        : {
            kind: 'incomplete',
            currency: preferredCurrency,
            missingCurrencies: [
              ...new Set(result.converted.filter((r) => !r.complete).map((r) => r.fromCurrency)),
            ].sort(),
          },
    }
  } catch {
    return {
      centavos: 0,
      conversion: {
        kind: 'incomplete',
        currency: preferredCurrency,
        missingCurrencies: [],
        reason: 'invalid_currency_data',
      },
    }
  }
}

function cumulativeAmountsUpToDay(
  transactions: DashboardTransaction[],
  monthStart: Dayjs,
  maxDay: number
): Array<{ currency: string; amountCentavos: number; date: string }> {
  const amounts: Array<{ currency: string; amountCentavos: number; date: string }> = []
  const monthKey = monthStart.format('YYYY-MM')
  for (const tx of transactions) {
    const txDate = dayjs(tx.date)
    if (!txDate.isValid()) continue
    if (txDate.format('YYYY-MM') !== monthKey) continue
    if (txDate.date() > maxDay) continue
    amounts.push({ currency: tx.currency, amountCentavos: tx.amount, date: tx.date })
  }
  return amounts
}

function totalAmountsInMonth(
  transactions: DashboardTransaction[],
  monthStart: Dayjs
): Array<{ currency: string; amountCentavos: number; date: string }> {
  return cumulativeAmountsUpToDay(transactions, monthStart, monthStart.daysInMonth())
}

function averageConvertedCumulative(
  eligibleExpenses: DashboardTransaction[],
  activePriorMonths: { start: Dayjs }[],
  day: number,
  preferredCurrency: string,
  rates: readonly DatedExchangeRate[]
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

export function buildDashboardAnalytics(input: DashboardAnalyticsInput): DashboardAnalyticsResult {
  const { transactions, splits, rates, now } = input
  const preferredCurrency = input.preferredCurrency ?? ''

  // Split index by transaction id.
  const splitsByTransaction = new Map<string, DashboardSplit[]>()
  for (const split of splits) {
    const list = splitsByTransaction.get(split.transaction_id) ?? []
    list.push(split)
    splitsByTransaction.set(split.transaction_id, list)
  }

  const eligibleTransactions = transactions.filter(isEligibleForCashFlow)
  const eligibleExpenses = eligibleTransactions.filter((tx) => tx.type === 'expense')

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

  const paceMonthKeys = new Set([
    currentMonthKey,
    previousMonthStart.format('YYYY-MM'),
    ...activePriorMonths.map(({ start }) => start.format('YYYY-MM')),
  ])
  const paceAmounts = eligibleExpenses
    .filter((tx) => {
      const txDate = dayjs(tx.date)
      if (!txDate.isValid() || !paceMonthKeys.has(txDate.format('YYYY-MM'))) return false
      return txDate.format('YYYY-MM') !== currentMonthKey || txDate.date() <= todayDay
    })
    .map((tx) => ({ currency: tx.currency, amountCentavos: tx.amount, date: tx.date }))
  const paceConversion = buildConversionState(paceAmounts, preferredCurrency, rates)

  const trendStart = currentMonthStart.subtract(11, 'month')
  const displayedTransactions = eligibleTransactions.filter(
    (tx) => tx.date >= trendStart.format('YYYY-MM-DD') && tx.date <= now.format('YYYY-MM-DD')
  )
  let trendConversion = buildConversionState(
    displayedTransactions.map((tx) => ({
      currency: tx.currency,
      amountCentavos: tx.amount,
      date: tx.date,
    })),
    preferredCurrency,
    rates
  )
  const categoriesConversion = buildConversionState(
    displayedTransactions
      .filter((tx) => tx.type === 'expense')
      .map((tx) => ({ currency: tx.currency, amountCentavos: tx.amount, date: tx.date })),
    preferredCurrency,
    rates
  )

  const currentAndPreviousMonthKeys = new Set([
    currentMonthKey,
    previousMonthStart.format('YYYY-MM'),
  ])
  const cashFlowConversion = buildConversionState(
    eligibleTransactions
      .filter((tx) => {
        const txDate = dayjs(tx.date)
        if (!txDate.isValid() || !currentAndPreviousMonthKeys.has(txDate.format('YYYY-MM'))) {
          return false
        }
        return txDate.format('YYYY-MM') !== currentMonthKey || txDate.date() <= todayDay
      })
      .map((tx) => ({ currency: tx.currency, amountCentavos: tx.amount, date: tx.date })),
    preferredCurrency,
    rates
  )

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
      day <= todayDay ? cumulativeAmountsUpToDay(eligibleExpenses, currentMonthStart, day) : null

    const previousRaw =
      day <= previousMonthDays
        ? cumulativeAmountsUpToDay(eligibleExpenses, previousMonthStart, day)
        : previousMonthFullAmounts

    const priorAverageRaw =
      activePriorMonths.length > 0
        ? averageConvertedCumulative(
            eligibleExpenses,
            activePriorMonths,
            day,
            preferredCurrency,
            rates
          )
        : 0

    const runRateRaw = Math.round((projectedMonthEnd / daysInMonth) * day)

    pacePoints.push({
      day,
      current:
        currentRaw !== null ? convertAmounts(currentRaw, preferredCurrency, rates).centavos : null,
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
      .map((tx) => ({ currency: tx.currency, amountCentavos: tx.amount, date: tx.date }))

    const expenseAmounts = eligibleTransactions
      .filter((tx) => {
        if (tx.type !== 'expense') return false
        const txDate = dayjs(tx.date)
        if (!txDate.isValid()) return false
        if (txDate.format('YYYY-MM') !== key) return false
        if (isCurrent && txDate.date() > todayDay) return false
        return true
      })
      .map((tx) => ({ currency: tx.currency, amountCentavos: tx.amount, date: tx.date }))

    const { centavos: income } = convertAmounts(incomeAmounts, preferredCurrency, rates)
    const { centavos: expenses } = convertAmounts(expenseAmounts, preferredCurrency, rates)

    trendMonths.push({
      key,
      label: monthStart.format('MMM'),
      isCurrent,
      expenses,
      income,
      net: income - expenses,
      conversion: trendConversion,
    })
  }

  let totalIncome = 0
  let totalExpenses = 0
  try {
    totalIncome = sumReportingAmounts(trendMonths.map((m) => m.income))
    totalExpenses = sumReportingAmounts(trendMonths.map((m) => m.expenses))
  } catch {
    trendConversion = {
      kind: 'incomplete',
      currency: preferredCurrency,
      missingCurrencies: [],
      reason: 'invalid_currency_data',
    }
  }
  const totalNet = totalIncome - totalExpenses

  // ── Categories ──────────────────────────────────────────────────────────
  const categoryAmountsByMonth = new Map<
    string,
    Map<string, Array<{ currency: string; amountCentavos: number; date: string }>>
  >()
  const categoryMeta = new Map<string, CategoryMeta>()
  const splitIntegrityNotices: SplitIntegrityNotice[] = []

  for (let i = 11; i >= 0; i--) {
    const monthStart = currentMonthStart.subtract(i, 'month')
    const key = monthStart.format('YYYY-MM')
    categoryAmountsByMonth.set(
      key,
      new Map<string, Array<{ currency: string; amountCentavos: number; date: string }>>()
    )
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
      if (
        !Number.isSafeInteger(splitTotal) ||
        splitTotal !== tx.amount ||
        new Set(txSplits.map((split) => split.id)).size !== txSplits.length ||
        txSplits.some((split) => !split.id) ||
        txSplits.some((split) => !Number.isSafeInteger(split.amount) || split.amount <= 0)
      ) {
        splitIntegrityNotices.push({
          transactionId: tx.id,
          difference: Number.isSafeInteger(splitTotal) ? tx.amount - splitTotal : 0,
          currency: tx.currency,
        })
        continue
      }
      let convertedSplits: ReturnType<typeof apportionConvertedAmount>
      try {
        const parent = preferredCurrency
          ? convertCentavosAsOf({
              amountCentavos: tx.amount,
              fromCurrency: tx.currency.trim().toUpperCase(),
              toCurrency: preferredCurrency,
              asOfDate: tx.date,
              rates,
            })
          : null
        if (!parent?.complete) continue
        convertedSplits = apportionConvertedAmount(
          parent.amountCentavos,
          txSplits.map((split) => ({ id: split.id, amountCentavos: split.amount })),
          tx.amount
        )
      } catch {
        continue
      }
      for (const split of txSplits) {
        const categoryId = split.category_id ?? UNCATEGORIZED_ID
        const displayName =
          split.category_name ?? (categoryId === UNCATEGORIZED_ID ? 'Uncategorized' : categoryId)
        categoryMeta.set(categoryId, { name: displayName, color: split.category_color })
        const list = monthMap.get(categoryId) ?? []
        list.push({
          currency: preferredCurrency,
          amountCentavos: convertedSplits.find((row) => row.id === split.id)!.amountCentavos,
          date: tx.date,
        })
        monthMap.set(categoryId, list)
      }
    } else {
      const categoryId = tx.category_id ?? UNCATEGORIZED_ID
      const displayName =
        tx.category_name ?? (categoryId === UNCATEGORIZED_ID ? 'Uncategorized' : categoryId)
      categoryMeta.set(categoryId, { name: displayName, color: tx.category_color ?? null })
      const list = monthMap.get(categoryId) ?? []
      list.push({ currency: tx.currency, amountCentavos: tx.amount, date: tx.date })
      monthMap.set(categoryId, list)
    }
  }

  const categoryMonths: CategoryMonth[] = []
  for (let i = 11; i >= 0; i--) {
    const monthStart = currentMonthStart.subtract(i, 'month')
    const key = monthStart.format('YYYY-MM')
    const monthMap =
      categoryAmountsByMonth.get(key) ??
      new Map<string, Array<{ currency: string; amountCentavos: number; date: string }>>()
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

  const context = {
    mainCurrency: input.preferredCurrency,
    manualRates: rates,
    today: now.format('YYYY-MM-DD'),
  }
  const withSplits = (rows: DashboardTransaction[]) =>
    rows.map((tx) => ({ ...tx, splits_json: JSON.stringify(splitsByTransaction.get(tx.id) ?? []) }))
  const evidence = projectGrossRows(withSplits(displayedTransactions), context)
  const paceEvidence = projectGrossRows(
    withSplits(
      eligibleExpenses.filter(
        (tx) => paceMonthKeys.has(tx.date.slice(0, 7)) && tx.date <= context.today
      )
    ),
    context
  )
  const cashEvidence = projectGrossRows(
    withSplits(
      eligibleTransactions.filter(
        (tx) => currentAndPreviousMonthKeys.has(tx.date.slice(0, 7)) && tx.date <= context.today
      )
    ),
    context
  )
  for (const [projection, state] of [
    [evidence, trendConversion],
    [paceEvidence, paceConversion],
    [cashEvidence, cashFlowConversion],
  ] as const) {
    if (!projection.complete) {
      state.kind = 'incomplete'
      state.missingCurrencies = projection.missingCurrencies
      if (state.kind === 'incomplete' && projection.reason === 'invalid_category_allocations')
        state.reason = 'invalid_category_allocations'
    }
  }
  // Integrity evidence remains in its original native denomination.
  const convertedIntegrityNotices = splitIntegrityNotices

  return {
    evidence,
    fullTotals: {
      income: trendConversion.kind === 'complete' ? totalIncome : null,
      expenses: trendConversion.kind === 'complete' ? totalExpenses : null,
      net: trendConversion.kind === 'complete' ? totalNet : null,
      spentMTD: paceConversion.kind === 'complete' ? spentMTD : null,
    },
    preferredCurrency,
    conversion: trendConversion,
    cashFlowConversion,
    pace: {
      currentMonth: currentMonthKey,
      daysInMonth,
      todayDay,
      points:
        paceConversion.kind === 'complete'
          ? pacePoints
          : pacePoints.map((point) => ({
              ...point,
              current: null,
              previous: null,
              priorAverage: null,
              runRate: null,
            })),
      spentMTD,
      projectedMonthEnd,
      priorAverageTotal,
      vsPriorAverage,
      conversion: paceConversion,
    },
    trend: {
      months: trendMonths,
      totalIncome,
      totalExpenses,
      totalNet,
      conversion: trendConversion,
    },
    categories: {
      months:
        splitIntegrityNotices.length || categoriesConversion.kind !== 'complete'
          ? []
          : categoryMonths,
      categoryMeta: finalCategoryMeta,
      topCategoryIds,
      otherCategoryId: OTHER_CATEGORY_ID,
      currentMonthBreakdown:
        splitIntegrityNotices.length || categoriesConversion.kind !== 'complete'
          ? []
          : currentMonthBreakdown,
      splitIntegrityNotices: convertedIntegrityNotices,
      conversion: splitIntegrityNotices.length
        ? {
            kind: 'incomplete',
            currency: preferredCurrency,
            missingCurrencies: [],
            reason: 'invalid_category_allocations',
          }
        : categoriesConversion,
    },
  }
}

export function formatDashboardNotice(conversion: ConversionState): string | null {
  if (conversion.kind === 'fallback') {
    return `Showing ${conversion.currency}; ${conversion.missingTarget} conversion unavailable`
  }
  if (conversion.kind === 'incomplete') {
    if (conversion.reason === 'main_currency_unconfigured')
      return 'Set a main currency in Settings to view converted totals.'
    if (conversion.reason === 'invalid_currency_data')
      return 'Report incomplete: currency, date, or centavo evidence requires repair.'
    if (conversion.reason === 'invalid_category_allocations') {
      return 'Category report incomplete: split allocations do not reconcile.'
    }
    if (conversion.missingCurrencies.length === 1) {
      return `Conversion unavailable for ${conversion.missingCurrencies[0]}`
    }
    return `Conversion unavailable for ${conversion.missingCurrencies.join(', ')}`
  }
  return null
}
