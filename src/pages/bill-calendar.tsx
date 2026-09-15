import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { PageToolbar, NativePanel, MetricStrip, MetricItem } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { formatMoney } from '@/lib/money'
import { query } from '@/lib/database'
import { useRecurringStore } from '@/stores/recurring-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { buildBillSchedule } from '@/components/bill-calendar/schedule'
import type { Transaction } from '@/types/database'

export function BillCalendar() {
  const { t } = useTranslation(['billCalendar', 'common'])
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const { rules, isLoading, fetchError, fetch } = useRecurringStore()
  const { convertToPreferred, preferredCurrency } = useCurrencyStore()
  const [payments, setPayments] = useState<{ month: string; rows: Transaction[] } | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const currentMonth = dayjs().startOf('month').add(monthOffset, 'month')
  const monthKey = currentMonth.format('YYYY-MM')
  const monthName = currentMonth
    .toDate()
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const todayKey = dayjs().format('YYYY-MM-DD')
  const totalDays = currentMonth.daysInMonth()
  const startDay = currentMonth.day()

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])
  useEffect(() => {
    let active = true
    query<Transaction>(
      `SELECT * FROM transactions WHERE recurring_rule_id IS NOT NULL AND date >= ? AND date <= ?`,
      [`${monthKey}-01`, dayjs(`${monthKey}-01`).endOf('month').format('YYYY-MM-DD')]
    )
      .then((rows) => {
        if (active) {
          setPayments({ month: monthKey, rows })
          setPaymentError(null)
        }
      })
      .catch((error) => {
        if (active) setPaymentError(String(error))
      })
    return () => {
      active = false
    }
  }, [monthKey, rules, retry])

  const { bills, unresolved } = useMemo(
    () => buildBillSchedule(rules, payments?.month === monthKey ? payments.rows : [], monthKey),
    [rules, payments, monthKey]
  )
  const paid = bills.filter((bill) => bill.paid)
  const remaining = bills.filter((bill) => !bill.paid)
  const visibleBills = selectedDate ? bills.filter((bill) => bill.date === selectedDate) : bills
  const ready = !isLoading && payments?.month === monthKey && !paymentError && !fetchError
  const moneyTotal = (items: typeof bills) => {
    let total = 0
    const missing = new Set<string>()
    let complete = true
    for (const bill of items) {
      const result = convertToPreferred(bill.amount, bill.currency)
      if (result.complete) total += result.amountCentavos
      else {
        complete = false
        result.missingCurrencies.forEach((currency) => missing.add(currency))
      }
    }
    return {
      value: ready && complete && !unresolved ? formatMoney(total, preferredCurrency) : '—',
      detail: !complete
        ? t('currency.missing', { currencies: [...missing].join(', ') })
        : preferredCurrency,
    }
  }
  const days = Array.from({ length: Math.ceil((startDay + totalDays) / 7) * 7 }, (_, index) => {
    const day = index - startDay + 1
    return day > 0 && day <= totalDays ? day : null
  })
  const moveMonth = (direction: number) => {
    setMonthOffset((offset) => offset + direction)
    setSelectedDate(null)
  }
  const dayHeaders = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ] as const

  return (
    <div className="page-content">
      <PageToolbar
        leading={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('prevMonth')}
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <h2 className="text-sm font-semibold" aria-live="polite">
              {monthName}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('nextMonth')}
              onClick={() => moveMonth(1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        }
        actions={
          <Button variant="outline" asChild>
            <Link to="/bills">{t('listView')}</Link>
          </Button>
        }
      />
      <ErrorBanner
        title={t('error.load')}
        message={fetchError || paymentError}
        onRetry={() => {
          void fetch().catch(() => {})
          setRetry((value) => value + 1)
        }}
      />
      <MetricStrip>
        <MetricItem label={t('thisMonth')} {...moneyTotal(bills)} />
        <MetricItem label={t('paid')} {...moneyTotal(paid)} />
        <MetricItem label={t('remaining')} {...moneyTotal(remaining)} />
        <MetricItem
          label={t('scheduledCount', { count: bills.length })}
          value={ready ? bills.length : '—'}
        />
      </MetricStrip>
      {unresolved && <p className="text-warning text-xs">{t('schedule.unresolved')}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <NativePanel className="p-2 sm:p-4">
          {isLoading && !rules.length ? (
            <p className="text-muted-foreground p-8 text-sm" role="status">
              {t('common:status.loading')}
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">{monthName}</caption>
              <thead>
                <tr>
                  {dayHeaders.map((day) => (
                    <th
                      scope="col"
                      key={day}
                      className="text-muted-foreground py-3 text-center text-xs font-medium"
                    >
                      {t(`dayLabels.${day}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: days.length / 7 }, (_, week) => (
                  <tr key={week}>
                    {days.slice(week * 7, week * 7 + 7).map((day, index) => {
                      const date = day ? `${monthKey}-${String(day).padStart(2, '0')}` : ''
                      const due = bills.filter((bill) => bill.date === date)
                      return (
                        <td key={index} className="border-border h-24 border p-0 align-top sm:h-28">
                          {day && (
                            <button
                              type="button"
                              aria-label={`${monthName} ${day}, ${t('scheduledCount', { count: due.length })}`}
                              aria-current={date === todayKey ? 'date' : undefined}
                              aria-pressed={selectedDate === date}
                              onClick={() => setSelectedDate(date)}
                              className={`hover:bg-muted focus-visible:ring-ring flex h-full w-full min-w-0 flex-col gap-1 overflow-hidden p-1.5 text-left focus-visible:ring-2 focus-visible:ring-inset ${selectedDate === date ? 'bg-primary/10 ring-primary ring-1 ring-inset' : ''}`}
                            >
                              <span
                                className={`text-xs tabular-nums ${date === todayKey ? 'text-primary font-bold' : 'text-muted-foreground'}`}
                              >
                                {day}
                              </span>
                              {due.slice(0, 2).map((bill) => (
                                <span
                                  key={bill.id}
                                  className={`block w-full truncate rounded px-1 py-0.5 text-[10px] ${bill.paid ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}
                                >
                                  {bill.description}
                                </span>
                              ))}
                              {due.length > 2 && (
                                <span className="text-muted-foreground text-[10px]">
                                  +{due.length - 2}
                                </span>
                              )}
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </NativePanel>
        <NativePanel className="p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">
              {selectedDate ? dayjs(selectedDate).format('MMM D, YYYY') : t('upcomingBills')}
            </h3>
            {selectedDate && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(null)}>
                {t('schedule.allDays')}
              </Button>
            )}
          </div>
          <p className="text-muted-foreground mb-4 text-xs">{t('schedule.description')}</p>
          {visibleBills.length === 0 ? (
            <p className="text-muted-foreground py-6 text-sm">{t('noBills')}</p>
          ) : (
            <div className="divide-border max-h-[32rem] divide-y overflow-auto">
              {visibleBills.map((bill) => (
                <div key={bill.id} className="flex justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{bill.description}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {dayjs(bill.date).format('MMM D')} · {t(bill.paid ? 'paid' : 'remaining')}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">
                    {formatMoney(bill.amount, bill.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </NativePanel>
      </div>
    </div>
  )
}
