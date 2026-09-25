import { useBudgetDisplay, type DisplayBudget } from '@/components/budgets/use-budget-display'
import { useCurrencyStore } from '@/stores/currency-store'
import { PageToolbar } from '@/components/ui/native-layout'
import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { ShowMorePagination } from '@/components/shared/show-more-pagination'
import { useUIStore } from '@/stores/ui-store'
import { useBudgetStore } from '@/stores/budget-store'
import { formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { CategorySpendingPanel } from '@/components/budgets/category-spending-panel'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const BUDGETS_PAGE_SIZE = 20

function getProgressColor(percent: number | null): string {
  if (percent === null) return 'var(--color-muted-foreground)'
  if (percent > 100) return 'var(--color-destructive)'
  if (percent > 80) return 'var(--color-destructive)'
  if (percent > 60) return 'var(--color-warning)'
  return 'var(--color-success)'
}

function cents(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function CompactBudgetRow({
  budget,
  onEdit,
  onDelete,
}: {
  budget: DisplayBudget
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const displayPercent = Math.max(0, Math.min(budget.percentUsed ?? 0, 100))
  const progressColor = getProgressColor(budget.percentUsed)
  const money = (value: number | null) =>
    value === null ? '—' : formatMoney(value, budget.currency)
  const amount = cents(budget.amount)
  const spent = budget.complete ? cents(budget.spent) : null
  const remaining = budget.complete ? cents(budget.remaining) : null

  return (
    <div className="group border-border bg-muted/50 hover:bg-muted/50 rounded-xl border p-4 transition-colors">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{budget.categoryName}</p>
          <p className="text-muted-foreground mt-1 truncate text-xs font-medium">
            <span>{budget.name}</span> · {t(`periods.${budget.period}`)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary" className="text-[10px]" style={{ color: progressColor }}>
            {budget.complete && budget.percentUsed !== null ? `${budget.percentUsed}%` : '—'}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-11 w-11 sm:h-10 sm:w-10"
            onClick={onEdit}
            aria-label={`${tCommon('actions.edit')} ${budget.name}`}
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive/80 hover:text-destructive h-11 w-11 sm:h-10 sm:w-10"
            onClick={onDelete}
            aria-label={`${tCommon('actions.delete')} ${budget.name}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
      <div
        className="bg-muted/50 h-2.5 overflow-hidden rounded-full"
        role={budget.complete ? 'progressbar' : undefined}
        aria-valuenow={budget.complete && budget.percentUsed !== null ? displayPercent : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${budget.name}: ${budget.complete && budget.percentUsed !== null ? `${budget.percentUsed}%` : '—'}`}
      >
        <div
          className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
          style={{
            width: `${budget.complete && budget.percentUsed !== null ? displayPercent : 0}%`,
            background: progressColor,
          }}
        />
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span>
          <span className="text-foreground font-semibold">{money(spent)}</span> {t('card.of')}{' '}
          {money(amount)}
        </span>
        <span className={remaining !== null && remaining < 0 ? 'text-destructive' : 'text-success'}>
          {remaining === null
            ? '—'
            : remaining < 0
              ? `${money(Math.abs(remaining))} ${t('card.overBudget')}`
              : `${money(remaining)} ${t('card.remaining')}`}
        </span>
      </div>
    </div>
  )
}

export function Budgets() {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const { openBudgetDialog } = useUIStore()
  const { budgets: storedBudgets, isLoading, fetchError, fetch, remove } = useBudgetStore()
  const { budgets, error: displayError } = useBudgetDisplay(storedBudgets)
  const { preferredCurrency } = useCurrencyStore()
  const [period, setPeriod] = useState('all')
  const scopedBudgets = useMemo(
    () => (period === 'all' ? budgets : budgets.filter((budget) => budget.period === period)),
    [budgets, period]
  )
  const categoryActuals = useMemo(
    () =>
      budgets
        .filter((budget) => budget.category_id !== null)
        .map((budget) => ({
          categoryId: budget.category_id!,
          name: budget.categoryName,
          currency: budget.currency,
        })),
    [budgets]
  )
  const complete = scopedBudgets.every((budget) => budget.mainComplete)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [visibleBudgetCount, setVisibleBudgetCount] = useState(BUDGETS_PAGE_SIZE)

  const hasInitialLoadError = !!fetchError && budgets.length === 0

  const progressBudgets = useMemo(
    () => [...scopedBudgets].sort((a, b) => (b.percentUsed ?? -1) - (a.percentUsed ?? -1)),
    [scopedBudgets]
  )

  const visibleProgressBudgets = progressBudgets.slice(0, visibleBudgetCount)

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

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
    <div className="page-content">
      <PageToolbar
        leading={
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            {t('currentPeriodFilter')}
            <select
              className="bg-background text-foreground border-border min-h-10 rounded-lg border px-3"
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
          <Button onClick={() => openBudgetDialog()}>
            <Plus size={16} />
            {t('addBudget')}
          </Button>
        }
      />
      <p className="text-muted-foreground w-full min-w-0 text-xs leading-relaxed text-pretty">
        {t('scope', { currency: preferredCurrency })}
      </p>

      {storedBudgets.length > 0 && !complete && (
        <p role="status" className="text-warning text-xs">
          {t('currency.unavailable')}
        </p>
      )}
      <ErrorBanner
        title={t('error.load')}
        message={displayError || (!hasInitialLoadError ? fetchError : null)}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      {isLoading ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">{tCommon('status.loading')}</span>
          <div className="flex flex-col gap-3">
            <div className="native-panel space-y-3 p-5 sm:p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
            <div className="native-panel space-y-3 p-4 sm:px-5 sm:py-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      ) : hasInitialLoadError ? (
        <ErrorState
          title={t('error.loadDetailed')}
          description={fetchError}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : budgets.length === 0 ? (
        <div className="native-panel flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <PiggyBank size={28} className="text-primary" />
          </div>
          <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={() => openBudgetDialog()}>
            <Plus size={16} />
            {t('addBudget')}
          </Button>
        </div>
      ) : (
        <>
          <CategorySpendingPanel categories={categoryActuals} />
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {t('currentContext')}
          </p>
          <div className="flex flex-col gap-3">
            <div className="native-panel p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t('progress.title')}</h2>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {scopedBudgets.length} {t('hero.budgetCount')}
                  </Badge>
                  <Button size="sm" variant="secondary" onClick={() => openBudgetDialog()}>
                    <Plus size={13} />
                    {t('addBudget')}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {visibleProgressBudgets.map((budget) => (
                  <CompactBudgetRow
                    key={budget.id}
                    budget={budget}
                    onEdit={() => openBudgetDialog(budget.id)}
                    onDelete={() => setDeleteId(budget.id)}
                  />
                ))}
              </div>
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
                className="mt-4"
              />
            </div>
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
        </>
      )}
    </div>
  )
}
