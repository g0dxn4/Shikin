import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { useUIStore } from '@/stores/ui-store'
import { useBudgetStore, type BudgetWithStatus } from '@/stores/budget-store'
import { formatMoney } from '@/lib/money'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

function getProgressColor(percent: number): string {
  if (percent > 100) return '#F87171'
  if (percent > 80) return '#F87171'
  if (percent > 60) return '#F59E0B'
  return '#34D399'
}

function getBudgetStatus(percent: number): string {
  if (percent > 100) return 'status.overBudget'
  if (percent > 80) return 'status.critical'
  if (percent > 60) return 'status.warning'
  return 'status.safe'
}

function getProgressGradient(percent: number): string {
  const color = getProgressColor(percent)
  return `linear-gradient(90deg, ${color}cc, ${color})`
}

function BudgetCard({ budget }: { budget: BudgetWithStatus }) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const { openBudgetDialog } = useUIStore()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { remove } = useBudgetStore()

  const isOverBudget = budget.percentUsed > 100
  const displayPercent = Math.min(budget.percentUsed, 100)

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div
        className={`liquid-card group relative overflow-hidden p-5 transition-all duration-200 hover:translate-y-[-2px] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${isOverBudget ? 'border-destructive/30' : ''}`}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-heading text-base font-semibold">{budget.name}</h3>
            <Badge
              variant="secondary"
              className="mt-1 text-[10px]"
              style={{
                backgroundColor: `${budget.categoryColor}20`,
                color: budget.categoryColor,
                borderColor: `${budget.categoryColor}40`,
              }}
            >
              {budget.categoryName}
            </Badge>
          </div>
          <div className="flex gap-1 opacity-100 transition-opacity motion-reduce:transition-none md:opacity-40 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openBudgetDialog(budget.id)}
              aria-label={`${tCommon('actions.edit')} ${budget.name}`}
            >
              <Pencil size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteId(budget.id)}
              aria-label={`${tCommon('actions.delete')} ${budget.name}`}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>

        {/* Percentage */}
        <p
          className="font-heading text-3xl font-bold tracking-tight"
          style={{ color: getProgressColor(budget.percentUsed) }}
        >
          {budget.percentUsed}%
          <span className="sr-only"> {t(getBudgetStatus(budget.percentUsed) as never)}</span>
        </p>

        {/* Progress bar */}
        <div
          className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/5"
          role="progressbar"
          aria-valuenow={budget.percentUsed}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${t('card.progressLabel')}: ${budget.percentUsed}%`}
        >
          <div
            className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
            style={{
              width: `${displayPercent}%`,
              background: getProgressGradient(budget.percentUsed),
            }}
          />
        </div>

        {/* Amounts */}
        <div className="mt-3 flex items-baseline justify-between">
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">{formatMoney(budget.spent)}</span>{' '}
            {t('card.of')} {formatMoney(budget.amount)}
          </p>
          <p className="text-muted-foreground text-xs">
            {isOverBudget
              ? t('card.overBudget')
              : `${formatMoney(Math.max(0, budget.remaining))} ${t('card.remaining')}`}
          </p>
        </div>

        {/* Period */}
        <p className="text-muted-foreground mt-2 font-mono text-[10px] tracking-wider uppercase">
          {t(`periods.${budget.period}`)}
        </p>
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
  )
}

export function Budgets() {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const { openBudgetDialog } = useUIStore()
  const { budgets, isLoading, fetchError, fetch } = useBudgetStore()

  const hasInitialLoadError = !!fetchError && budgets.length === 0

  const summary = useMemo(() => {
    const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0)
    const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0)
    const totalRemaining = budgets.reduce((sum, b) => sum + Math.max(0, b.remaining), 0)
    const avgPercent =
      budgets.length > 0
        ? Math.round(budgets.reduce((sum, b) => sum + b.percentUsed, 0) / budgets.length)
        : 0
    return { totalBudgeted, totalSpent, totalRemaining, avgPercent }
  }, [budgets])

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header p-5">
        <div>
          <p className="text-muted-foreground font-mono text-[10px] tracking-[0.3em] uppercase">
            {t('subtitle')}
          </p>
          <h1 className="font-heading mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {t('title')}
          </h1>
        </div>
        <Button onClick={() => openBudgetDialog()}>
          <Plus size={16} />
          {t('addBudget')}
        </Button>
      </div>

      <ErrorBanner
        title={t('error.load')}
        message={!hasInitialLoadError ? fetchError : null}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      {isLoading ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">{tCommon('status.loading')}</span>
          <div className="liquid-card space-y-2 p-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="liquid-card space-y-3 p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
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
        <div className="liquid-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <PiggyBank size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={() => openBudgetDialog()}>
            <Plus size={16} />
            {t('addBudget')}
          </Button>
        </div>
      ) : (
        <>
          <div className="liquid-hero p-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground mb-1 font-mono text-[10px] tracking-wider uppercase">
                  {t('hero.totalBudgeted')}
                </p>
                <p className="font-heading text-2xl font-bold tracking-tight">
                  {formatMoney(summary.totalBudgeted)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 font-mono text-[10px] tracking-wider uppercase">
                  {t('hero.totalSpent')}
                </p>
                <p className="font-heading text-2xl font-bold tracking-tight">
                  {formatMoney(summary.totalSpent)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 font-mono text-[10px] tracking-wider uppercase">
                  {t('hero.totalRemaining')}
                </p>
                <p className="font-heading text-2xl font-bold tracking-tight">
                  {formatMoney(summary.totalRemaining)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 font-mono text-[10px] tracking-wider uppercase">
                  {t('card.progressLabel')}
                </p>
                <p
                  className="font-heading text-2xl font-bold tracking-tight"
                  style={{ color: getProgressColor(summary.avgPercent) }}
                >
                  {summary.avgPercent}%
                  <span className="sr-only">
                    {' '}
                    {t(getBudgetStatus(summary.avgPercent) as never)}
                  </span>
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {budgets.length} {t('hero.budgetCount')}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {budgets.map((budget) => (
              <BudgetCard key={budget.id} budget={budget} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
