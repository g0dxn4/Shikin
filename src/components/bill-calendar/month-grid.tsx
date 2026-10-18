import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const DAY_HEADERS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

const DAY_KEY_DELTA: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
}

interface DayMark {
  paid: number
  unpaid: number
}

interface MonthGridProps {
  monthName: string
  monthKey: string
  todayKey: string
  days: Array<number | null>
  marks: ReadonlyMap<string, DayMark>
  selectedDate: string | null
  onSelectDate: (date: string) => void
}

function moveDayFocus(current: HTMLButtonElement, key: string) {
  const buttons = [
    ...(current.closest('table')?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]') ??
      []),
  ]
  if (buttons.length === 0) return
  if (key === 'Home') {
    buttons[0]?.focus()
    return
  }
  if (key === 'End') {
    buttons[buttons.length - 1]?.focus()
    return
  }
  const delta = DAY_KEY_DELTA[key]
  if (delta === undefined) return
  const next = buttons[buttons.indexOf(current) + delta]
  next?.focus()
}

/** Month grid. Cells show counts and paid/unpaid marks, never amounts. */
export function MonthGrid({
  monthName,
  monthKey,
  todayKey,
  days,
  marks,
  selectedDate,
  onSelectDate,
}: MonthGridProps) {
  const { t } = useTranslation('billCalendar')
  const weeks = days.length / 7

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Home' && event.key !== 'End' && DAY_KEY_DELTA[event.key] === undefined) {
      return
    }
    event.preventDefault()
    moveDayFocus(event.currentTarget, event.key)
  }

  return (
    <div className="min-w-0">
      <div
        role="region"
        aria-label={t('calendar.scrollRegion')}
        className="max-w-full min-w-0 overflow-x-auto overscroll-x-contain"
      >
        <table className="w-full min-w-[22rem] table-fixed border-collapse">
          <caption className="sr-only">{monthName}</caption>
          <thead>
            <tr>
              {DAY_HEADERS.map((day) => (
                <th
                  scope="col"
                  key={day}
                  className="text-muted-foreground px-0 py-2 text-center text-xs font-medium"
                >
                  {t(`dayLabels.${day}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: weeks }, (_, week) => (
              <tr key={week}>
                {days.slice(week * 7, week * 7 + 7).map((day, index) => {
                  const date = day ? `${monthKey}-${String(day).padStart(2, '0')}` : ''
                  const mark = date ? marks.get(date) : undefined
                  const paid = mark?.paid ?? 0
                  const unpaid = mark?.unpaid ?? 0
                  const total = paid + unpaid
                  const isToday = date === todayKey
                  const isSelected = selectedDate === date
                  return (
                    <td
                      key={date || `empty-${week}-${index}`}
                      className="border-border h-px border p-0 align-top"
                    >
                      {day ? (
                        <button
                          type="button"
                          aria-label={`${monthName} ${day}, ${t('scheduledCount', { count: total })}, ${t('calendar.paidCount', { count: paid })}, ${t('calendar.unpaidCount', { count: unpaid })}`}
                          aria-current={isToday ? 'date' : undefined}
                          aria-pressed={isSelected}
                          onClick={() => onSelectDate(date)}
                          onKeyDown={onDayKeyDown}
                          className={cn(
                            'focus-visible:ring-ring hover:bg-muted/70 flex min-h-11 w-full min-w-11 flex-col items-center justify-between gap-1 px-0.5 py-1 text-center focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                            isSelected && 'bg-muted'
                          )}
                        >
                          <span
                            className={cn(
                              'text-sm leading-none tabular-nums',
                              isToday ? 'text-accent font-semibold' : 'text-foreground'
                            )}
                          >
                            {day}
                          </span>
                          {total > 0 ? (
                            <span
                              className="flex max-w-full items-center gap-0.5"
                              aria-hidden="true"
                            >
                              {paid > 0 ? (
                                <span className="bg-success size-2 shrink-0 rounded-full" />
                              ) : null}
                              {unpaid > 0 ? (
                                <span className="border-foreground size-2 shrink-0 rounded-full border" />
                              ) : null}
                              <span className="text-muted-foreground text-xs leading-none tabular-nums">
                                {total}
                              </span>
                            </span>
                          ) : (
                            <span className="size-2" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span className="block min-h-11" aria-hidden="true" />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul
        aria-label={t('calendar.markLegend')}
        className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs"
      >
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-success size-2 rounded-full" />
          {t('status.paid')}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="border-foreground size-2 rounded-full border" />
          {t('status.unpaid')}
        </li>
      </ul>
    </div>
  )
}
