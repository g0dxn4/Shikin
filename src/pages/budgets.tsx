import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Lightbulb, PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react'
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

function cents(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function CompactBudgetRow({
  budget,
  onEdit,
  onDelete,
}: {
  budget: BudgetWithStatus
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const displayPercent = Math.min(budget.percentUsed, 100)
  const progressColor = getProgressColor(budget.percentUsed)
  const amount = cents(budget.amount)
  const spent = cents(budget.spent)
  const remaining = cents(budget.remaining)

  return (
    <div className="group rounded-[22px] border border-white/[0.06] bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading truncate text-base font-bold">{budget.categoryName}</p>
          <p className="text-muted-foreground mt-1 truncate text-xs font-medium">{budget.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary" className="text-[10px]" style={{ color: progressColor }}>
            {budget.percentUsed}%
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            onClick={onEdit}
            aria-label={`${tCommon('actions.edit')} ${budget.name}`}
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive/80 hover:text-destructive h-8 w-8"
            onClick={onDelete}
            aria-label={`${tCommon('actions.delete')} ${budget.name}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-valuenow={budget.percentUsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${budget.name}: ${budget.percentUsed}%`}
      >
        <div
          className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${displayPercent}%`, background: progressColor }}
        />
      </div>
      <div className="text-muted-foreground mt-3 flex items-center justify-between gap-3 text-xs">
        <span>
          <span className="text-foreground font-semibold">{formatMoney(spent)}</span> {t('card.of')}{' '}
          {formatMoney(amount)}
        </span>
        <span className={remaining < 0 ? 'text-destructive' : 'text-success'}>
          {remaining < 0
            ? `${formatMoney(Math.abs(remaining))} ${t('card.overBudget')}`
            : `${formatMoney(remaining)} ${t('card.remaining')}`}
        </span>
      </div>
    </div>
  )
}

export function Budgets() {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const { openBudgetDialog } = useUIStore()
  const { budgets, isLoading, fetchError, fetch, remove } = useBudgetStore()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const hasInitialLoadError = !!fetchError && budgets.length === 0

  const summary = useMemo(() => {
    const totalBudgeted = budgets.reduce((sum, b) => sum + cents(b.amount), 0)
    const totalSpent = budgets.reduce((sum, b) => sum + cents(b.spent), 0)
    const totalRemaining = budgets.reduce((sum, b) => sum + Math.max(0, cents(b.remaining)), 0)
    const rawRemaining = totalBudgeted - totalSpent
    const avgPercent =
      budgets.length > 0
        ? Math.round(budgets.reduce((sum, b) => sum + b.percentUsed, 0) / budgets.length)
        : 0
    const overBudgetCount = budgets.filter((b) => b.percentUsed > 100).length
    const warningCount = budgets.filter((b) => b.percentUsed > 80 && b.percentUsed <= 100).length
    return {
      totalBudgeted,
      totalSpent,
      totalRemaining,
      rawRemaining,
      avgPercent,
      overBudgetCount,
      warningCount,
    }
  }, [budgets])

  const progressBudgets = useMemo(
    () => [...budgets].sort((a, b) => b.percentUsed - a.percentUsed),
    [budgets]
  )

  const intelligence = useMemo(() => {
    const overBudget = budgets.find((budget) => budget.percentUsed > 100)
    if (overBudget) {
      return {
        tone: 'danger' as const,
        title: t('intelligence.overTitle'),
        message: t('intelligence.overMessage', {
          category: overBudget.categoryName,
          amount: formatMoney(Math.abs(overBudget.remaining)),
        }),
      }
    }

    const nearLimit = budgets.find((budget) => budget.percentUsed > 80)
    if (nearLimit) {
      return {
        tone: 'warning' as const,
        title: t('intelligence.warningTitle'),
        message: t('intelligence.warningMessage', {
          category: nearLimit.categoryName,
          percent: nearLimit.percentUsed,
          amount: formatMoney(Math.max(0, nearLimit.remaining)),
        }),
      }
    }

    return {
      tone: 'safe' as const,
      title: t('intelligence.safeTitle'),
      message: t('intelligence.safeMessage', {
        amount: formatMoney(summary.totalRemaining),
      }),
    }
  }, [budgets, summary.totalRemaining, t])

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
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[28px]">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">{t('subtitle')}</p>
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
          <div className="liquid-hero min-h-[220px] overflow-hidden p-7 sm:p-8">
            <div className="flex h-full flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-muted-foreground text-base font-bold">{t('hero.safeToSpend')}</p>
                <p
                  className="mt-6 font-mono text-4xl font-bold tracking-[-0.08em] sm:text-5xl md:text-[54px]"
                  style={{ color: summary.rawRemaining < 0 ? '#F87171' : '#34D399' }}
                >
                  {formatMoney(Math.max(0, summary.rawRemaining))}
                </p>
                <p className="text-muted-foreground mt-4 text-sm font-medium">
                  {summary.rawRemaining < 0
                    ? t('hero.overPlan', { amount: formatMoney(Math.abs(summary.rawRemaining)) })
                    : t('hero.safeDescription', { count: budgets.length })}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.05] p-5 lg:min-w-[320px]">
                <p className="font-heading text-2xl font-bold tracking-tight">
                  {summary.avgPercent}% {t('hero.used')}
                </p>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(summary.avgPercent, 100)}%`,
                      background: getProgressColor(summary.avgPercent),
                    }}
                  />
                </div>
                <div className="text-muted-foreground mt-4 grid grid-cols-3 gap-3 text-xs">
                  <span>
                    <strong className="text-foreground block">
                      {formatMoney(summary.totalBudgeted)}
                    </strong>
                    {t('hero.totalBudgeted')}
                  </span>
                  <span>
                    <strong className="text-foreground block">
                      {formatMoney(summary.totalSpent)}
                    </strong>
                    {t('hero.totalSpent')}
                  </span>
                  <span>
                    <strong className="text-foreground block">{summary.overBudgetCount}</strong>
                    {t('hero.overCount')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]">
            <div className="liquid-card min-h-[420px] p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="font-heading text-[23px] font-bold tracking-tight">
                  {t('progress.title')}
                </h2>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {budgets.length} {t('hero.budgetCount')}
                  </Badge>
                  <Button size="sm" variant="secondary" onClick={() => openBudgetDialog()}>
                    <Plus size={13} />
                    {t('addBudget')}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {progressBudgets.map((budget) => (
                  <CompactBudgetRow
                    key={budget.id}
                    budget={budget}
                    onEdit={() => openBudgetDialog(budget.id)}
                    onDelete={() => setDeleteId(budget.id)}
                  />
                ))}
              </div>
            </div>

            <div className="liquid-card min-h-[420px] p-5 sm:p-6">
              <div className="mb-8 flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-2xl"
                  style={{
                    background:
                      intelligence.tone === 'danger'
                        ? 'rgba(248, 113, 113, 0.14)'
                        : intelligence.tone === 'warning'
                          ? 'rgba(245, 158, 11, 0.14)'
                          : 'rgba(52, 211, 153, 0.14)',
                    color:
                      intelligence.tone === 'danger'
                        ? '#F87171'
                        : intelligence.tone === 'warning'
                          ? '#F59E0B'
                          : '#34D399',
                  }}
                >
                  {intelligence.tone === 'safe' ? (
                    <Lightbulb size={18} />
                  ) : (
                    <AlertTriangle size={18} />
                  )}
                </div>
                <h2 className="font-heading text-[23px] font-bold tracking-tight">
                  {t('intelligence.title')}
                </h2>
              </div>
              <p className="font-heading text-2xl leading-snug font-bold tracking-tight">
                {intelligence.title}
              </p>
              <p className="text-muted-foreground mt-4 text-base leading-relaxed font-medium">
                {intelligence.message}
              </p>
              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <p className="text-muted-foreground text-xs font-bold">{t('status.warning')}</p>
                  <p className="font-mono text-2xl font-bold">{summary.warningCount}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <p className="text-muted-foreground text-xs font-bold">
                    {t('status.overBudget')}
                  </p>
                  <p className="font-mono text-2xl font-bold">{summary.overBudgetCount}</p>
                </div>
              </div>
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
