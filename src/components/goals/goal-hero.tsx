import dayjs from 'dayjs'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { NativePanel } from '@/components/ui/native-layout'
import type { GoalWithProgress } from '@/stores/goal-store'
import { cn } from '@/lib/utils'
import {
  displayGoalAmount,
  goalIdentityColor,
  goalStatus,
  goalStatusLabel,
} from './goal-presentation'
import { GoalProgressRing } from './goal-progress-ring'

const STATUS_TONE = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  neutral: 'text-foreground',
} as const

const STATUS_DETAIL = {
  completed: 'hero.statusCompleted',
  overdue: 'hero.statusOverdue',
  dueToday: 'hero.statusDueToday',
  noDeadline: 'hero.statusNoDeadline',
} as const

function formatGoalDeadline(deadline: string, language: string): string {
  const parsed = dayjs(deadline)
  if (!parsed.isValid()) return deadline
  return new Intl.DateTimeFormat(language || 'en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${parsed.format('YYYY-MM-DD')}T00:00:00Z`))
}

interface GoalHeroProps {
  goal: GoalWithProgress
  onEdit: () => void
}

export function GoalHero({ goal, onEdit }: GoalHeroProps) {
  const { t, i18n } = useTranslation('goals')
  const status = goalStatus(goal)
  const statusLabel = goalStatusLabel(status, t)
  const currency = goal.currency?.trim() || null
  const currentText = displayGoalAmount(goal.current_amount, currency)
  const targetText = displayGoalAmount(goal.target_amount, currency)
  const monthlyText =
    goal.monthlyNeeded > 0
      ? displayGoalAmount(goal.monthlyNeeded, currency)
      : t('hero.noMonthlyPace')
  const remainingText = displayGoalAmount(
    Math.max(0, goal.target_amount - goal.current_amount),
    currency
  )
  const deadlineText = goal.deadline
    ? formatGoalDeadline(goal.deadline, i18n.language)
    : t('card.noDeadline')
  const accountName = goal.accountName?.trim() || null
  const identity = goalIdentityColor(goal.color)
  const progressLabel = `${goal.name} ${t('card.progressLabel')}`
  const valueText = `${currentText} ${t('card.of')} ${targetText}, ${Number.isFinite(goal.progress) ? Math.round(goal.progress) : 0}%`
  const detailKey = status.key === 'daysLeft' ? null : STATUS_DETAIL[status.key]

  return (
    <NativePanel
      aria-label={`${t('hero.featuredGoal')}: ${goal.name}`}
      data-goal-id={goal.id}
      className="min-w-0 p-4 sm:p-6"
    >
      <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: identity }}
          aria-hidden="true"
        />
        {t('hero.featuredGoal')}
      </p>
      <div
        data-goal-hero-layout
        className="mt-4 flex min-w-0 flex-col items-start gap-5 sm:flex-row sm:items-center"
      >
        <GoalProgressRing
          progress={goal.progress}
          color={identity}
          icon={goal.icon}
          label={progressLabel}
          valueText={valueText}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-xl font-medium break-words sm:text-2xl">
            {goal.name}
          </h2>
          <p className={cn('mt-1 text-sm font-medium', STATUS_TONE[status.tone])}>{statusLabel}</p>
          {detailKey ? (
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t(detailKey)}</p>
          ) : null}
          <p className="text-muted-foreground mt-4 text-xs">{t('hero.currentAmount')}</p>
          <p className="text-foreground mt-1 text-2xl font-medium break-all tabular-nums sm:text-3xl">
            {currentText}
            {currency ? (
              <span className="text-muted-foreground ml-2 align-middle text-sm font-medium">
                {currency}
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground mt-1 text-sm break-all tabular-nums">
            {t('card.of')} <span className="text-foreground font-medium">{targetText}</span>
            {currency ? <span className="ml-2">{currency}</span> : null}
          </p>
          {accountName ? (
            <p className="text-muted-foreground mt-3 text-sm break-words">
              <span className="text-foreground">{t('form.account')}</span>
              {': '}
              {accountName}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="mt-4 min-h-11 w-full sm:w-auto"
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" />
            {t('editGoal')}
          </Button>
        </div>
      </div>

      <dl
        data-goal-pace
        className="border-border mt-6 grid grid-cols-1 gap-4 border-t pt-4 min-[360px]:grid-cols-3"
      >
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{t('hero.monthlyPace')}</dt>
          <dd className="text-foreground mt-1 text-base font-medium break-all tabular-nums">
            {monthlyText}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{t('automation.remaining')}</dt>
          <dd className="text-foreground mt-1 text-base font-medium break-all tabular-nums">
            {remainingText}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{t('automation.deadline')}</dt>
          <dd className="text-foreground mt-1 text-base font-medium break-words">{deadlineText}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        {goal.monthlyNeeded > 0
          ? t('automation.monthlyMove', {
              amount: displayGoalAmount(goal.monthlyNeeded, currency),
              goal: goal.name,
            })
          : t('automation.keepPace', { goal: goal.name })}
      </p>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {t('contributions.note')}
      </p>
    </NativePanel>
  )
}
