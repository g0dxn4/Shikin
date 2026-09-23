import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { NativePanel } from '@/components/ui/native-layout'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { buildTransactionsHref } from '@/lib/transaction-query-href'
import type { CategoryBreakdownItem } from '@/lib/dashboard-analytics'

const PREVIEW_COUNT = 5

interface OverviewCategoriesProps {
  items: CategoryBreakdownItem[]
  total: number
  displayCurrency: string
  comparisonLabel: string
  dateFrom: string
  dateTo: string
  unavailable?: boolean
  unavailableMessage?: string
}

export function OverviewCategories({
  items,
  total,
  displayCurrency,
  comparisonLabel,
  dateFrom,
  dateTo,
  unavailable = false,
  unavailableMessage,
}: OverviewCategoriesProps) {
  const { t } = useTranslation('dashboard')
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? items : items.slice(0, PREVIEW_COUNT)
  const maxAmount = Math.max(1, ...items.map((item) => item.amount))

  return (
    <NativePanel className="p-5 sm:p-6" aria-labelledby="overview-categories-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="overview-categories-heading" className="text-base font-semibold">
            {t('overview.spendingByCategory')}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">{t('overview.categoryHint')}</p>
        </div>
        <div className="max-w-full min-w-0 text-right">
          <p className="text-[17px] font-semibold [overflow-wrap:anywhere] tabular-nums">
            {unavailable ? '—' : formatMoney(total, displayCurrency)}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">{comparisonLabel}</p>
        </div>
      </div>

      {unavailable ? (
        <p className="text-warning py-8 text-center text-sm" role="status">
          {unavailableMessage ?? t('analytics.noEligibleData')}
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t('analytics.noEligibleData')}
        </p>
      ) : (
        <div
          className={cn(
            'grid gap-1.5',
            showAll && items.length > PREVIEW_COUNT && 'md:grid-cols-2 md:gap-x-6'
          )}
        >
          {visible.map((item) => {
            const href = buildTransactionsHref({
              type: 'expense',
              categoryId: item.categoryId,
              dateFrom,
              dateTo,
            })
            const width = Math.max(0, (item.amount / maxAmount) * 100)
            return (
              <Link
                key={item.categoryId}
                to={href}
                className="hover:bg-muted focus-visible:ring-ring grid min-h-11 min-w-0 grid-cols-2 items-center gap-x-3 gap-y-1 rounded-md px-1 py-1 text-left focus-visible:ring-2 focus-visible:outline-none sm:min-h-9 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_minmax(0,110px)] sm:gap-3"
              >
                <span className="truncate text-sm">{item.name}</span>
                <span className="bg-muted order-3 col-span-2 h-1.5 overflow-hidden rounded-full sm:order-none sm:col-span-1">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${width}%`,
                      backgroundColor: item.color ?? 'var(--color-accent)',
                    }}
                  />
                </span>
                <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere] tabular-nums">
                  {formatMoney(item.amount, displayCurrency)}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {!unavailable && items.length > 0 ? (
        <div className="border-border mt-3 flex items-center justify-between gap-3 border-t pt-2.5 text-[11px]">
          <span className="text-muted-foreground">
            {t('overview.showingCategories', { shown: visible.length })}
          </span>
          {items.length > PREVIEW_COUNT ? (
            <button
              type="button"
              className="text-accent min-h-8 font-semibold"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? t('overview.showFewerCategories') : t('overview.showAllCategories')}
            </button>
          ) : null}
        </div>
      ) : null}
    </NativePanel>
  )
}
