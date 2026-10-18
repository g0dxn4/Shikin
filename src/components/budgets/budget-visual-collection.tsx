import { PiggyBank, Plus } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScopedReferences } from '@/lib/scoped-report-read'
import type { DisplayBudget } from '@/components/budgets/use-budget-display'
import { budgetUsageStatusCounts } from '@/components/budgets/budget-visual-model'
import { BudgetVisualPlan } from '@/components/budgets/budget-visual-plan'
import { NativePanel } from '@/components/ui/native-layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function BudgetVisualCollection({
  plans,
  visiblePlans,
  references,
  onEdit,
  onDelete,
  onAdd,
}: {
  plans: readonly DisplayBudget[]
  visiblePlans: readonly DisplayBudget[]
  references: ScopedReferences
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const { t } = useTranslation('budgets')
  const titleId = useId()
  const counts = budgetUsageStatusCounts(plans)
  const summary = [
    t(counts.total === 1 ? 'visual.count_one' : 'visual.count_other', { count: counts.total }),
    counts.over > 0
      ? t(counts.over === 1 ? 'visual.overCount_one' : 'visual.overCount_other', {
          count: counts.over,
        })
      : null,
    counts.tight > 0
      ? t(counts.tight === 1 ? 'visual.tightCount_one' : 'visual.tightCount_other', {
          count: counts.tight,
        })
      : null,
    counts.unavailable > 0
      ? t(
          counts.unavailable === 1
            ? 'visual.unavailableCount_one'
            : 'visual.unavailableCount_other',
          { count: counts.unavailable }
        )
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <NativePanel aria-labelledby={titleId} className="min-w-0 p-4 sm:p-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {t('visual.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">{summary}</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11" onClick={onAdd}>
          <Plus size={16} />
          {t('addBudget')}
        </Button>
      </div>
      <ul
        className="text-muted-foreground mt-3 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs"
        aria-label={t('visual.legend')}
      >
        <li className="text-success flex items-center gap-1.5">
          <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
          {t('status.safe')}
        </li>
        <li className="text-warning flex items-center gap-1.5">
          <span className="bg-warning size-1.5 rounded-full" aria-hidden="true" />
          {t('status.warning')}
        </li>
        <li className="text-destructive flex items-center gap-1.5">
          <span className="bg-destructive size-1.5 rounded-full" aria-hidden="true" />
          {t('status.critical')}
        </li>
        <li className="text-destructive flex items-center gap-1.5">
          <span className="bg-destructive size-1.5 rounded-full" aria-hidden="true" />
          {t('status.overBudget')}
        </li>
      </ul>
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed text-pretty">
        {t('scoped.currentDefinition')} {t('scoped.nonAdditive')}
      </p>
      {plans.length === 0 ? (
        <p className="text-muted-foreground py-8 text-sm">{t('visual.noPeriodMatch')}</p>
      ) : (
        <ul className="mt-4 min-w-0">
          {visiblePlans.map((budget) => (
            <BudgetVisualPlan
              key={budget.id}
              budget={budget}
              references={references}
              onEdit={() => onEdit(budget.id)}
              onDelete={() => onDelete(budget.id)}
            />
          ))}
        </ul>
      )}
    </NativePanel>
  )
}

export function BudgetVisualSkeleton() {
  const { t } = useTranslation('common')
  return (
    <NativePanel as="div" role="status" aria-busy="true" className="min-w-0 space-y-6 p-4 sm:p-6">
      <span className="sr-only">{t('status.loading')}</span>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex min-w-0 items-center gap-4">
          <Skeleton className="size-[5.5rem] shrink-0 rounded-full sm:size-24" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44 max-w-full" />
            <Skeleton className="h-7 w-full max-w-sm" />
          </div>
        </div>
      ))}
    </NativePanel>
  )
}

export function BudgetVisualEmpty({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation('budgets')
  return (
    <NativePanel
      as="div"
      className="flex min-w-0 flex-col items-center justify-center px-4 py-16 text-center"
    >
      <div className="bg-accent-muted mb-4 flex size-14 items-center justify-center rounded-full">
        <PiggyBank size={28} className="text-accent" aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
      <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
      <Button type="button" className="min-h-11" onClick={onAdd}>
        <Plus size={16} />
        {t('addBudget')}
      </Button>
    </NativePanel>
  )
}
