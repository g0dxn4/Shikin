import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Target, Plus, Pencil, Trash2, Sparkles, CalendarClock } from 'lucide-react'
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

type GoalDayTextKey = 'card.noDeadline' | 'card.daysLeft' | 'card.dueToday' | 'card.overdue'

function getDaysText(goal: GoalWithProgress, t: (key: GoalDayTextKey) => string): string {
  if (goal.daysRemaining === null) return t('card.noDeadline')
  if (goal.daysRemaining > 0) return `${goal.daysRemaining} ${t('card.daysLeft')}`
  if (goal.daysRemaining === 0) return t('card.dueToday')
  return t('card.overdue')
}

function GoalRow({
  goal,
  onEdit,
  onDelete,
}: {
  goal: GoalWithProgress
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')
  const isCompleted = goal.progress >= 100
  const progressColor = getProgressColor(goal.progress)

  return (
    <div
      className={`group rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05] ${isCompleted ? 'border-success/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg"
            style={{ backgroundColor: `${goal.color || '#7C5CFF'}20` }}
          >
            {goal.icon || '🎯'}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="font-heading truncate text-base font-semibold">{goal.name}</h3>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {goal.progress}%
              </Badge>
            </div>
            <p className="text-muted-foreground truncate text-xs">
              {goal.accountName ? goal.accountName : getDaysText(goal, t)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1 opacity-100 transition-opacity motion-reduce:transition-none md:opacity-50 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onEdit}
            aria-label={`${tCommon('actions.edit')} ${goal.name}`}
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-8 w-8"
            onClick={onDelete}
            aria-label={`${tCommon('actions.delete')} ${goal.name}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/5" aria-hidden="true">
        <div
          className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${Math.min(goal.progress, 100)}%`, backgroundColor: progressColor }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">{formatMoney(goal.current_amount)}</span>{' '}
          {t('card.of')} {formatMoney(goal.target_amount)}
        </p>
        <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
          {isCompleted ? t('card.completed') : getDaysText(goal, t)}
        </p>
      </div>
    </div>
  )
}

export function Goals() {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')
  const { openGoalDialog } = useUIStore()
  const { goals, isLoading, fetchError, fetch, remove } = useGoalStore()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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

  const orderedGoals = useMemo(() => {
    return [...goals].sort((a, b) => {
      if (a.progress >= 100 && b.progress < 100) return 1
      if (b.progress >= 100 && a.progress < 100) return -1
      return b.progress - a.progress
    })
  }, [goals])

  const automationGoal = featuredGoal ?? orderedGoals[0] ?? null

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

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[28px]">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">{t('subtitle')}</p>
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
          <div className="liquid-hero space-y-6 p-7">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-12 w-80" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1fr)]">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="liquid-card space-y-4 p-5">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
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
            <div className="liquid-hero min-h-[280px] overflow-hidden p-7 sm:p-8">
              <div className="flex h-full flex-col justify-between gap-8">
                <div>
                  <p className="text-muted-foreground font-mono text-[10px] tracking-[0.3em] uppercase">
                    {t('hero.featuredGoal')}
                  </p>
                  <h2 className="font-heading mt-3 text-3xl font-bold tracking-tight">
                    {featuredGoal.name}
                  </h2>
                  <p className="mt-5 font-mono text-3xl font-bold tracking-tight sm:text-4xl">
                    {formatMoney(featuredGoal.current_amount)} /{' '}
                    {formatMoney(featuredGoal.target_amount)}
                  </p>
                </div>

                <div>
                  <div
                    className="h-3.5 w-full overflow-hidden rounded-full bg-white/10"
                    role="progressbar"
                    aria-valuenow={featuredGoal.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${t('card.progressLabel')}: ${featuredGoal.progress}%`}
                  >
                    <div
                      className="h-full rounded-full bg-[#BFA4FF] transition-all duration-700 motion-reduce:transition-none"
                      style={{ width: `${Math.min(featuredGoal.progress, 100)}%` }}
                    />
                  </div>
                  <div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <p className="text-muted-foreground text-base font-bold">
                      {featuredGoal.deadline
                        ? `${t('hero.expectedCompletion')}: ${new Date(featuredGoal.deadline).toLocaleDateString()}`
                        : getDaysText(featuredGoal, t)}
                    </p>
                    <div className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-4 sm:min-w-[220px]">
                      <p className="text-muted-foreground text-xs font-bold tracking-[0.14em] uppercase">
                        {t('hero.aggregateProgress')}
                      </p>
                      <p
                        className="font-heading mt-1 text-3xl font-bold"
                        style={{ color: getProgressColor(aggregateProgress) }}
                      >
                        {aggregateProgress}%
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {goals.length} {t('hero.goalCount')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1fr)]">
            <section className="liquid-card min-h-[340px] p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="font-heading text-2xl font-bold tracking-tight">
                  {t('active.title')}
                </h2>
                <Badge variant="secondary" className="text-[10px]">
                  {goals.length} {t('hero.goalCount')}
                </Badge>
              </div>
              <div className="space-y-3">
                {orderedGoals.map((goal) => (
                  <GoalRow
                    key={goal.id}
                    goal={goal}
                    onEdit={() => openGoalDialog(goal.id)}
                    onDelete={() => setDeleteId(goal.id)}
                  />
                ))}
              </div>
            </section>

            <section className="liquid-card min-h-[340px] p-5 sm:p-6">
              <div className="mb-8 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-heading text-2xl font-bold tracking-tight">
                    {t('automation.title')}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">{t('automation.subtitle')}</p>
                </div>
                <div className="bg-accent-muted text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                  <Sparkles size={20} />
                </div>
              </div>

              <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-5">
                <div className="mb-4 flex items-center gap-3">
                  <CalendarClock size={18} className="text-primary" />
                  <p className="font-heading text-lg font-bold">
                    {automationGoal ? automationGoal.name : t('automation.noGoal')}
                  </p>
                </div>
                <p className="text-muted-foreground text-base leading-relaxed font-semibold">
                  {automationGoal && automationGoal.monthlyNeeded > 0
                    ? t('automation.monthlyMove', {
                        amount: formatMoney(automationGoal.monthlyNeeded),
                        goal: automationGoal.name,
                      })
                    : automationGoal
                      ? t('automation.keepPace', { goal: automationGoal.name })
                      : t('automation.empty')}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <p className="text-muted-foreground text-xs font-bold">
                    {t('automation.remaining')}
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold">
                    {automationGoal
                      ? formatMoney(
                          Math.max(0, automationGoal.target_amount - automationGoal.current_amount)
                        )
                      : formatMoney(0)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <p className="text-muted-foreground text-xs font-bold">
                    {t('automation.deadline')}
                  </p>
                  <p className="mt-1 text-sm font-bold">
                    {automationGoal ? getDaysText(automationGoal, t) : t('card.noDeadline')}
                  </p>
                </div>
              </div>
            </section>
          </div>
        </>
      )}

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
