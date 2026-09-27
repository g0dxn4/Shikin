import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import type { BudgetRangePreset } from '@/lib/budget-actual-range'
import { ScopedActualResult } from './scoped-result'
import { useBudgetRangeSpending } from './use-budget-range-spending'

const presets: BudgetRangePreset[] = ['this-month', '3-months', '6-months', 'this-year', 'all-time']

interface Category {
  categoryId: string
  name: string
  currency: string
}

export function CategorySpendingPanel({ categories }: { categories: readonly Category[] }) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const [preset, setPreset] = useState<BudgetRangePreset>('this-month')
  const unique = useMemo(
    () =>
      categories.filter(
        (category, index) =>
          categories.findIndex((item) => item.categoryId === category.categoryId) === index
      ),
    [categories]
  )
  const { range, rows, loading, error, mainCurrency, retry, result, references } =
    useBudgetRangeSpending(unique, preset)
  const byId = new Map(rows.map((row) => [row.categoryId, row.spending]))
  const largest = Math.max(
    0,
    ...rows.map((row) =>
      mainCurrency && row.spending.complete ? (row.spending.totalCentavos ?? 0) : 0
    )
  )

  return (
    <section className="native-panel min-w-0 p-4 sm:p-5" aria-labelledby="category-actuals-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="category-actuals-title" className="text-base font-semibold">
            {t('actual.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{t('actual.scope')}</p>
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          {t('actual.rangeLabel')}
          <select
            className="bg-background text-foreground border-border min-h-10 max-w-full rounded-lg border px-3"
            value={preset}
            onChange={(event) => setPreset(event.target.value as BudgetRangePreset)}
          >
            {presets.map((value) => (
              <option key={value} value={value}>
                {t(`actual.presets.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-muted-foreground mt-2 text-xs tabular-nums">
        {range.start
          ? t('actual.dates', { start: range.start, end: range.end })
          : t('actual.through', { end: range.end })}
      </p>
      {!mainCurrency && !loading && !error && (
        <p role="status" className="text-warning mt-3 text-sm">
          {t('actual.noMain')}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-muted-foreground mt-4 text-sm" aria-busy="true">
          {tCommon('status.loading')}
        </p>
      ) : error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span>{t('actual.error', { message: error })}</span>
          <Button size="sm" variant="secondary" onClick={retry}>
            {t('actual.retry')}
          </Button>
        </div>
      ) : unique.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">{t('actual.emptyCategories')}</p>
      ) : (
        <>
          {mainCurrency &&
            rows.every((row) => row.spending.complete && row.spending.totalCentavos === 0) && (
              <p className="text-muted-foreground mt-3 text-sm">{t('actual.emptySpending')}</p>
            )}
          <p className="text-muted-foreground mt-3 text-xs">{t('actual.chartHint')}</p>
          <ul className="mt-3 space-y-3" aria-label={t('actual.title')}>
            {unique.map((category) => {
              const spending = byId.get(category.categoryId)
              const amount = mainCurrency && spending?.complete ? spending.totalCentavos : null
              const native = spending?.nativeTotals
                .map((item) => formatMoney(item.amountCentavos, item.currency))
                .join(' · ')
              return (
                <li
                  key={category.categoryId}
                  className="border-border min-w-0 border-t pt-3 first:border-0 first:pt-0"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                      {category.name}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {amount !== null && amount !== undefined && mainCurrency
                        ? formatMoney(amount, mainCurrency)
                        : t('actual.unavailable')}
                    </span>
                  </div>
                  {amount !== null && amount !== undefined && largest > 0 && (
                    <div
                      className="bg-muted mt-2 h-2 overflow-hidden rounded-full"
                      aria-hidden="true"
                    >
                      <div
                        className="bg-primary h-full rounded-full"
                        style={{ width: `${Math.max(0, amount / largest) * 100}%` }}
                      />
                    </div>
                  )}
                  {spending && (!spending.complete || !mainCurrency) && (
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed [overflow-wrap:anywhere]">
                      {!spending.complete &&
                        t('actual.incomplete', { count: spending.unresolvedIds.length })}
                      {!spending.complete && native ? ' · ' : ''}
                      {native ? t('actual.native', { values: native }) : t('actual.noNative')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {unique.length > 0 && result && references && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer text-sm">{t('scoped.evidence')}</summary>
          <ScopedActualResult
            compact
            result={result}
            accounts={references.accounts}
            categories={references.categories}
          />
        </details>
      )}
    </section>
  )
}
