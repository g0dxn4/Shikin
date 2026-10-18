import { ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ScopedReferences } from '@/lib/scoped-report-read'
import type { DisplayBudget } from '@/components/budgets/use-budget-display'
import { ScopedActualResult } from '@/components/budgets/scoped-result'
import { budgetUsageVisual } from '@/components/budgets/budget-visual-model'
import { BudgetUsageRing, BudgetUsageTrack } from '@/components/budgets/budget-usage-ring'
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
    <div className="flex max-w-full min-w-0 items-baseline gap-1.5">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd
        className={cn(
          'max-w-full min-w-0 overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums',
          emphasis ? 'text-destructive' : 'text-foreground'
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
  const overAmount =
    visual.filled &&
    visual.status === 'overBudget' &&
    typeof budget.remaining === 'number' &&
    Number.isSafeInteger(budget.remaining) &&
    budget.remaining < 0
      ? formatMoney(Math.abs(budget.remaining), currency)
      : null
  const statusText = !visual.filled
    ? t('visual.unavailable')
    : overAmount
      ? t('visual.overAmount', { amount: overAmount })
      : status
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
  const metadata = [
    t(`periods.${budget.period}`),
    basis,
    currency,
    reportWindow?.start && reportWindow.end ? `${reportWindow.start} – ${reportWindow.end}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const overCap = visual.filled && visual.percent !== null && visual.percent > 100

  return (
    <li
      className="border-border grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-t py-2 first:border-t-0 first:pt-1.5"
      data-budget-plan={budget.id}
    >
      <BudgetUsageRing
        visual={visual}
        label={label}
        percentText={visual.filled && visual.percent !== null ? `${visual.percent}%` : '—'}
      />
      <div className="col-start-2 flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm leading-5 font-semibold">
          <span
            className="border-border size-2.5 shrink-0 rounded-full border"
            style={{ backgroundColor: mark }}
            aria-hidden="true"
          />
          <span data-budget-plan-name className="min-w-0 break-words sm:truncate">
            {category}
            <span className="text-muted-foreground font-normal"> · {budget.name}</span>
          </span>
        </p>
        <span
          data-budget-status={visual.status}
          className={cn(
            'inline-flex max-w-full items-center gap-1 overflow-x-auto text-xs font-medium whitespace-nowrap',
            TONE_CLASS[visual.tone]
          )}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          {statusText}
        </span>
      </div>
      <BudgetUsageTrack visual={visual} className="col-start-2" />
      <dl className="col-start-2 flex min-w-0 items-baseline gap-x-4 overflow-x-auto">
        <Amount label={t('card.spent')} value={spent} />
        <Amount label={t('visual.limit')} value={limit} />
        <Amount
          label={t('visual.remaining')}
          value={remaining}
          emphasis={typeof budget.remaining === 'number' && budget.remaining < 0}
        />
      </dl>
      <p
        data-budget-plan-meta
        className="border-border text-muted-foreground col-start-2 max-w-full min-w-0 overflow-x-auto rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap"
      >
        <span className="sr-only">{t('visual.metadataLabel')}: </span>
        {metadata}
      </p>
      {!budget.is_active ? (
        <p className="text-muted-foreground col-start-2 text-xs leading-4">
          {t('scoped.inactive')}
        </p>
      ) : null}
      {budget.comparison?.limitComparable === false ? (
        <p className="text-warning col-start-2 text-xs leading-4">{t('scoped.notComparable')}</p>
      ) : null}
      <div className="col-span-2 flex min-w-0 flex-wrap items-center">
        <details className="group min-w-0">
          <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none sm:min-h-7 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={14}
              className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            />
            <span>{t('visual.details')}</span>
            <span className="sr-only">{budget.name}</span>
          </summary>
          <div className="mt-2 min-w-0 space-y-3">
            {overCap ? (
              <p className="text-muted-foreground text-xs leading-relaxed">{t('visual.capped')}</p>
            ) : null}
            {budget.result ? (
              <ScopedActualResult
                key={JSON.stringify(budget.result?.window ?? null)}
                compact
                result={budget.result}
                accounts={references.accounts}
                categories={references.categories}
              />
            ) : null}
          </div>
        </details>
        <div data-budget-plan-actions className="flex shrink-0">
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
    </li>
  )
}
