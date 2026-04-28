import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { CalendarClock, CheckCircle, Clock, Plus, Receipt, Repeat } from 'lucide-react'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/lib/money'
import { useRecurringStore, type RecurringRuleWithDetails } from '@/stores/recurring-store'

function monthlyEquivalent(rule: RecurringRuleWithDetails) {
  const amount = rule.amount
  switch (rule.frequency) {
    case 'daily':
      return Math.round(amount * 30)
    case 'weekly':
      return Math.round(amount * 4.345)
    case 'biweekly':
      return Math.round(amount * 2.1725)
    case 'quarterly':
      return Math.round(amount / 3)
    case 'yearly':
      return Math.round(amount / 12)
    case 'monthly':
    default:
      return amount
  }
}

function daysUntil(date: string) {
  return dayjs(date).startOf('day').diff(dayjs().startOf('day'), 'day')
}

function BillRow({ rule }: { rule: RecurringRuleWithDetails }) {
  const { t } = useTranslation('billCalendar')
  const dueIn = daysUntil(rule.next_date)
  const isOverdue = dueIn < 0
  const isSoon = dueIn >= 0 && dueIn <= 7

  return (
    <div className="soft-divider grid gap-3 border-b py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]"
          style={{ color: rule.category_color ?? 'var(--accent)' }}
        >
          <Receipt size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="font-heading truncate text-sm font-semibold">{rule.description}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {rule.category_name ?? t('uncategorized')} · {rule.account_name ?? t('unknownAccount')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-muted-foreground rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[10px] tracking-wider uppercase">
              {rule.frequency}
            </span>
            <span
              className={`rounded-full border px-2 py-1 font-mono text-[10px] tracking-wider uppercase ${
                isOverdue
                  ? 'text-destructive border-red-400/20 bg-red-400/[0.08]'
                  : isSoon
                    ? 'text-warning border-amber-400/20 bg-amber-400/[0.08]'
                    : 'text-success border-emerald-400/20 bg-emerald-400/[0.08]'
              }`}
            >
              {isOverdue
                ? t('overdueBy', { count: Math.abs(dueIn) })
                : dueIn === 0
                  ? t('dueToday')
                  : t('dueIn', { count: dueIn })}
            </span>
          </div>
        </div>
      </div>
      <div className="text-left sm:text-right">
        <p className="font-heading text-lg font-bold tracking-tight">
          {formatMoney(rule.amount, rule.currency ?? 'USD')}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {dayjs(rule.next_date).format('MMM D, YYYY')}
        </p>
      </div>
    </div>
  )
}

export function BillsPage() {
  const { t } = useTranslation('billCalendar')
  const { rules, isLoading, fetch } = useRecurringStore()

  useEffect(() => {
    void fetch()
  }, [fetch])

  const bills = rules
    .filter((rule) => rule.active === 1 && rule.type === 'expense')
    .sort((a, b) => a.next_date.localeCompare(b.next_date))
  const dueThisMonth = bills.filter((rule) => dayjs(rule.next_date).isSame(dayjs(), 'month'))
  const dueSoon = bills.filter((rule) => daysUntil(rule.next_date) <= 30)
  const overdue = bills.filter((rule) => daysUntil(rule.next_date) < 0)
  const monthlyTotal = bills.reduce((total, rule) => total + monthlyEquivalent(rule), 0)

  return (
    <div className="page-content animate-fade-in-up">
      <div className="liquid-card page-header p-5">
        <div className="flex items-center gap-3">
          <Receipt size={24} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-2xl font-bold">{t('bills.title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('bills.description')}</p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="ghost" asChild className="w-full sm:w-auto">
            <Link to="/bill-calendar">
              <CalendarClock size={16} aria-hidden="true" />
              {t('bills.calendarView')}
            </Link>
          </Button>
          <Button asChild className="w-full sm:w-auto">
            <Link to="/transactions">
              <Plus size={16} aria-hidden="true" />
              {t('bills.addRecurring')}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="liquid-hero p-5">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Repeat size={16} className="text-accent" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('monthlyRunRate')}
            </span>
          </div>
          <p className="font-heading text-2xl font-bold">{formatMoney(monthlyTotal)}</p>
        </div>
        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <CalendarClock size={16} className="text-primary" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('thisMonth')}</span>
          </div>
          <p className="font-heading text-2xl font-bold">{dueThisMonth.length}</p>
        </div>
        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Clock size={16} className="text-warning" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">{t('remaining')}</span>
          </div>
          <p className="font-heading text-2xl font-bold">{dueSoon.length}</p>
        </div>
      </div>

      <div className="liquid-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">{t('upcomingBills')}</h2>
            <p className="text-muted-foreground mt-1 text-xs">{t('bills.upcomingDescription')}</p>
          </div>
          {overdue.length === 0 && bills.length > 0 && (
            <span className="text-success flex items-center gap-1 rounded-full border border-emerald-400/10 bg-emerald-400/[0.06] px-3 py-1 text-xs font-semibold">
              <CheckCircle size={14} aria-hidden="true" />
              {t('bills.onTrack')}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : bills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-3xl">
              <Receipt size={28} className="text-primary" aria-hidden="true" />
            </div>
            <h3 className="font-heading mb-2 text-lg font-semibold">{t('bills.emptyTitle')}</h3>
            <p className="text-muted-foreground max-w-md text-sm">{t('bills.emptyDescription')}</p>
          </div>
        ) : (
          <div>
            {bills.map((rule) => (
              <BillRow key={rule.id} rule={rule} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
