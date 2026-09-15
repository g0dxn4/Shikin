import { useBudgetDisplay, type DisplayBudget } from '@/components/budgets/use-budget-display'
import { useCurrencyStore } from '@/stores/currency-store'
import { PageToolbar, MetricStrip, MetricItem } from '@/components/ui/native-layout'
import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Lightbulb, PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react'
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

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const BUDGETS_PAGE_SIZE = 20

function getProgressColor(percent: number): string {
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
  const displayPercent = Math.max(0, Math.min(budget.percentUsed, 100))
  const progressColor = getProgressColor(budget.percentUsed)
  const money = (value: number) => (budget.complete ? formatMoney(value, budget.currency) : '—')
  const amount = cents(budget.amount)
  const spent = cents(budget.spent)
  const remaining = cents(budget.remaining)

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
            {budget.complete ? `${budget.percentUsed}%` : '—'}
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
        aria-valuenow={budget.complete ? displayPercent : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${budget.name}: ${budget.complete ? `${budget.percentUsed}%` : '—'}`}
      >
        <div
          className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${budget.complete ? displayPercent : 0}%`, background: progressColor }}
        />
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span>
          <span className="text-foreground font-semibold">{money(spent)}</span> {t('card.of')}{' '}
          {money(amount)}
        </span>
        <span className={remaining < 0 ? 'text-destructive' : 'text-success'}>
          {remaining < 0
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
  const complete = scopedBudgets.every((budget) => budget.complete)
  const money = (amount: number) => (complete ? formatMoney(amount, preferredCurrency) : '—')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [visibleBudgetCount, setVisibleBudgetCount] = useState(BUDGETS_PAGE_SIZE)

  const hasInitialLoadError = !!fetchError && budgets.length === 0

  const summary = useMemo(() => {
    const totalBudgeted = scopedBudgets.reduce((sum, b) => sum + cents(b.amount), 0)
    const totalSpent = scopedBudgets.reduce((sum, b) => sum + cents(b.spent), 0)
    const totalRemaining = scopedBudgets.reduce(
      (sum, b) => sum + Math.max(0, cents(b.remaining)),
      0
    )
    const rawRemaining = totalBudgeted - totalSpent
    const avgPercent =
      scopedBudgets.length > 0
        ? Math.round(
            scopedBudgets.reduce((sum, b) => sum + b.percentUsed, 0) / scopedBudgets.length
          )
        : 0
    const overBudgetCount = scopedBudgets.filter((b) => b.percentUsed > 100).length
    const warningCount = scopedBudgets.filter(
      (b) => b.percentUsed > 80 && b.percentUsed <= 100
    ).length
    return {
      totalBudgeted,
      totalSpent,
      totalRemaining,
      rawRemaining,
      avgPercent,
      overBudgetCount,
      warningCount,
    }
  }, [scopedBudgets])

  const progressBudgets = useMemo(
    () => [...scopedBudgets].sort((a, b) => b.percentUsed - a.percentUsed),
    [scopedBudgets]
  )

  const visibleProgressBudgets = progressBudgets.slice(0, visibleBudgetCount)

  const intelligence = useMemo(() => {
    const overBudget = scopedBudgets.find((budget) => budget.percentUsed > 100)
    if (overBudget) {
      return {
        tone: 'danger' as const,
        title: t('intelligence.overTitle'),
        message: t('intelligence.overMessage', {
          category: overBudget.categoryName,
          amount: formatMoney(Math.abs(overBudget.remaining), preferredCurrency),
        }),
      }
    }

    const nearLimit = scopedBudgets.find((budget) => budget.percentUsed > 80)
    if (nearLimit) {
      return {
        tone: 'warning' as const,
        title: t('intelligence.warningTitle'),
        message: t('intelligence.warningMessage', {
          category: nearLimit.categoryName,
          percent: nearLimit.percentUsed,
          amount: formatMoney(Math.max(0, nearLimit.remaining), preferredCurrency),
        }),
      }
    }

    return {
      tone: 'safe' as const,
      title: t('intelligence.safeTitle'),
      message: t('intelligence.safeMessage', {
        amount: formatMoney(summary.totalRemaining, preferredCurrency),
      }),
    }
  }, [scopedBudgets, summary.totalRemaining, t, preferredCurrency])

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
            {t('form.period')}
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
            <span>{t('scope', { currency: preferredCurrency })}</span>
          </label>
        }
        actions={
          <Button onClick={() => openBudgetDialog()}>
            <Plus size={16} />
            {t('addBudget')}
          </Button>
        }
      />

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
          <div className="native-panel space-y-2 p-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="native-panel space-y-3 p-5">
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
          <MetricStrip>
            <MetricItem label={t('hero.totalBudgeted')} value={money(summary.totalBudgeted)} />
            <MetricItem label={t('hero.totalSpent')} value={money(summary.totalSpent)} />
            <MetricItem label={t('hero.totalRemaining')} value={money(summary.rawRemaining)} />
            <MetricItem
              label={t('hero.overCount')}
              value={complete ? summary.overBudgetCount : '—'}
              detail={complete ? `${summary.avgPercent}% ${t('hero.used')}` : undefined}
            />
          </MetricStrip>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
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

            <div className="native-panel p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl sm:h-10 sm:w-10"
                  style={{
                    background:
                      intelligence.tone === 'danger'
                        ? 'color-mix(in srgb, var(--color-destructive) 12%, transparent)'
                        : intelligence.tone === 'warning'
                          ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)'
                          : 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                    color:
                      intelligence.tone === 'danger'
                        ? 'var(--color-destructive)'
                        : intelligence.tone === 'warning'
                          ? 'var(--color-warning)'
                          : 'var(--color-success)',
                  }}
                >
                  {intelligence.tone === 'safe' ? (
                    <Lightbulb size={18} />
                  ) : (
                    <AlertTriangle size={18} />
                  )}
                </div>
                <h2 className="text-base font-semibold">{t('intelligence.title')}</h2>
              </div>
              <p className="text-base leading-snug font-semibold">
                {complete ? intelligence.title : t('currency.unavailable')}
              </p>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                {complete ? intelligence.message : t('currency.description')}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="border-border bg-muted/50 rounded-xl border p-4">
                  <p className="text-muted-foreground text-xs font-bold">{t('status.warning')}</p>
                  <p className="text-2xl font-bold tabular-nums">
                    {complete ? summary.warningCount : '—'}
                  </p>
                </div>
                <div className="border-border bg-muted/50 rounded-xl border p-4">
                  <p className="text-muted-foreground text-xs font-bold">
                    {t('status.overBudget')}
                  </p>
                  <p className="text-2xl font-bold tabular-nums">
                    {complete ? summary.overBudgetCount : '—'}
                  </p>
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
