import { Info, Layers, PiggyBank, Plus } from 'lucide-react'
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
}: {
  plans: readonly DisplayBudget[]
  visiblePlans: readonly DisplayBudget[]
  references: ScopedReferences
  onEdit: (id: string) => void
  onDelete: (id: string) => void
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
    <NativePanel aria-labelledby={titleId} className="min-w-0 px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={titleId} className="text-sm font-semibold">
          {t('visual.title')}
        </h2>
        <p className="text-muted-foreground text-xs">{summary}</p>
        <ul
          className="text-muted-foreground flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs"
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
      </div>
      <details className="group mt-1 min-w-0" data-budget-independence>
        <summary className="border-border text-foreground hover:bg-muted focus-visible:ring-ring inline-flex min-h-11 w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none sm:min-h-7 [&::-webkit-details-marker]:hidden">
          <Layers size={12} className="text-accent shrink-0" aria-hidden="true" />
          <span>{t('visual.independent')}</span>
          <Info size={12} className="text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="sr-only">{t('visual.independenceInfo')}</span>
        </summary>
        <div className="text-muted-foreground mt-1 max-w-prose space-y-1 text-xs leading-snug">
          <p>{t('scoped.budgetScope')}</p>
          <p>{t('scoped.nonAdditive')}</p>
          <p>{t('scoped.currentDefinition')}</p>
        </div>
      </details>
      {plans.length === 0 ? (
        <p className="text-muted-foreground py-6 text-sm">{t('visual.noPeriodMatch')}</p>
      ) : (
        <ul className="mt-2 min-w-0">
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
    <NativePanel
      as="div"
      role="status"
      aria-busy="true"
      className="min-w-0 space-y-3 px-3 py-3 sm:px-4"
    >
      <span className="sr-only">{t('status.loading')}</span>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-14 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-2 w-full max-w-md" />
            <Skeleton className="h-4 w-full max-w-md" />
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
