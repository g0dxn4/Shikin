import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Target, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { useUIStore } from '@/stores/ui-store'
import { useGoalStore, type GoalWithProgress } from '@/stores/goal-store'
import { formatMoney } from '@/lib/money'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

function getProgressColor(percent: number): string {
  if (percent >= 75) return '#34D399'
  if (percent >= 40) return '#F59E0B'
  return '#F87171'
}

function getGoalStatus(progress: number, isCompleted: boolean): string {
  if (isCompleted) return 'status.completed'
  if (progress >= 75) return 'status.onTrack'
  if (progress >= 40) return 'status.atRisk'
  return 'status.critical'
}

function GoalCard({ goal }: { goal: GoalWithProgress }) {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')
  const { openGoalDialog } = useUIStore()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { remove } = useGoalStore()

  const isCompleted = goal.progress >= 100
  const progressColor = getProgressColor(goal.progress)

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

  const daysText =
    goal.daysRemaining !== null
      ? goal.daysRemaining > 0
        ? `${goal.daysRemaining} ${t('card.daysLeft')}`
        : goal.daysRemaining === 0
          ? t('card.dueToday')
          : t('card.overdue')
      : t('card.noDeadline')

  return (
    <>
      <div
        className={`liquid-card group relative overflow-hidden p-5 transition-all duration-200 hover:translate-y-[-2px] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${isCompleted ? 'border-success/30' : ''}`}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
              style={{ backgroundColor: `${goal.color || '#7C5CFF'}20` }}
            >
              {goal.icon || '🎯'}
            </div>
            <div>
              <h3 className="font-heading text-base font-semibold">{goal.name}</h3>
              {goal.accountName && (
                <Badge variant="secondary" className="mt-0.5 text-[10px]">
                  {goal.accountName}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-1 opacity-100 transition-opacity motion-reduce:transition-none md:opacity-40 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openGoalDialog(goal.id)}
              aria-label={`${tCommon('actions.edit')} ${goal.name}`}
            >
              <Pencil size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteId(goal.id)}
              aria-label={`${tCommon('actions.delete')} ${goal.name}`}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>

        {/* Progress ring + percentage */}
        <div className="mb-3 flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0">
            <svg
              className="h-16 w-16 -rotate-90"
              viewBox="0 0 64 64"
              role="progressbar"
              aria-valuenow={goal.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${t('card.progressLabel')}: ${goal.progress}%`}
            >
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="6"
              />
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke={progressColor}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(goal.progress / 100) * 175.93} 175.93`}
                className="transition-all duration-700 motion-reduce:transition-none"
              />
            </svg>
            <span
              className="font-heading absolute inset-0 flex items-center justify-center text-sm font-bold"
              style={{ color: progressColor }}
            >
              {goal.progress}%
              <span className="sr-only">
                {' '}
                {t(getGoalStatus(goal.progress, isCompleted) as never)}
              </span>
            </span>
          </div>
          <div className="flex-1">
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-medium">
                {formatMoney(goal.current_amount)}
              </span>{' '}
              {t('card.of')} {formatMoney(goal.target_amount)}
            </p>
            <p className="text-muted-foreground text-xs">
              {isCompleted
                ? t('card.completed')
                : `${formatMoney(Math.max(0, goal.target_amount - goal.current_amount))} ${t('card.remaining')}`}
            </p>
          </div>
        </div>

        {/* Progress bar (visual only; semantic progress is the ring above) */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/5" aria-hidden="true">
          <div
            className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
            style={{
              width: `${Math.min(goal.progress, 100)}%`,
              backgroundColor: progressColor,
            }}
          />
        </div>

        {/* Footer details */}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            {daysText}
          </p>
          {goal.monthlyNeeded > 0 && !isCompleted && (
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium">{formatMoney(goal.monthlyNeeded)}</span>
              {t('card.monthlyNeeded')}
            </p>
          )}
        </div>

        {goal.notes && (
          <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">{goal.notes}</p>
        )}
      </div>

      <Suspense>
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
    </>
  )
}

export function Goals() {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')
  const { openGoalDialog } = useUIStore()
  const { goals, isLoading, fetchError, fetch } = useGoalStore()

  const hasInitialLoadError = !!fetchError && goals.length === 0

  const featuredGoal = useMemo(() => {
    if (goals.length === 0) return null
    const incomplete = goals.filter((g) => g.progress < 100)
    if (incomplete.length > 0) {
      const withDeadline = incomplete
        .filter((g) => g.deadline)
        .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
      if (withDeadline.length > 0) return withDeadline[0]
      return incomplete.sort((a, b) => b.progress - a.progress)[0]
    }
    return [...goals].sort((a, b) => b.progress - a.progress)[0]
  }, [goals])

  const aggregateProgress = useMemo(() => {
    if (goals.length === 0) return 0
    const totalTarget = goals.reduce((sum, g) => sum + g.target_amount, 0)
    const totalCurrent = goals.reduce((sum, g) => sum + g.current_amount, 0)
    return totalTarget > 0 ? Math.min(100, Math.round((totalCurrent / totalTarget) * 100)) : 0
  }, [goals])

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
        <Button onClick={() => openGoalDialog()}>
          <Plus size={16} />
          {t('addGoal')}
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
          <div className="liquid-card space-y-4 p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-2 w-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="liquid-card space-y-3 p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-1 h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-2 w-full" />
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
      ) : goals.length === 0 ? (
        <div className="liquid-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <Target size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={() => openGoalDialog()}>
            <Plus size={16} />
            {t('addGoal')}
          </Button>
        </div>
      ) : (
        <>
          {featuredGoal && (
            <div className="liquid-hero p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <div className="relative h-20 w-20 shrink-0">
                    <svg
                      className="h-20 w-20 -rotate-90"
                      viewBox="0 0 64 64"
                      role="progressbar"
                      aria-valuenow={featuredGoal.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${t('card.progressLabel')}: ${featuredGoal.progress}%`}
                    >
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        fill="none"
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth="6"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        fill="none"
                        stroke={getProgressColor(featuredGoal.progress)}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${(featuredGoal.progress / 100) * 175.93} 175.93`}
                        className="transition-all duration-700 motion-reduce:transition-none"
                      />
                    </svg>
                    <span className="font-heading absolute inset-0 flex items-center justify-center text-lg font-bold">
                      {featuredGoal.progress}%
                      <span className="sr-only">
                        {' '}
                        {t(
                          getGoalStatus(
                            featuredGoal.progress,
                            featuredGoal.progress >= 100
                          ) as never
                        )}
                      </span>
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
                      {t('hero.featuredGoal')}
                    </p>
                    <h3 className="font-heading text-xl font-bold">{featuredGoal.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      <span className="text-foreground font-medium">
                        {formatMoney(featuredGoal.current_amount)}
                      </span>{' '}
                      {t('card.of')} {formatMoney(featuredGoal.target_amount)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {featuredGoal.daysRemaining !== null
                        ? featuredGoal.daysRemaining > 0
                          ? `${featuredGoal.daysRemaining} ${t('card.daysLeft')}`
                          : featuredGoal.daysRemaining === 0
                            ? t('card.dueToday')
                            : t('card.overdue')
                        : t('card.noDeadline')}
                    </p>
                  </div>
                </div>
                <div className="flex-1 border-t border-white/5 pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
                  <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
                    {t('hero.aggregateProgress')}
                  </p>
                  <p
                    className="font-heading text-2xl font-bold"
                    style={{ color: getProgressColor(aggregateProgress) }}
                  >
                    {aggregateProgress}%
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {goals.length} {t('hero.goalCount')}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {goals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
