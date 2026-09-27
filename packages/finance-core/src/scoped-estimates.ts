import {
  assertFxCurrency,
  assertFxDate,
  convertCentavosAsOf,
  type DatedConversion,
  type DatedExchangeRate,
} from './fx.js'
import {
  inspectReportScope,
  matchesReportAccount,
  matchesReportCategory,
  matchesReportTags,
  reportTagKeys,
} from './report-scope.js'
import { sumScopedCentavos, type ScopedReportGroupBy } from './scoped-reporting.js'

export type RecurringEstimateFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
export type SubscriptionEstimateCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
interface EstimateSource {
  id: string
  amount: number
  currency: string | null
  account_id: string | null
  category_id: string | null
}
export interface ScopedRecurringRule extends EstimateSource {
  is_active: number | boolean
  type: string
  frequency: RecurringEstimateFrequency
  tags?: unknown
}
export interface ScopedSubscription extends EstimateSource {
  is_active: number | boolean
  billing_cycle: SubscriptionEstimateCycle
}
export interface ScopedEstimateDataset {
  accounts: readonly { id: string }[]
  categories: readonly { id: string }[]
  rates: readonly DatedExchangeRate[]
  recurringRules: readonly ScopedRecurringRule[]
  subscriptions: readonly ScopedSubscription[]
}
export interface ScopedEstimateIssue {
  code: string
  id: string | null
  message: string
}

function ratio(amount: number, numerator: bigint, denominator: bigint): number {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error('Estimate amounts require non-negative safe integer centavos.')
  // Exact positive half-up equivalent of the existing Math.round frequency policy.
  const value = (BigInt(amount) * numerator * 2n + denominator) / (denominator * 2n)
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new RangeError('Estimate exceeds safe integer centavos.')
  return result
}
/** Port of bills.monthlyEquivalent and subscriptionEquivalentAmounts, with exact rational cents.
 * Source policies intentionally differ: rules use 30 / 4.345 / 2.1725; subscriptions use 52 weeks/year.
 * Yearly rule equivalents use 12 unrounded monthly equivalents, not 12 rounded amounts.
 */
export function recurringEquivalentCentavos(
  amount: number,
  frequency: RecurringEstimateFrequency,
  source: 'recurring_rule' | 'subscription'
) {
  const ruleRatios: Record<RecurringEstimateFrequency, readonly [bigint, bigint]> = {
    daily: [30n, 1n],
    weekly: [869n, 200n],
    biweekly: [869n, 400n],
    monthly: [1n, 1n],
    quarterly: [1n, 3n],
    yearly: [1n, 12n],
  }
  if (source !== 'recurring_rule' && source !== 'subscription')
    throw new Error('Unsupported estimate source.')
  if (
    source === 'subscription' &&
    !['weekly', 'monthly', 'quarterly', 'yearly'].includes(frequency)
  )
    throw new Error('Unsupported subscription cycle.')
  const factor =
    source === 'subscription' && frequency === 'weekly'
      ? ([52n, 12n] as const)
      : ruleRatios[frequency]
  if (!factor) throw new Error('Unsupported recurring frequency.')
  return {
    monthlyCentavos: ratio(amount, factor[0], factor[1]),
    yearlyCentavos: ratio(amount, factor[0] * 12n, factor[1]),
  }
}
export interface ScopedEstimateAllocation {
  source: 'recurring_rule' | 'subscription'
  id: string
  accountId: string | null
  categoryId: string | null
  currency: string | null
  nativeAmountCentavos: number
  nativeMonthlyCentavos: number
  nativeYearlyCentavos: number
  monthlyCentavos: number | null
  yearlyCentavos: number | null
  conversion: DatedConversion | null
}

export interface ScopedRecurringEstimateInput {
  dataset: ScopedEstimateDataset
  scope: unknown
  currency: string
  asOf: string
  groupBy?: ScopedReportGroupBy
}

