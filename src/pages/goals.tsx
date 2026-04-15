import { useEffect, useState, lazy, Suspense } from 'react'
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
  if (percent >= 75) return '#22c55e'
  if (percent >= 40) return '#f59e0b'
  return '#ef4444'
}

function GoalCard({ goal }: { goal: GoalWithProgress }) {
  const { t } = useTranslation('goals')
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

  return (
    <>
      <div
        className="glass-card group relative overflow-hidden p-5 transition-transform duration-200 hover:translate-y-[-2px]"
        style={
          isCompleted
            ? {
                boxShadow:
                  '0 0 24px rgba(34, 197, 94, 0.15), inset 0 0 0 1px rgba(34, 197, 94, 0.2)',
              }
            : undefined
        }
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
              style={{ backgroundColor: `${goal.color || '#bf5af2'}20` }}
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
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => openGoalDialog(goal.id)}
              aria-label={`Edit ${goal.name}`}
            >
              <Pencil size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive h-7 w-7"
              onClick={() => setDeleteId(goal.id)}
              aria-label={`Delete ${goal.name}`}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>

        {/* Progress ring + percentage */}
        <div className="mb-3 flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0">
            <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
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
                className="transition-all duration-700"
              />
            </svg>
            <span
              className="font-heading absolute inset-0 flex items-center justify-center text-sm font-bold"
              style={{ color: progressColor }}
            >
              {goal.progress}%
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

        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(goal.progress, 100)}%`,
              backgroundColor: progressColor,
            }}
          />
        </div>

        {/* Footer details */}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            {goal.daysRemaining !== null
              ? goal.daysRemaining > 0
                ? `${goal.daysRemaining} ${t('card.daysLeft')}`
                : t('card.overdue')
              : t('card.noDeadline')}
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
          cancelLabel=""
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
  const { openGoalDialog } = useUIStore()
  const { goals, isLoading, fetchError, fetch } = useGoalStore()

  const hasInitialLoadError = !!fetchError && goals.length === 0

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  return (
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => openGoalDialog()}>
          <Plus size={16} />
          {t('addGoal')}
        </Button>
      </div>

      <ErrorBanner
        title="Couldn’t load goals"
        message={!hasInitialLoadError ? fetchError : null}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card space-y-3 p-5">
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
      ) : hasInitialLoadError ? (
        <ErrorState
          title="Couldn’t load your goals"
          description={fetchError}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : goals.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </div>
      )}
    </div>
  )
}
