import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { NativePanel } from '@/components/ui/native-layout'
import { cn } from '@/lib/utils'

interface DueHorizonProps {
  overdue: number
  next7: number
  later: number
  isLoading: boolean
  runRateValue: string
  runRateDetail: string | null
  runRateUnavailable: boolean
  thisMonthCount: number
  soonCount: number
}

const GROUPS = [
  {
    id: 'overdue',
    labelKey: 'horizon.overdue',
    windowKey: 'horizon.overdueWindow',
    countKey: 'horizon.overdueCount',
    markClass: 'bg-destructive',
  },
  {
    id: 'next7',
    labelKey: 'horizon.next7',
    windowKey: 'horizon.next7Window',
    countKey: 'horizon.next7Count',
    markClass: 'bg-warning',
  },
  {
    id: 'later',
    labelKey: 'horizon.later',
    windowKey: 'horizon.laterWindow',
    countKey: 'horizon.laterCount',
    markClass: 'bg-chart-1',
  },
] as const

/** Count bar for active expense rules. Segments are rule counts, never money. */
export function DueHorizon({
  overdue,
  next7,
  later,
  isLoading,
  runRateValue,
  runRateDetail,
  runRateUnavailable,
  thisMonthCount,
  soonCount,
}: DueHorizonProps) {
  const { t } = useTranslation('billCalendar')
  const titleId = useId()
  const scopeId = useId()
  const counts = { overdue, next7, later }
  const total = overdue + next7 + later
  const barLabel = isLoading
    ? t('horizon.loading')
    : GROUPS.map((group) => t(group.countKey, { count: counts[group.id] })).join('. ') + '.'

  return (
    <NativePanel
      className="min-w-0 p-4 sm:p-5"
      aria-labelledby={titleId}
      aria-busy={isLoading || undefined}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-base font-medium tracking-tight">
          {t('horizon.title')}
        </h2>
        <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {isLoading ? '—' : t('horizon.activeCount', { count: total })}
        </p>
      </div>
      <p id={scopeId} className="text-muted-foreground mt-1 max-w-2xl text-xs">
        {t('horizon.scope')}
      </p>
      <div
        role="img"
        aria-label={barLabel}
        aria-describedby={scopeId}
        className="bg-muted mt-4 flex h-1.5 overflow-hidden rounded-full"
      >
        {!isLoading &&
          GROUPS.map((group) => {
            const count = counts[group.id]
            if (count <= 0 || total <= 0) return null
            return (
              <span
                key={group.id}
                aria-hidden="true"
                className={cn('h-full', group.markClass)}
                style={{ flexGrow: count, flexBasis: 0, minWidth: 2 }}
              />
            )
          })}
      </div>
      <ul aria-label={t('horizon.legend')} className="mt-4 grid gap-3 sm:grid-cols-3">
        {GROUPS.map((group) => {
          const count = counts[group.id]
          return (
            <li
              key={group.id}
              aria-label={isLoading ? t(group.labelKey) : t(group.countKey, { count })}
              className="flex min-w-0 items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-full', group.markClass)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(group.labelKey)}</span>
                  <span className="text-muted-foreground block text-xs">{t(group.windowKey)}</span>
                </span>
              </span>
              <span className="text-xl font-medium tabular-nums">{isLoading ? '—' : count}</span>
            </li>
          )
        })}
      </ul>
      <div className="border-border mt-4 border-t pt-4">
        <p className="text-muted-foreground text-xs">{t('monthlyRunRate')}</p>
        <p className="mt-1 text-2xl font-medium tracking-tight break-all tabular-nums">
          {runRateValue}
        </p>
        {runRateDetail ? (
          <p
            className={cn(
              'mt-1 max-w-2xl text-xs break-words',
              runRateUnavailable ? 'text-warning' : 'text-muted-foreground'
            )}
          >
            {runRateDetail}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-3 text-xs">
          <span>{t('thisMonth')}</span>{' '}
          <span className="text-foreground font-medium tabular-nums">
            {isLoading ? '—' : thisMonthCount}
          </span>
          <span className="px-1.5" aria-hidden="true">
            ·
          </span>
          <span>{t('filter.soon')}</span>{' '}
          <span className="text-foreground font-medium tabular-nums">
            {isLoading ? '—' : soonCount}
          </span>
        </p>
      </div>
    </NativePanel>
  )
}