/** Current definitions, valued asOf; frequency equivalents are NOT occurrences or actual budget usage. */
export function projectScopedRecurringEstimate(input: ScopedRecurringEstimateInput) {
  assertFxCurrency(input.currency)
  assertFxDate(input.asOf)
  const groupBy = input.groupBy ?? 'category'
  if (!['category', 'account', 'month', 'none'].includes(groupBy))
    throw new Error('Unsupported estimate grouping.')
  const { dataset } = input
  const inspected = inspectReportScope(input.scope, dataset)
  const scope = inspected.scope
  function project(source: 'recurring_rule' | 'subscription') {
    const issues: ScopedEstimateIssue[] = [...inspected.issues]
    if (source === 'subscription' && scope && (scope.tags.length || scope.excludeTags.length))
      issues.push({
        code: 'unsupported_subscription_tags',
        id: null,
        message: 'Subscriptions have no persisted tags; selection is unsupported.',
      })
    const allocations: ScopedEstimateAllocation[] = []
    const rows = source === 'recurring_rule' ? dataset.recurringRules : dataset.subscriptions
    for (const row of rows) {
      if (
        !scope ||
        !(row.is_active === 1 || row.is_active === true) ||
        (source === 'recurring_rule' && (row as ScopedRecurringRule).type !== 'expense')
      )
        continue
      if (
        !matchesReportAccount(scope, row.account_id) ||
        !matchesReportCategory(scope, row.category_id)
      )
        continue
      if (scope.tags.length || scope.excludeTags.length) {
        if (source === 'subscription') continue
        try {
          if (!matchesReportTags(scope, reportTagKeys((row as ScopedRecurringRule).tags))) continue
        } catch (error) {
          issues.push({ code: 'invalid_tags', id: row.id, message: String(error) })
          continue
        }
      }
      if (
        row.account_id !== null &&
        !dataset.accounts.some((account) => account.id === row.account_id)
      )
        issues.push({
          code: 'missing_account',
          id: row.account_id,
          message: 'Estimate account is missing.',
        })
      if (
        row.category_id !== null &&
        !dataset.categories.some((category) => category.id === row.category_id)
      )
        issues.push({
          code: 'missing_category',
          id: row.category_id,
          message: 'Estimate category is missing.',
        })
      try {
        const frequency =
          source === 'recurring_rule'
            ? (row as ScopedRecurringRule).frequency
            : (row as ScopedSubscription).billing_cycle
        const native = recurringEquivalentCentavos(row.amount, frequency, source)
        let conversion: DatedConversion | null = null
        try {
          conversion = convertCentavosAsOf({
            amountCentavos: row.amount,
            fromCurrency: row.currency?.trim().toUpperCase() ?? '',
            toCurrency: input.currency,
            asOfDate: input.asOf,
            rates: dataset.rates,
          })
          if (!conversion.complete)
            issues.push({ code: 'fx', id: row.id, message: conversion.missingReason })
        } catch (error) {
          issues.push({ code: 'fx', id: row.id, message: String(error) })
        }
        const converted = conversion?.complete
          ? recurringEquivalentCentavos(conversion.amountCentavos, frequency, source)
          : null
        allocations.push({
          source,
          id: row.id,
          accountId: row.account_id,
          categoryId: row.category_id,
          currency: row.currency?.trim().toUpperCase() || null,
          nativeAmountCentavos: row.amount,
          nativeMonthlyCentavos: native.monthlyCentavos,
          nativeYearlyCentavos: native.yearlyCentavos,
          monthlyCentavos: converted?.monthlyCentavos ?? null,
          yearlyCentavos: converted?.yearlyCentavos ?? null,
          conversion,
        })
      } catch (error) {
        issues.push({ code: 'invalid_estimate', id: row.id, message: String(error) })
      }
    }
    const complete = issues.length === 0
    const subtotal = (rows: readonly ScopedEstimateAllocation[]) => ({
      monthlyCentavos: sumScopedCentavos(
        rows.flatMap((row) => (row.monthlyCentavos === null ? [] : [row.monthlyCentavos]))
      ),
      yearlyCentavos: sumScopedCentavos(
        rows.flatMap((row) => (row.yearlyCentavos === null ? [] : [row.yearlyCentavos]))
      ),
    })
    const known = subtotal(allocations)
    const keyOf = (row: ScopedEstimateAllocation) =>
      groupBy === 'category'
        ? row.categoryId
        : groupBy === 'account'
          ? row.accountId
          : groupBy === 'month'
            ? input.asOf.slice(0, 7)
            : null
    const groups = (groupBy === 'none' ? [null] : [...new Set(allocations.map(keyOf))].sort()).map(
      (key) => {
        const rows = allocations.filter((row) => keyOf(row) === key)
        const known = subtotal(rows)
        return {
          key,
          complete,
          known,
          monthlyCentavos: complete ? known.monthlyCentavos : null,
          yearlyCentavos: complete ? known.yearlyCentavos : null,
          sourceIds: rows.map((row) => row.id).sort(),
        }
      }
    )
    const nativeTotals = [
      ...new Set(allocations.flatMap((row) => (row.currency === null ? [] : [row.currency]))),
    ]
      .sort()
      .map((currency) => {
        const rows = allocations.filter((row) => row.currency === currency)
        return {
          currency,
          monthlyCentavos: sumScopedCentavos(rows.map((row) => row.nativeMonthlyCentavos)),
          yearlyCentavos: sumScopedCentavos(rows.map((row) => row.nativeYearlyCentavos)),
        }
      })
    return {
      source,
      complete,
      monthlyCentavos: complete ? known.monthlyCentavos : null,
      yearlyCentavos: complete ? known.yearlyCentavos : null,
      known,
      nativeTotals,
      issues,
      allocations,
      groups,
    }
  }
  return {
    basis: 'recurring_estimate' as const,
    policy: 'current_definition_frequency_equivalent_as_of' as const,
    currency: input.currency,
    asOf: input.asOf,
    scope,
    groupBy,
    monthGroupingPolicy: 'as_of_definition_month_not_occurrence' as const,
    recurringRules: project('recurring_rule'),
    subscriptions: project('subscription'),
    combinedMonthlyCentavos: null,
    combinedYearlyCentavos: null,
    combinedComplete: false,
    combinedReason: 'cross_source_overlap_unknown' as const,
  }
}

export type ScopedRecurringEstimateResult = ReturnType<typeof projectScopedRecurringEstimate>
