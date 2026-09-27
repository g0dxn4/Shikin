import { useEffect, useMemo, useState } from 'react'
import { sumScopedCentavos } from '@shikin/finance-core'
import dayjs from 'dayjs'
import type { BudgetSpendingRead } from '@/lib/budget-dated-read'
import { budgetActualRange, type BudgetRangePreset } from '@/lib/budget-actual-range'
import { useScopedReport } from './use-scoped-report'

export interface CategoryActual {
  categoryId: string
  spending: BudgetSpendingRead
}
/** Unique categories in one canonical actual projection; plans/limits are never spending. */
export function useBudgetRangeSpending(
  categories: readonly { categoryId: string; currency: string }[],
  preset: BudgetRangePreset
) {
  const [today, setToday] = useState(() => dayjs().format('YYYY-MM-DD'))
  useEffect(() => {
    const timer = setInterval(() => setToday(dayjs().format('YYYY-MM-DD')), 60_000)
    return () => clearInterval(timer)
  }, [])
  const range = useMemo(() => budgetActualRange(preset, dayjs(today)), [preset, today])
  const categoryIds = [...new Set(categories.map((c) => c.categoryId))].sort()
  const read = useScopedReport({
    basis: 'gross_cashflow',
    scope: { categoryIds },
    groupBy: 'category',
    window: { start: range.start ?? '0001-01-01', end: range.end, asOf: range.end },
  })
  const result = read.data?.result
  const rows: CategoryActual[] =
    result && result.basis !== 'recurring_estimate'
      ? categoryIds.map((categoryId) => {
          const group = result.groups.find((g) => g.key === categoryId)
          const selected = result.allocations.filter((a) => a.categoryId === categoryId)
          const currencies = [...new Set(selected.map((a) => a.currency))]

          return {
            categoryId,
            spending: {
              complete: result.budgetUsage.complete,
              currency: result.currency,
              totalCentavos: result.budgetUsage.complete
                ? (group?.known.expenseCentavos ?? 0)
                : null,
              knownTotalCentavos: group?.known.expenseCentavos ?? 0,
              nativeTotals: currencies.map((currency) => ({
                currency,
                amountCentavos: sumScopedCentavos(
                  selected
                    .filter((a) => a.currency === currency)
                    .flatMap((a) =>
                      a.nativeAmounts.expenseCentavos === null
                        ? []
                        : [a.nativeAmounts.expenseCentavos]
                    )
                ),
              })),
              unresolvedIds: result.budgetUsage.issues.flatMap((i) => (i.id ? [i.id] : [])),
              conversions: [],
            },
          }
        })
      : []
  return {
    range,
    rows,
    loading: read.loading,
    error: read.error,
    mainCurrency: read.data?.mainCurrency ?? null,
    retry: read.refresh,
    result: result && result.basis !== 'recurring_estimate' ? result : null,
    references: read.data,
  }
}
