import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Calendar, CheckCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function BillCalendar() {
  const { t } = useTranslation('billCalendar')
  const [monthOffset, setMonthOffset] = useState(0)

  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthName = currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const startDay = currentMonth.getDay()
  const totalDays = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
  const today = monthOffset === 0 ? now.getDate() : null

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
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('prevMonth')}
          onClick={() => setMonthOffset((o) => o - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <h2 className="font-heading text-lg font-semibold">{monthName}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('nextMonth')}
          onClick={() => setMonthOffset((o) => o + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Calendar Grid */}
        <div className="liquid-card p-5">
          {/* Day headers */}
          <div className="mb-2 grid grid-cols-7 gap-1" role="row">
            {dayHeaders.map((day, i) => (
              <div
                key={i}
                role="columnheader"
                className="text-muted-foreground py-2 text-center font-mono text-[10px] tracking-wider uppercase"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7 gap-1" role="grid">
            {days.map((day, i) => {
              const isToday = day === today

              return (
                <div
                  key={i}
                  role="gridcell"
                  aria-label={day ? `${monthName} ${day}` : undefined}
                  className={`relative flex h-16 flex-col items-start rounded-lg p-1.5 text-xs transition-colors ${
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
                </div>
              )
            })}
          </div>
        </div>

        {/* Upcoming Bills Panel - placeholder */}
        <div className="liquid-card flex flex-col items-center justify-center p-5 text-center">
          <div className="bg-accent-muted mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Calendar size={24} className="text-primary" />
          </div>
          <h3 className="font-heading mb-1 text-sm font-semibold">{t('upcomingBills')}</h3>
          <p className="text-muted-foreground text-xs">{t('noBills')}</p>
        </div>
      </div>

      {/* Summary metrics - placeholder */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="liquid-card p-4">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Calendar size={16} className="text-accent" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('thisMonth')}</span>
          </div>
          <p className="font-heading text-xl font-bold">—</p>
        </div>
        <div className="liquid-card p-4">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <CheckCircle size={16} className="text-success" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('paid')}</span>
          </div>
          <p className="font-heading text-xl font-bold">—</p>
        </div>
        <div className="liquid-card p-4">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Clock size={16} className="text-warning" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('remaining')}</span>
          </div>
          <p className="font-heading text-xl font-bold">—</p>
        </div>
      </div>
    </div>
  )
}
