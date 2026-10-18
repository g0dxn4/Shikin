import dayjs from 'dayjs'
import { AlertCircle, ChevronRight, Clock, Landmark, Pencil } from 'lucide-react'
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
  type GoalStatus,
} from './goal-presentation'
import { GoalProgressRing } from './goal-progress-ring'

const STATUS_CHIP = {
  success: 'border-success text-success',
  warning: 'border-transparent bg-warning text-warning-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
  neutral: 'border-border text-foreground',
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

function StatusChip({ status, label }: { status: GoalStatus; label: string }) {
  return (
    <span
      data-goal-status={status.key}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
        STATUS_CHIP[status.tone],
        (status.tone === 'destructive' || status.tone === 'warning') && 'text-sm'
      )}
    >
      {status.tone === 'destructive' ? <AlertCircle size={14} aria-hidden="true" /> : null}
      {status.tone === 'warning' ? <Clock size={14} aria-hidden="true" /> : null}
      <span className="min-w-0 break-words">{label}</span>
    </span>
  )
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
      className="min-w-0 p-3 sm:p-4"
    >
      <div
        data-goal-hero-layout
        className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center"
      >
        <GoalProgressRing
          progress={goal.progress}
          color={identity}
          icon={goal.icon}
          label={progressLabel}
          valueText={valueText}
        />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: identity }}
              aria-hidden="true"
            />
            {t('hero.featuredGoal')}
          </p>
          <p className="text-foreground mt-1 max-w-full overflow-x-auto text-2xl font-medium whitespace-nowrap tabular-nums sm:text-3xl">
            <span className="sr-only">{t('hero.currentAmount')} </span>
            {currentText}
            {currency ? (
              <span className="text-muted-foreground ml-2 align-middle text-sm font-medium">
                {currency}
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground mt-0.5 max-w-full overflow-x-auto text-sm whitespace-nowrap tabular-nums">
            <span className="sr-only">{t('hero.targetAmount')} </span>
            {t('card.of')} <span className="text-foreground font-medium">{targetText}</span>
            {currency ? <span className="ml-2">{currency}</span> : null}
          </p>
          <h2 className="text-foreground mt-1 text-base font-medium break-words sm:text-lg">
            {goal.name}
          </h2>
          <div className="mt-2">
            <StatusChip status={status} label={statusLabel} />
          </div>
          {accountName ? (
            <p className="text-muted-foreground mt-2 flex min-w-0 items-center gap-1.5 text-xs">
              <Landmark size={12} className="shrink-0" aria-hidden="true" />
              <span className="sr-only">{t('form.account')}: </span>
              <span className="min-w-0 break-words">{accountName}</span>
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11 w-full sm:w-auto"
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" />
            {t('editGoal')}
          </Button>
        </div>
      </div>

      <dl
        data-goal-pace
        className="border-border mt-4 grid grid-cols-1 gap-3 border-t pt-3 min-[360px]:grid-cols-3"
      >
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{t('hero.monthlyPace')}</dt>
          <dd className="text-foreground mt-0.5 max-w-full overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums">
            {monthlyText}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{t('automation.remaining')}</dt>
          <dd className="text-foreground mt-0.5 max-w-full overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums">
            {remainingText}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{t('automation.deadline')}</dt>
          <dd className="text-foreground mt-0.5 text-sm font-medium break-words">{deadlineText}</dd>
        </div>
      </dl>
      <details data-goal-method className="group mt-2 min-w-0">
        <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none sm:min-h-7 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            size={14}
            className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
          {t('hero.method')}
        </summary>
        <div className="text-muted-foreground mt-2 space-y-2 text-xs leading-relaxed">
          {detailKey ? <p>{t(detailKey)}</p> : null}
          <p>
            {goal.monthlyNeeded > 0
              ? t('automation.monthlyMove', {
                  amount: displayGoalAmount(goal.monthlyNeeded, currency),
                  goal: goal.name,
                })
              : t('automation.keepPace', { goal: goal.name })}
          </p>
          <p>{t('contributions.note')}</p>
        </div>
      </details>
    </NativePanel>
  )
}
