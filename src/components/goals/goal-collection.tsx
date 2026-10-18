import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { NativePanel } from '@/components/ui/native-layout'
import { ShowMorePagination } from '@/components/shared/show-more-pagination'
import type { GoalWithProgress } from '@/stores/goal-store'
import { cn } from '@/lib/utils'
import { GoalIcon } from './goal-icon'
import {
  displayGoalAmount,
  goalIdentityColor,
  goalStatus,
  goalStatusLabel,
  type GoalSummary,
} from './goal-presentation'

interface GoalCollectionProps {
  goals: GoalWithProgress[]
  total: number
  selectedId: string
  summary: GoalSummary
  onSelect: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onShowMore: () => void
  pageSize: number
}

export function GoalCollection({
  goals,
  total,
  selectedId,
  summary,
  onSelect,
  onEdit,
  onDelete,
  onShowMore,
  pageSize,
}: GoalCollectionProps) {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')

  return (
    <div className="min-w-0">
      <NativePanel aria-label={t('hero.collection')} className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-2 px-4 py-3">
          <h2 className="text-foreground text-base font-medium">{t('hero.collection')}</h2>
          <p className="text-muted-foreground text-xs tabular-nums">
            {total} {t('hero.goalCount')}
          </p>
        </div>
        {summary.complete ? (
          <div data-testid="goals-aggregate-summary" className="min-w-0 px-4 pb-3">
            <div
              className="bg-border h-2 overflow-hidden rounded-full"
              data-goal-summary-track=""
              aria-hidden="true"
            >
              {summary.progress > 0 ? (
                <div
                  className="bg-chart-1 h-full rounded-full"
                  data-goal-summary-track-fill=""
                  style={{ width: `${summary.progress}%` }}
                />
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1.5 text-sm">
              <span className="text-foreground font-medium">{t('hero.aggregateProgress')}</span>
              {' · '}
              <span className="text-foreground font-medium tabular-nums">
                {displayGoalAmount(summary.current, summary.currency)}
              </span>{' '}
              {t('card.of')}{' '}
              <span className="tabular-nums">
                {displayGoalAmount(summary.target, summary.currency)}
              </span>
              {' · '}
              <span className="tabular-nums">{summary.progress}%</span>
              {' · '}
              <span className="tabular-nums">{summary.currency}</span>
            </p>
          </div>
        ) : (
          <p role="status" className="text-warning px-4 pb-3 text-xs">
            {t('currency.unavailable')}
          </p>
        )}
        <ul className="border-border divide-border divide-y border-t">
          {goals.map((goal) => {
            const selected = goal.id === selectedId
            const status = goalStatus(goal)
            const identity = goalIdentityColor(goal.color)
            const clamped = Math.min(Math.max(goal.progress, 0), 100)
            return (
              <li
                key={goal.id}
                data-goal-id={goal.id}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 px-3 py-2',
                  selected && 'bg-muted'
                )}
              >
                <button
                  type="button"
                  className="focus-visible:ring-ring flex min-h-11 min-w-0 items-start gap-2 rounded-md px-1 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                  aria-pressed={selected}
                  onClick={() => onSelect(goal.id)}
                >
                  <GoalIcon
                    icon={goal.icon}
                    size={16}
                    className="text-foreground mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: identity }}
                        aria-hidden="true"
                      />
                      <span className="text-foreground min-w-0 text-sm font-medium break-words">
                        {goal.name}
                      </span>
                      {selected ? (
                        <span className="text-accent shrink-0 text-xs font-medium">
                          {t('hero.featuredBadge')}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      <span
                        className={cn(
                          'font-medium',
                          status.tone === 'success' && 'text-success',
                          status.tone === 'warning' && 'text-warning',
                          status.tone === 'destructive' && 'text-destructive',
                          status.tone === 'neutral' && 'text-foreground'
                        )}
                      >
                        {goalStatusLabel(status, t)}
                      </span>
                      <span className="tabular-nums"> · {goal.progress}%</span>
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    onClick={() => onEdit(goal.id)}
                    aria-label={`${tCommon('actions.edit')} ${goal.name}`}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive h-11 w-11"
                    onClick={() => onDelete(goal.id)}
                    aria-label={`${tCommon('actions.delete')} ${goal.name}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <div className="col-span-2 min-w-0 px-1">
                  <div
                    className="bg-border h-2 overflow-hidden rounded-full"
                    data-goal-progress-track=""
                    aria-hidden="true"
                  >
                    {clamped > 0 ? (
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${clamped}%`, backgroundColor: identity }}
                      />
                    ) : null}
                  </div>
                  <p
                    data-goal-amount=""
                    className="mt-1 max-w-full overflow-x-auto text-sm whitespace-nowrap tabular-nums"
                  >
                    <span className="text-foreground font-medium">
                      {displayGoalAmount(goal.current_amount, goal.currency)}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      {t('card.of')} {displayGoalAmount(goal.target_amount, goal.currency)}
                    </span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </NativePanel>
      <ShowMorePagination
        shown={goals.length}
        total={total}
        summaryLabel={tCommon('pagination.summary', {
          shown: goals.length,
          total,
        })}
        showMoreLabel={tCommon('pagination.showMore', {
          count: Math.min(pageSize, total - goals.length),
        })}
        onShowMore={onShowMore}
        className="mt-3"
      />
    </div>
  )
}
