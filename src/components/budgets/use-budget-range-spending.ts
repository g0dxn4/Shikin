import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { readBudgetSpending, type BudgetSpendingRead } from '@/lib/budget-dated-read'
import { budgetActualRange, type BudgetRangePreset } from '@/lib/budget-actual-range'
import { getErrorMessage } from '@/lib/errors'
import { useCurrencyStore } from '@/stores/currency-store'
import { currencyAuthorityKey } from '@/stores/currency-authority'

export interface CategoryActual {
  categoryId: string
  spending: BudgetSpendingRead
}

interface RangeResult {
  requestKey: string
  rows: CategoryActual[]
  error: string | null
}

/** Only active budget category IDs are read. Duplicate plans for a category count once. */
export function useBudgetRangeSpending(
  categories: readonly { categoryId: string; currency: string }[],
  preset: BudgetRangePreset
) {
  const authorityKey = useCurrencyStore(currencyAuthorityKey)
  const [today, setToday] = useState(() => dayjs().format('YYYY-MM-DD'))
  useEffect(() => {
    const timer = setInterval(() => {
      const localDay = dayjs().format('YYYY-MM-DD')
      setToday((previous) => (previous === localDay ? previous : localDay))
    }, 60_000)
    return () => clearInterval(timer)
  }, [])
  const range = useMemo(() => budgetActualRange(preset, dayjs(today)), [preset, today])
  const categoryKey = JSON.stringify(
    categories
      .filter(
        (category, index) =>
          categories.findIndex((item) => item.categoryId === category.categoryId) === index
      )
      .map(({ categoryId, currency }) => [categoryId, currency])
      .sort(([a], [b]) => a.localeCompare(b))
  )
  const requestKey = JSON.stringify([preset, range.start, range.end, categoryKey, authorityKey])
  const [result, setResult] = useState<RangeResult | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // Refresh database-backed currency authority before capturing either the main or rates.
        await useCurrencyStore.getState().loadRates()
        if (cancelled) return
        const state = useCurrencyStore.getState()
        if (currencyAuthorityKey(state) !== authorityKey) return // new effect owns the new key
        const unique = categories.filter(
          (category, index) =>
            categories.findIndex((item) => item.categoryId === category.categoryId) === index
        )
        const rows = await Promise.all(
          unique.map(async (category) => ({
            categoryId: category.categoryId,
            spending: await readBudgetSpending({
              categoryId: category.categoryId,
              ...range,
              currency: state.mainCurrency ?? category.currency,
              rates: state.manualRates,
            }),
          }))
        )
        if (!cancelled && currencyAuthorityKey(useCurrencyStore.getState()) === authorityKey) {
          setResult({ requestKey, rows, error: null })
        }
      } catch (error) {
        if (!cancelled && currencyAuthorityKey(useCurrencyStore.getState()) === authorityKey) {
          setResult({ requestKey, rows: [], error: getErrorMessage(error) })
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // categoryKey is the stable identity of the category selection; changing it cancels prior reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, categoryKey, authorityKey, range.start, range.end, retryCount])

  return {
    range,
    rows: result?.requestKey === requestKey ? result.rows : [],
    error: result?.requestKey === requestKey ? result.error : null,
    loading: result?.requestKey !== requestKey,
    mainCurrency: useCurrencyStore((state) => state.mainCurrency),
    retry: () => {
      setResult(null)
      setRetryCount((count) => count + 1)
    },
  }
}
