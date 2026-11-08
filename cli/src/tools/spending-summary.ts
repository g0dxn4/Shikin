import {
  loadScopedDataset,
  scopedActual,
  scopedEstimate,
  contributorInspection,
  flatDatedConversions,
} from '../scoped-report-read.js'
import { getCurrencySettings } from '../fx-service.js'
import { normalizeReportScope, resolveReportWindow, sumScopedCentavos } from '@shikin/finance-core'
import {
  z,
  transaction,
  fromCentavos,
  isoDate,
  getCategoryIdentity,
  type ToolDefinition,
} from './shared.js'

export const getSpendingSummary: ToolDefinition = {
  name: 'get-spending-summary',
  description: 'Scoped gross, net consumption, or separate recurring planning equivalents.',
  schema: z.object({
    basis: z
      .enum(['gross_cashflow', 'net_consumption', 'recurring_estimate'])
      .optional()
      .default('gross_cashflow'),
    period: z.enum(['week', 'month', 'year', 'custom']).optional(),
    startDate: isoDate('Inclusive start date').optional(),
    endDate: isoDate('Inclusive end date').optional(),
    start: isoDate('Inclusive start date').optional(),
    end: isoDate('Inclusive end date').optional(),
    asOf: isoDate('Reference date').optional(),
    through: z.enum(['as_of', 'period_end']).optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    timeZone: z.string().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    scope: z
      .object({
        accountIds: z.array(z.string()).optional(),
        excludeAccountIds: z.array(z.string()).optional(),
        categoryIds: z.array(z.string().nullable()).optional(),
        excludeCategoryIds: z.array(z.string().nullable()).optional(),
        tags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    groupBy: z.enum(['category', 'account', 'month', 'none']).optional().default('category'),
  }),
  effects: { readOnly: true, writesTo: [] },
  execute: async (input) => {
    const start = input.start ?? input.startDate
    const end = input.end ?? input.endDate
    if (input.period === 'custom' && (!start || !end))
      return {
        success: false,
        message: 'Custom spending summaries require both startDate and endDate.',
      }
    if (start && end && start > end)
      return {
        success: false,
        message: 'Custom spending summaries require startDate to be on or before endDate.',
      }
    return transaction(() => {
      if (
        (input.start && input.startDate && input.start !== input.startDate) ||
        (input.end && input.endDate && input.end !== input.endDate)
      )
        return { success: false, message: 'Conflicting start/end aliases.' }
      const window = resolveReportWindow({
        period: input.period,
        start: input.start ?? input.startDate,
        end: input.end ?? input.endDate,
        asOf: input.asOf,
        through: input.through,
        weekStartsOn: input.weekStartsOn,
        timeZone: input.timeZone,
      })
      const currency = input.currency ?? getCurrencySettings().mainCurrency
      if (!currency)
        return {
          success: false,
          reason: 'main_currency_unconfigured',
          message: 'Supply currency or configure main currency.',
        }
      const dataset = loadScopedDataset()
      const scope = normalizeReportScope(input.scope)
      if (input.basis === 'recurring_estimate') {
        const estimate = scopedEstimate({
          dataset,
          scope,
          currency,
          groupBy: input.groupBy,
          asOf: window.asOf,
        })
        return {
          success: true,
          ...estimate,
          window,
          period: { start: window.start, end: window.end },
          totalExpenses: null,
          totalIncome: null,
          netSavings: null,
          combinedEstimate: null,
          message:
            'Separate current-definition recurring equivalents; sources may overlap and are not actual spending.',
        }
      }
      const result = scopedActual({
        dataset,
        scope,
        currency,
        basis: input.basis,
        groupBy: input.groupBy,
        window,
      })
      const cents = (value: number | null) => (value === null ? null : fromCentavos(value))
      const expense = cents(result.totals.expenseCentavos),
        income = cents(result.totals.incomeCentavos)
      const descriptor = {
        scope: result.scope,
        basis: result.basis,
        currency,
        period: window.period,
        asOf: window.asOf,
        start: window.requested.start ?? window.periodStart,
        end: window.requested.end ?? window.periodEnd,
        through: window.through,
        weekStartsOn: window.weekStartsOn,
        timeZone: window.timeZone,
      }
      // Compatibility aliases are derived exclusively from selected core allocations.
      // Native amounts are never added across currencies or mistaken for converted totals.
      const nativeGross = result.nativeTotals.map(({ currency: nativeCurrency, known }) => {
        const totalExpenses = fromCentavos(known.expenseCentavos ?? 0)
        const totalIncome = fromCentavos(known.incomeCentavos ?? 0)
        return {
          currency: nativeCurrency,
          totalExpenses,
          totalIncome,
          netSavings: totalIncome - totalExpenses,
        }
      })
      const nativeNet = result.nativeTotals.map(({ currency: nativeCurrency, known }) => ({
        currency: nativeCurrency,
        consumptionCentavos: known.consumptionCentavos ?? 0,
        earnedIncomeCentavos: known.earnedIncomeCentavos ?? 0,
        otherIncomeCentavos: known.otherIncomeCentavos ?? 0,
        principalRecoveryCentavos: known.principalRecoveryCentavos ?? 0,
        assetAcquisitionCentavos: known.assetAcquisitionCentavos ?? 0,
      }))
      const nativeCategories = [
        ...new Set(
          result.allocations
            .filter(
              (row) =>
                row.nativeAmounts.consumptionCentavos !== null &&
                row.nativeAmounts.consumptionCentavos !== 0
            )
            .map((row) => JSON.stringify([row.currency, row.categoryId]))
        ),
      ]
        .sort()
        .map((key) => {
          const [nativeCurrency, categoryId] = JSON.parse(key) as [string, string | null]
          const amountCentavos = sumScopedCentavos(
            result.allocations
              .filter((row) => row.currency === nativeCurrency && row.categoryId === categoryId)
              .map((row) => row.nativeAmounts.consumptionCentavos ?? 0)
          )
          return { currency: nativeCurrency, categoryId, amountCentavos }
        })
      const expenseRows = result.allocations.filter(
        (row) =>
          row.nativeAmounts.expenseCentavos !== null && row.nativeAmounts.expenseCentavos !== 0
      )
      const legacyGrossCategories =
        input.groupBy === 'category'
          ? [...new Set(expenseRows.map((row) => JSON.stringify([row.currency, row.categoryId])))]
              .sort()
              .map((key) => {
                const [nativeCurrency, categoryId] = JSON.parse(key) as [string, string | null]
                const rows = expenseRows.filter(
                  (row) => row.currency === nativeCurrency && row.categoryId === categoryId
                )
                const amount = fromCentavos(
                  sumScopedCentavos(rows.map((row) => row.nativeAmounts.expenseCentavos ?? 0))
                )
                const denominator =
                  nativeGross.find((row) => row.currency === nativeCurrency)?.totalExpenses ?? 0
                const categoryName =
                  categoryId === null
                    ? 'Uncategorized'
                    : ((
                        dataset.categories.find((row) => row.id === categoryId) as
                          | { id: string; name?: string }
                          | undefined
                      )?.name ?? categoryId)
                return {
                  currency: nativeCurrency,
                  categoryId,
                  ...getCategoryIdentity(categoryId, categoryName),
                  amount,
                  transactionCount: new Set(rows.map((row) => row.transactionId)).size,
                  percentage: denominator > 0 ? Math.round((amount / denominator) * 100) : 0,
                }
              })
          : []
      const flatConversions = flatDatedConversions(result.conversions)
      const convertedNet = {
        complete: result.complete,
        currency,
        toCurrency: currency,
        consumptionCentavos: result.totals.consumptionCentavos,
        earnedIncomeCentavos: result.totals.earnedIncomeCentavos,
        otherIncomeCentavos: result.totals.otherIncomeCentavos,
        principalRecoveryCentavos: result.totals.principalRecoveryCentavos,
        assetAcquisitionCentavos: result.totals.assetAcquisitionCentavos,
        knownConsumptionCentavos: result.known.consumptionCentavos,
        knownEarnedIncomeCentavos: result.known.earnedIncomeCentavos,
        knownOtherIncomeCentavos: result.known.otherIncomeCentavos,
        knownPrincipalRecoveryCentavos: result.known.principalRecoveryCentavos,
        knownAssetAcquisitionCentavos: result.known.assetAcquisitionCentavos,
        classificationComplete: result.classificationComplete,
        coverageComplete: result.coverage.complete,
        unresolvedClassificationIds: result.unresolvedClassificationIds,
        byCategory:
          input.groupBy === 'category'
            ? result.groups.map((group) => ({
                categoryId: group.key,
                amountCentavos: group.totals.consumptionCentavos,
                knownAmountCentavos: group.known.consumptionCentavos,
              }))
            : [],
        allocations: result.allocations,
        conversion: {
          complete: flatConversions.every((entry) => entry.complete),
          toCurrency: currency,
          converted: flatConversions,
          unresolvedIds: flatConversions
            .filter((entry) => !entry.complete)
            .map((entry) => entry.id)
            .sort(),
          totalCentavos: null,
          reason:
            'Full parent conversion totals are not selected allocation totals; use report.totals.',
        },
        conversions: result.conversions,
        reason: result.complete ? null : (result.issues[0]?.code ?? 'incomplete_report'),
        uncoveredAccountIds: result.coverage.uncoveredAccountIds,
        policy: result.fxPolicy,
      }
      return {
        success: input.basis === 'net_consumption' || result.complete,
        reason: result.complete ? null : (result.issues[0]?.code ?? 'incomplete_report'),
        ...result,
        report: result,
        period: { start: window.start, end: window.end },
        window,
        totalExpenses: expense,
        totalIncome: income,
        netSavings: expense === null || income === null ? null : income - expense,
        totalsByCurrency: input.basis === 'net_consumption' ? nativeNet : nativeGross,
        nativeTotalsComplete: result.complete,
        nativeTotalsReason: result.complete
          ? null
          : 'Known native subtotals only; unresolved selected evidence may affect any currency.',
        mixedCurrency: result.nativeTotals.length > 1,
        byCategory: input.basis === 'net_consumption' ? nativeCategories : legacyGrossCategories,
        ...(input.basis === 'net_consumption'
          ? {
              // The legacy `totals` is a native-currency array; the canonical converted
              // seven-field object remains available at `report.totals`.
              totals: nativeNet,
              unresolvedIds: result.unresolvedClassificationIds,
              coverageComplete: result.coverage.complete,
              uncoveredAccountIds: result.coverage.uncoveredAccountIds,
              currencyScope: 'all',
              mainConversion: convertedNet,
            }
          : {}),
        ...contributorInspection(result, descriptor),
        message: result.complete
          ? 'Scoped actual spending is complete.'
          : 'Scoped actual spending incomplete; inspect known subtotals and issues.',
      }
    })
  },
}
