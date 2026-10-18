import { PageToolbar } from '@/components/ui/native-layout'
import { useEffect, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Target, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { useUIStore } from '@/stores/ui-store'
import { useGoalStore } from '@/stores/goal-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { getErrorMessage } from '@/lib/errors'
import { GoalCollection } from '@/components/goals/goal-collection'
import { GoalHero } from '@/components/goals/goal-hero'
import {
  orderGoalCollection,
  resolveSelectedGoal,
  summarizeGoalAuthority,
} from '@/components/goals/goal-presentation'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const GOALS_PAGE_SIZE = 20

export function Goals() {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')
  const { openGoalDialog } = useUIStore()
  const { goals, isLoading, fetchError, fetch, remove } = useGoalStore()
  const mainCurrency = useCurrencyStore((state) => state.mainCurrency)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [visibleGoalCount, setVisibleGoalCount] = useState(GOALS_PAGE_SIZE)
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)

  const hasInitialLoadError = !!fetchError && goals.length === 0
  const orderedGoals = orderGoalCollection(goals)
  const visibleOrderedGoals = orderedGoals.slice(0, visibleGoalCount)
  const selectedGoal = resolveSelectedGoal(goals, selectedGoalId)
  const summary = summarizeGoalAuthority(goals, mainCurrency)

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

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  return (
    <div className="page-content min-w-0">
      <PageToolbar
        leading={
          <div className="flex min-w-0 items-center gap-1">
            <p className="border-border text-foreground max-w-full overflow-x-auto rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap">
              {mainCurrency ?? t('currency.unconfigured')} · {t('scopeChip')}
            </p>
            <details className="group shrink-0">
              <summary
                className="text-muted-foreground focus-visible:ring-ring flex size-11 cursor-pointer list-none items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none sm:size-7 [&::-webkit-details-marker]:hidden"
                aria-label={t('scopeInfo')}
              >
                <Info size={14} aria-hidden="true" />
              </summary>
              <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-snug">
                {t('scope', { currency: mainCurrency ?? t('currency.unconfigured') })}
              </p>
            </details>
          </div>
        }
        actions={
          <Button type="button" className="min-h-11" onClick={() => openGoalDialog()}>
            <Plus aria-hidden="true" />
            {t('addGoal')}
          </Button>
        }
      />

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
          <div className="native-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <Skeleton className="h-36 w-36 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-48 max-w-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <div className="native-panel space-y-3 p-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      ) : hasInitialLoadError ? (
        <ErrorState
          title={t('error.loadDetailed')}
          description={fetchError ?? ''}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : goals.length === 0 ? (
        <div className="native-panel flex flex-col items-center justify-center px-4 py-16 text-center">
          <div className="bg-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <Target size={28} className="text-accent" aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-lg font-medium">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button type="button" className="min-h-11" onClick={() => openGoalDialog()}>
            <Plus aria-hidden="true" />
            {t('addGoal')}
          </Button>
        </div>
      ) : selectedGoal ? (
        <>
          <GoalHero goal={selectedGoal} onEdit={() => openGoalDialog(selectedGoal.id)} />
          <GoalCollection
            goals={visibleOrderedGoals}
            total={orderedGoals.length}
            selectedId={selectedGoal.id}
            summary={summary}
            pageSize={GOALS_PAGE_SIZE}
            onSelect={setSelectedGoalId}
            onEdit={openGoalDialog}
            onDelete={setDeleteId}
            onShowMore={() => setVisibleGoalCount((count) => count + GOALS_PAGE_SIZE)}
          />
        </>
      ) : null}

      <Suspense fallback={null}>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteGoal')}
          description={t('deleteConfirm')}
          confirmLabel={t('deleteGoal')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
      </Suspense>
    </div>
  )
}
