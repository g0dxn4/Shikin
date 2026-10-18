import { useBudgetDisplay } from '@/components/budgets/use-budget-display'
import { useCurrencyStore } from '@/stores/currency-store'
import { currencyAuthorityKey } from '@/stores/currency-authority'
import { useSearchParams } from 'react-router'
import type { ReportWindowInput } from '@shikin/finance-core'
import { WindowControls } from '@/components/budgets/scoped-controls'
import {
  TRANSACTION_PAGE_INVALIDATION_EVENT,
  invalidateTransactionPage,
} from '@/lib/transaction-query-events'
import { PageToolbar } from '@/components/ui/native-layout'
import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { ShowMorePagination } from '@/components/shared/show-more-pagination'
import { useUIStore } from '@/stores/ui-store'
import { useBudgetStore } from '@/stores/budget-store'
import { getErrorMessage } from '@/lib/errors'
import { CategorySpendingPanel } from '@/components/budgets/category-spending-panel'
import { budgetUsageVisual } from '@/components/budgets/budget-visual-model'
import {
  BudgetVisualCollection,
  BudgetVisualEmpty,
  BudgetVisualSkeleton,
} from '@/components/budgets/budget-visual-collection'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const BUDGETS_PAGE_SIZE = 20
const EMPTY_REFERENCES = { accounts: [], categories: [] }

export function Budgets() {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const { openBudgetDialog } = useUIStore()
  const {
    budgets: storedBudgets,
    isLoading: storeLoading,
    fetchError,
    fetch,
    remove,
    options: loadedOptions,
    references: storedReferences,
  } = useBudgetStore()
  const references = storedReferences ?? EMPTY_REFERENCES
  const [searchParams] = useSearchParams()
  const budgetId = searchParams.get('budget') ?? undefined
  const [includeInactive, setIncludeInactive] = useState(false)
  const [windowOptions, setWindowOptions] = useState<ReportWindowInput>({})
  const authority = useCurrencyStore(currencyAuthorityKey)
  const options = useMemo(
    () => ({ ...windowOptions, includeInactive, budgetId }),
    [windowOptions, includeInactive, budgetId]
  )
  const requestKey = JSON.stringify([options, authority])
  const [ownedKey, setOwnedKey] = useState<string | null>(null)
  const isLoading =
    storeLoading ||
    ownedKey !== requestKey ||
    JSON.stringify(options) !== JSON.stringify(loadedOptions)
  const { budgets, error: displayError } = useBudgetDisplay(storedBudgets)
  const [period, setPeriod] = useState('all')
  const scopedBudgets = useMemo(
    () => (period === 'all' ? budgets : budgets.filter((budget) => budget.period === period)),
    [budgets, period]
  )
  const categoryActuals = useMemo(
    () =>
      budgets
        .filter((budget) => budget.is_active === 1 && budget.category_id !== null)
        .map((budget) => ({
          categoryId: budget.category_id!,
          name: budget.categoryName,
          currency: budget.currency,
        })),
    [budgets]
  )
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [visibleBudgetCount, setVisibleBudgetCount] = useState(BUDGETS_PAGE_SIZE)

  const hasInitialLoadError = !!fetchError && budgets.length === 0

  const progressBudgets = useMemo(
    () =>
      [...scopedBudgets].sort(
        (a, b) => (budgetUsageVisual(b).percent ?? -1) - (budgetUsageVisual(a).percent ?? -1)
      ),
    [scopedBudgets]
  )

  const visibleProgressBudgets = progressBudgets.slice(0, visibleBudgetCount)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void fetch(options)
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setOwnedKey(requestKey)
        })
    }
    refresh()
    window.addEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, refresh)
    }
  }, [fetch, options, requestKey])

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="page-content min-w-0">
      <PageToolbar
        className="min-w-0"
        leading={
          <label className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-xs">
            {t('currentPeriodFilter')}
            <select
              className="bg-background text-foreground border-border focus-visible:ring-ring min-h-11 max-w-full min-w-0 rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value)
                setVisibleBudgetCount(BUDGETS_PAGE_SIZE)
              }}
            >
              {(['all', 'weekly', 'monthly', 'yearly'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`periods.${value}`)}
                </option>
              ))}
            </select>
          </label>
        }
        actions={
          <>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => invalidateTransactionPage('store-refresh')}
            >
              {t('scoped.refresh')}
            </Button>
            <Button className="min-h-11" onClick={() => openBudgetDialog()}>
              <Plus size={16} />
              {t('addBudget')}
            </Button>
          </>
        }
      />
      <p className="text-muted-foreground w-full min-w-0 text-xs leading-relaxed text-pretty">
        {t('scoped.budgetScope')}
      </p>

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="focus-visible:ring-ring size-4 focus-visible:ring-2 focus-visible:outline-none"
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
        />
        {t('scoped.includeInactive')}
      </label>
      <div className="min-w-0">
        <WindowControls budget value={windowOptions} onChange={setWindowOptions} />
      </div>
      <ErrorBanner
        title={t('error.load')}
        message={displayError || (!hasInitialLoadError ? fetchError : null)}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      {isLoading ? (
        <BudgetVisualSkeleton />
      ) : hasInitialLoadError ? (
        <ErrorState
          title={t('error.loadDetailed')}
          description={fetchError}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : budgets.length === 0 ? (
        <BudgetVisualEmpty onAdd={() => openBudgetDialog()} />
      ) : (
        <>
          <BudgetVisualCollection
            plans={scopedBudgets}
            visiblePlans={visibleProgressBudgets}
            references={references}
            onEdit={(id) => openBudgetDialog(id)}
            onDelete={setDeleteId}
          />
          <ShowMorePagination
            shown={visibleProgressBudgets.length}
            total={progressBudgets.length}
            summaryLabel={tCommon('pagination.summary', {
              shown: visibleProgressBudgets.length,
              total: progressBudgets.length,
            })}
            showMoreLabel={tCommon('pagination.showMore', {
              count: Math.min(
                BUDGETS_PAGE_SIZE,
                progressBudgets.length - visibleProgressBudgets.length
              ),
            })}
            onShowMore={() => setVisibleBudgetCount((count) => count + BUDGETS_PAGE_SIZE)}
          />
        </>
      )}
      <div
        hidden={isLoading || categoryActuals.length === 0 || ownedKey === null}
        className="min-w-0"
      >
        <CategorySpendingPanel categories={categoryActuals} />
      </div>
      <Suspense>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteBudget')}
          description={t('deleteConfirm')}
          confirmLabel={t('deleteBudget')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
      </Suspense>
    </div>
  )
}
