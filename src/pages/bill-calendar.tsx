import { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Calendar,

  CheckCircle,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MetricCard } from '@/components/ui/metric-card'
import { PageHeader } from '@/components/ui/page-header'

interface Bill {
  id: string
  name: string
  amount: string
  date: number
  color: string
  paid: boolean
}

const MOCK_BILLS: Bill[] = [
  { id: '1', name: 'Electric Bill', amount: '$120.00', date: 5, color: '#f59e0b', paid: false },
  { id: '2', name: 'Adobe CC', amount: '$54.99', date: 10, color: '#ef4444', paid: false },
  { id: '3', name: 'Netflix', amount: '$15.99', date: 15, color: '#e50914', paid: false },
  { id: '4', name: 'Credit Card Min', amount: '$150.00', date: 20, color: '#3b82f6', paid: false },
  { id: '5', name: 'Internet', amount: '$79.99', date: 25, color: '#22c55e', paid: false },
]

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// March 2026 starts on Sunday (day 0), 31 days
const MARCH_2026 = {
  startDay: 0,
  totalDays: 31,
}

function buildCalendarDays(): (number | null)[] {
  const days: (number | null)[] = []
  // Leading empty cells
  for (let i = 0; i < MARCH_2026.startDay; i++) {
    days.push(null)
  }
  // Actual days
  for (let d = 1; d <= MARCH_2026.totalDays; d++) {
    days.push(d)
  }
  // Pad to fill 5 complete rows (35 cells)
  while (days.length < 35) {
    days.push(null)
  }
  return days
}

export function BillCalendar() {
  const [month] = useState('March 2026')
  const calendarDays = buildCalendarDays()
  const today = 9 // Mock "today" as March 9

  const billsByDate = new Map<number, Bill[]>()
  for (const bill of MOCK_BILLS) {
    const existing = billsByDate.get(bill.date) || []
    existing.push(bill)
    billsByDate.set(bill.date, existing)
  }

  return (
    <div className="animate-fade-in-up page-content">
      <PageHeader title="Bill Calendar" />

      {/* Month navigation */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <ChevronLeft size={16} />
        </Button>
        <h2 className="font-heading text-lg font-semibold">{month}</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Calendar Grid */}
        <div className="glass-card p-5">
          {/* Day headers */}
          <div className="mb-2 grid grid-cols-7 gap-1">
            {DAY_HEADERS.map((day, i) => (
              <div
                key={i}
                className="text-muted-foreground py-2 text-center font-mono text-[10px] uppercase tracking-wider"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              const isToday = day === today
              const bills = day ? billsByDate.get(day) : undefined

              return (
                <div
                  key={i}
                  className={`relative flex h-16 flex-col items-start rounded-lg p-1.5 text-xs transition-colors ${
                    day ? 'hover:bg-white/[0.03]' : ''
                  } ${isToday ? 'ring-1 ring-accent bg-accent/5' : ''}`}
                >
                  {day && (
                    <>
                      <span
                        className={`font-mono text-[11px] ${
                          isToday ? 'font-semibold text-accent' : 'text-muted-foreground'
                        }`}
                      >
                        {day}
                      </span>
                      {bills && (
                        <div className="mt-auto flex gap-1">
                          {bills.map((bill) => (
                            <div
                              key={bill.id}
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: bill.color }}
                              title={`${bill.name} — ${bill.amount}`}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Upcoming Bills Panel */}
        <div className="glass-card space-y-1 p-5">
          <h3 className="font-heading mb-3 text-sm font-semibold">Upcoming Bills</h3>
          <div className="space-y-2">
            {MOCK_BILLS.map((bill) => (
              <div
                key={bill.id}
                className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: bill.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{bill.name}</p>
                  <p className="text-muted-foreground font-mono text-[10px]">
                    Mar {bill.date}
                  </p>
                </div>
                <span className="font-heading shrink-0 text-sm font-semibold">{bill.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          icon={<Calendar size={16} className="text-accent" />}
          label="This Month"
          value="$420.97"
        />
        <MetricCard
          icon={<CheckCircle size={16} className="text-success" />}
          label="Paid"
          value="$0.00"
        />
        <MetricCard
          icon={<Clock size={16} className="text-warning" />}
          label="Remaining"
          value="$420.97"
        />
      </div>
    </div>
  )
}
