import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Calendar, CheckCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { useRecurringStore } from '@/stores/recurring-store'

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

export function BillCalendar() {
  const { t } = useTranslation(['billCalendar', 'common'])
  const [monthOffset, setMonthOffset] = useState(0)
  const { rules, isLoading, fetch } = useRecurringStore()

  useEffect(() => {
    void fetch()
  }, [fetch])

  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthName = currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const startDay = currentMonth.getDay()
  const totalDays = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
  const today = monthOffset === 0 ? now.getDate() : null
  const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`
  const todayKey = toDateKey(now)
  const scheduledBills = rules.filter((rule) => rule.active === 1 && rule.type === 'expense')
  const monthBills = scheduledBills.filter((rule) => rule.next_date.startsWith(monthKey))
  const remainingBills = monthBills.filter((rule) => rule.next_date >= todayKey)
  const monthTotal = monthBills.reduce((total, rule) => total + rule.amount, 0)

  const dayHeaders = [
    t('dayLabels.sunday'),
    t('dayLabels.monday'),
    t('dayLabels.tuesday'),
    t('dayLabels.wednesday'),
    t('dayLabels.thursday'),
    t('dayLabels.friday'),
    t('dayLabels.saturday'),
  ]

  const days: (number | null)[] = []
  for (let i = 0; i < startDay; i++) {
    days.push(null)
  }
  for (let d = 1; d <= totalDays; d++) {
    days.push(d)
  }
  while (days.length % 7 !== 0) {
    days.push(null)
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header p-5">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <Button variant="ghost" asChild className="w-full sm:w-auto">
          <Link to="/bills">
            <ChevronLeft size={16} aria-hidden="true" />
            {t('listView')}
          </Link>
        </Button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('prevMonth')}
          onClick={() => setMonthOffset((o) => o - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
        <h2 className="font-heading text-lg font-semibold" aria-live="polite">
          {monthName}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nextMonth')}
          onClick={() => setMonthOffset((o) => o + 1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Calendar Table */}
        <div className="liquid-card p-5">
          {isLoading && rules.length === 0 ? (
            <div
              className="text-muted-foreground flex h-80 items-center justify-center text-sm"
              role="status"
            >
              {t('common:status.loading')}
            </div>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-1">
              <caption className="sr-only">{monthName}</caption>
              <thead>
                <tr>
                  {dayHeaders.map((day, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="text-muted-foreground py-2 text-center font-mono text-[10px] tracking-wider uppercase"
                    >
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: days.length / 7 }, (_, weekIndex) => (
                  <tr key={weekIndex}>
                    {days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day, dayIndex) => {
                      const isToday = day === today
                      const dateKey = day ? `${monthKey}-${String(day).padStart(2, '0')}` : null
                      const billsForDay = dateKey
                        ? monthBills.filter((rule) => rule.next_date === dateKey)
                        : []

                      return (
                        <td
                          key={day ? dateKey : `empty-${weekIndex}-${dayIndex}`}
                          className="h-16 p-0 align-top sm:h-20"
                        >
                          <div
                            aria-label={day ? `${monthName} ${day}` : undefined}
                            aria-current={isToday ? 'date' : undefined}
                            className={`relative flex h-full flex-col items-start rounded-lg p-1.5 text-xs transition-colors ${
                              day ? 'hover:bg-white/[0.03]' : ''
                            } ${isToday ? 'ring-accent bg-accent/5 ring-1' : ''}`}
                          >
                            {day && (
                              <span
                                className={`font-mono text-[11px] ${
                                  isToday ? 'text-accent font-semibold' : 'text-muted-foreground'
                                }`}
                              >
                                {day}
                              </span>
                            )}
                            {billsForDay.length > 0 && (
                              <div
                                className="mt-auto flex w-full flex-col gap-1 overflow-hidden"
                                aria-label={t('scheduledCount', { count: billsForDay.length })}
                              >
                                {billsForDay.slice(0, 3).map((bill) => (
                                  <span
                                    key={bill.id}
                                    className="text-foreground truncate rounded-full border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 text-[10px] leading-none"
                                  >
                                    {bill.description}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="liquid-card p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="bg-accent-muted flex h-12 w-12 items-center justify-center rounded-2xl">
              <Calendar size={24} className="text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-heading text-sm font-semibold">{t('upcomingBills')}</h3>
              <p className="text-muted-foreground text-xs">{t('upcomingDescription')}</p>
            </div>
          </div>
          {remainingBills.length === 0 ? (
            <p className="text-muted-foreground rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-6 text-center text-xs">
              {t('noBills')}
            </p>
          ) : (
            <div className="space-y-3">
              {remainingBills.slice(0, 6).map((bill) => (
                <div key={bill.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{bill.description}</p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(bill.next_date).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-heading text-sm font-semibold">
                    {formatMoney(bill.amount, bill.currency ?? 'USD')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="liquid-card p-4">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Calendar size={16} className="text-accent" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('thisMonth')}</span>
          </div>
          <p className="font-heading text-xl font-bold">{formatMoney(monthTotal)}</p>
        </div>
        <div className="liquid-card p-4">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <CheckCircle size={16} className="text-success" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('paid')}</span>
          </div>
          <p className="font-heading text-xl font-bold">
            {monthBills.length - remainingBills.length}
          </p>
        </div>
        <div className="liquid-card p-4">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Clock size={16} className="text-warning" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('remaining')}</span>
          </div>
          <p className="font-heading text-xl font-bold">{remainingBills.length}</p>
        </div>
      </div>
    </div>
  )
}
