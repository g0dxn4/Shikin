import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { NativePanel } from '@/components/ui/native-layout'
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
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="overview-categories-heading" className="text-base font-semibold">
            {t('overview.spendingByCategory')}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">{t('overview.categoryHint')}</p>
        </div>
        <div className="text-right">
          <p className="text-[17px] font-semibold tabular-nums">
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
        <div className="grid gap-1.5">
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
                className="hover:bg-muted focus-visible:ring-ring grid min-h-9 grid-cols-[minmax(92px,140px)_minmax(100px,1fr)_86px] items-center gap-3 rounded-md px-1 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="truncate text-sm">{item.name}</span>
                <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${width}%`,
                      backgroundColor: item.color ?? 'var(--color-accent)',
                    }}
                  />
                </span>
                <span className="text-right text-sm tabular-nums">
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
