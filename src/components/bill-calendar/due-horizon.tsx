import { useId, useState } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NativePanel } from '@/components/ui/native-layout'
import { Button } from '@/components/ui/button'
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
    zeroClass: 'border-destructive text-destructive',
  },
  {
    id: 'next7',
    labelKey: 'horizon.next7',
    windowKey: 'horizon.next7Window',
    countKey: 'horizon.next7Count',
    markClass: 'bg-warning',
    zeroClass: 'border-warning text-warning',
  },
  {
    id: 'later',
    labelKey: 'horizon.later',
    windowKey: 'horizon.laterWindow',
    countKey: 'horizon.laterCount',
    markClass: 'bg-chart-1',
    zeroClass: 'border-chart-1 text-chart-1',
  },
] as const

const TRACK_PX = 80

function CountShape({
  id,
  count,
  max,
  isLoading,
  fillClass,
  zeroClass,
}: {
  id: string
  count: number
  max: number
  isLoading: boolean
  fillClass: string
  zeroClass: string
}) {
  if (isLoading) {
    return (
      <span
        data-count-shape={id}
        data-filled="false"
        aria-hidden="true"
        className="border-border mx-auto h-8 w-full max-w-16 rounded-md border border-dashed"
      />
    )
  }
  if (count <= 0 || max <= 0) {
    return (
      <span
        data-count-shape={id}
        data-filled="false"
        aria-hidden="true"
        className={cn(
          'mx-auto flex h-8 w-full max-w-16 items-center justify-center rounded-md border bg-transparent text-sm font-medium tabular-nums',
          zeroClass
        )}
      >
        0
      </span>
    )
  }
  const height = Math.max(1, Math.round((count / max) * TRACK_PX))
  return (
    <span
      data-count-shape={id}
      data-filled="true"
      aria-hidden="true"
      className={cn('mx-auto block w-full max-w-16 rounded-t-md', fillClass)}
      style={{ height: `${height}px` }}
    />
  )
}

/** Rule-count columns. Heights compare disjoint active expense counts, never money. */
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
  const aboutId = useId()
  const [aboutOpen, setAboutOpen] = useState(false)
  const counts = { overdue, next7, later }
  const total = overdue + next7 + later
  const max = Math.max(overdue, next7, later)
  const barLabel = isLoading
    ? t('horizon.loading')
    : GROUPS.map((group) => t(group.countKey, { count: counts[group.id] })).join('. ') + '.'

  return (
    <NativePanel
      className="min-w-0 p-4 sm:p-5"
      aria-labelledby={titleId}
      aria-busy={isLoading || undefined}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h2 id={titleId} className="min-w-0 text-base font-medium tracking-tight break-words">
            {t('horizon.title')}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground h-11 w-11 shrink-0"
            aria-expanded={aboutOpen}
            aria-controls={aboutOpen ? aboutId : undefined}
            onClick={() => setAboutOpen((open) => !open)}
          >
            <Info aria-hidden="true" />
            <span className="sr-only">{t('horizon.about')}</span>
          </Button>
        </div>
        <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {isLoading ? '—' : t('horizon.activeCount', { count: total })}
        </p>
      </div>
      {aboutOpen ? (
        <div
          id={aboutId}
          className="text-muted-foreground mt-1 max-w-2xl space-y-1 text-xs break-words"
        >
          <p>{t('horizon.scope')}</p>
          {!isLoading && !runRateUnavailable && runRateDetail ? <p>{runRateDetail}</p> : null}
        </div>
      ) : null}
      <div className="mt-3 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
        <div className="w-full min-w-0 sm:max-w-md">
          <div
            role="img"
            aria-label={barLabel}
            className="border-border grid h-20 grid-cols-3 items-end gap-3 border-b"
          >
            {GROUPS.map((group) => (
              <CountShape
                key={group.id}
                id={group.id}
                count={counts[group.id]}
                max={max}
                isLoading={isLoading}
                fillClass={group.markClass}
                zeroClass={group.zeroClass}
              />
            ))}
          </div>
          <ul aria-label={t('horizon.legend')} className="mt-2 grid grid-cols-3 gap-3">
            {GROUPS.map((group) => {
              const count = counts[group.id]
              return (
                <li
                  key={group.id}
                  aria-label={isLoading ? t(group.labelKey) : t(group.countKey, { count })}
                  className="min-w-0 text-center"
                >
                  <span className="block text-xs font-medium break-words">{t(group.labelKey)}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs leading-snug break-words">
                    {t(group.windowKey)}
                  </span>
                  <span className="mt-1 block text-sm font-medium tabular-nums">
                    {isLoading ? '—' : count}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="border-border flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 sm:max-w-xs sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
          <span className="text-muted-foreground text-xs">{t('monthlyRunRate')}</span>
          <span
            className={cn(
              'text-sm font-medium break-all tabular-nums',
              runRateUnavailable && 'text-warning'
            )}
          >
            {runRateValue}
          </span>
          {!isLoading && !runRateUnavailable ? (
            <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
              {t('currency.estimate')}
            </span>
          ) : null}
          <span className="border-border text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            {t('thisMonth')}
            <span className="text-foreground font-medium tabular-nums">
              {isLoading ? '—' : thisMonthCount}
            </span>
          </span>
          <span className="border-border text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            {t('filter.soon')}
            <span className="text-foreground font-medium tabular-nums">
              {isLoading ? '—' : soonCount}
            </span>
          </span>
        </div>
      </div>
      {!isLoading && runRateUnavailable && runRateDetail ? (
        <p className="text-warning mt-1 max-w-2xl text-xs break-words" role="status">
          {runRateDetail}
        </p>
      ) : null}
    </NativePanel>
  )
}
