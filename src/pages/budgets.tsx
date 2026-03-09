import { useEffect, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useUIStore } from '@/stores/ui-store'
import { useBudgetStore, type BudgetWithStatus } from '@/stores/budget-store'
import { formatMoney } from '@/lib/money'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

function getProgressColor(percent: number): string {
  if (percent > 80) return '#ef4444'
  if (percent > 60) return '#f59e0b'
  return '#22c55e'
}

function getProgressGradient(percent: number): string {
  const color = getProgressColor(percent)
  return `linear-gradient(90deg, ${color}cc, ${color})`
}

function BudgetCard({ budget }: { budget: BudgetWithStatus }) {
  const { t } = useTranslation('budgets')
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
        className="glass-card group relative overflow-hidden p-5 transition-transform duration-200 hover:translate-y-[-2px]"
        style={
          isOverBudget
            ? { boxShadow: '0 0 24px rgba(239, 68, 68, 0.15), inset 0 0 0 1px rgba(239, 68, 68, 0.2)' }
            : undefined
        }
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
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => openBudgetDialog(budget.id)}
            >
              <Pencil size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive h-7 w-7"
              onClick={() => setDeleteId(budget.id)}
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
        </p>

        {/* Progress bar */}
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${displayPercent}%`,
              background: getProgressGradient(budget.percentUsed),
            }}
          />
        </div>

        {/* Amounts */}
        <div className="mt-3 flex items-baseline justify-between">
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">
              {formatMoney(budget.spent)}
            </span>
            {' '}{t('card.of')}{' '}
            {formatMoney(budget.amount)}
          </p>
          <p className="text-muted-foreground text-xs">
            {isOverBudget
              ? t('card.overBudget')
              : `${formatMoney(Math.max(0, budget.remaining))} ${t('card.remaining')}`}
          </p>
        </div>

        {/* Period */}
        <p className="text-muted-foreground mt-2 font-mono text-[10px] uppercase tracking-wider">
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
          cancelLabel=""
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
  const { openBudgetDialog } = useUIStore()
  const { budgets, isLoading, fetch } = useBudgetStore()

  useEffect(() => {
    fetch()
  }, [fetch])

  return (
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => openBudgetDialog()}>
          <Plus size={16} />
          {t('addBudget')}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card space-y-3 p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : budgets.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetCard key={budget.id} budget={budget} />
          ))}
        </div>
      )}
    </div>
  )
}
