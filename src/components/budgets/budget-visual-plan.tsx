import { Pencil, Tag, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ScopedReferences } from '@/lib/scoped-report-read'
import type { DisplayBudget } from '@/components/budgets/use-budget-display'
import { ScopedActualResult } from '@/components/budgets/scoped-result'
import { budgetUsageVisual } from '@/components/budgets/budget-visual-model'
import { BudgetUsageRing } from '@/components/budgets/budget-usage-ring'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

const TONE_CLASS = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  unavailable: 'text-muted-foreground',
} as const

function categoryMarkColor(color: string | null | undefined): string {
  if (!color || color === 'var(--muted-foreground)') return 'var(--color-muted-foreground)'
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  if (/^var\(--color-[a-z0-9-]+\)$/i.test(color)) return color
  return 'var(--color-muted-foreground)'
}

function nativeMoney(value: number | null | undefined, currency: string): string {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? formatMoney(value, currency)
    : '—'
}

function CategoryMark({ color }: { color: string }) {
  return (
    <span
      className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-lg"
      style={{ boxShadow: `inset 0 0 0 2px ${color}` }}
      aria-hidden="true"
    >
      <Tag size={16} />
    </span>
  )
}

function Amount({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          'mt-1 max-w-full overflow-x-auto font-medium whitespace-nowrap tabular-nums',
          emphasis ? 'text-destructive text-xl sm:text-2xl' : 'text-foreground text-xl sm:text-2xl'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export function BudgetVisualPlan({
  budget,
  references,
  onEdit,
  onDelete,
}: {
  budget: DisplayBudget
  references: ScopedReferences
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const visual = budgetUsageVisual(budget)
  const currency = budget.currency
  const spent = nativeMoney(budget.spent, currency)
  const limit = nativeMoney(budget.limitCentavos, currency)
  const remaining = nativeMoney(budget.remaining, currency)
  const category = budget.categoryName || t('scoped.allCategories')
  const basis = budget.result?.basis ? t(`scoped.${budget.result.basis}`) : null
  const reportWindow = budget.result?.window
  const mark = categoryMarkColor(budget.categoryColor)
  const status = t(`status.${visual.status === 'unavailable' ? 'safe' : visual.status}`)
  const statusText = !visual.filled
    ? t('visual.unavailable')
    : visual.status === 'overBudget' && typeof budget.remaining === 'number' && budget.remaining < 0
      ? t('visual.overLine', {
          status: t('status.overBudget'),
          amount: formatMoney(Math.abs(budget.remaining), currency),
          percent: visual.percent,
        })
      : t('visual.statusLine', { status, percent: visual.percent })
  const label = !visual.filled
    ? t('visual.unfilledLabel', { name: budget.name, category, spent, limit, remaining })
    : visual.percent !== null && visual.percent > 100
      ? t('visual.overLabel', {
          name: budget.name,
          category,
          percent: visual.percent,
          spent,
          limit,
          remaining,
          status: t('status.overBudget'),
        })
      : t('visual.filledLabel', {
          name: budget.name,
          category,
          percent: visual.percent,
          spent,
          limit,
          remaining,
          status,
        })

  return (
    <li
      className="border-border min-w-0 border-t py-6 first:border-t-0 first:pt-5"
      data-budget-plan={budget.id}
    >
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <BudgetUsageRing
          visual={visual}
          label={label}
          percentText={visual.filled && visual.percent !== null ? `${visual.percent}%` : '—'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <CategoryMark color={mark} />
              <div className="min-w-0">
                <p className="text-base font-semibold [overflow-wrap:anywhere]">{category}</p>
                <p className="mt-0.5 text-sm [overflow-wrap:anywhere]">{budget.name}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground h-11 w-11"
                onClick={onEdit}
                aria-label={`${tCommon('actions.edit')} ${budget.name}`}
              >
                <Pencil size={16} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive h-11 w-11"
                onClick={onDelete}
                aria-label={`${tCommon('actions.delete')} ${budget.name}`}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-xs [overflow-wrap:anywhere]">
            <span>{t(`periods.${budget.period}`)}</span>
            <span aria-hidden="true"> · </span>
            <span>{currency}</span>
            {basis ? (
              <>
                <span aria-hidden="true"> · </span>
                <span>{basis}</span>
              </>
            ) : null}
          </p>
          {reportWindow?.start && reportWindow.end ? (
            <p className="text-muted-foreground mt-1 max-w-full overflow-x-auto text-xs whitespace-nowrap tabular-nums">
              {reportWindow.start} – {reportWindow.end}
              {reportWindow.timeZone ? ` · ${reportWindow.timeZone}` : ''}
            </p>
          ) : null}
          <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-3">
            <Amount label={t('card.spent')} value={spent} />
            <Amount label={t('visual.limit')} value={limit} />
            <Amount
              label={t('visual.remaining')}
              value={remaining}
              emphasis={typeof budget.remaining === 'number' && budget.remaining < 0}
            />
          </dl>
          <p className={cn('mt-3 text-sm font-medium', TONE_CLASS[visual.tone])}>{statusText}</p>
          {visual.filled && visual.percent !== null && visual.percent > 100 ? (
            <p className="text-muted-foreground mt-1 max-w-prose text-xs leading-relaxed">
              {t('visual.capped')}
            </p>
          ) : null}
          {!budget.is_active ? (
            <p className="text-muted-foreground mt-2 text-xs">{t('scoped.inactive')}</p>
          ) : null}
          {budget.comparison?.limitComparable === false ? (
            <p className="text-warning mt-2 text-xs leading-relaxed">{t('scoped.notComparable')}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 min-w-0">
        <ScopedActualResult
          key={JSON.stringify(budget.result?.window ?? null)}
          compact
          result={budget.result}
          accounts={references.accounts}
          categories={references.categories}
        />
      </div>
    </li>
  )
}
