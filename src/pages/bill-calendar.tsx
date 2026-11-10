import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { PageToolbar, NativePanel } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { MonthGrid } from '@/components/bill-calendar/month-grid'
import { formatMoney, fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import { useRecurringStore } from '@/stores/recurring-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { buildBillSchedule } from '@/components/bill-calendar/schedule'
import { cn } from '@/lib/utils'
import type { Transaction } from '@/types/database'

function formatIsoDate(isoDate: string, locale: string, withYear: boolean) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
    locale,
    withYear
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' }
  )
}

function ScheduleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground block text-xs">{label}</span>
      <strong className="mt-0.5 block text-sm font-medium break-all tabular-nums">{value}</strong>
    </div>
  )
}

function MethodButton({
  label,
  panelId,
  open,
  onToggle,
}: {
  label: string
  panelId: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground h-11 w-11 shrink-0"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
    >
      <Info aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  )
}

export function BillCalendar() {
  const { t, i18n } = useTranslation(['billCalendar', 'common'])
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [fxOpen, setFxOpen] = useState(false)
  const [scheduleAboutOpen, setScheduleAboutOpen] = useState(false)
  const fxPanelId = useId()
  const scheduleAboutId = useId()
  const { rules, isLoading, fetchError, fetch } = useRecurringStore()
  const { convertCurrentToPreferred, convertHistoricalToPreferred, mainCurrency, manualRates } =
    useCurrencyStore()
  const [payments, setPayments] = useState<{ month: string; rows: Transaction[] } | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const currentMonth = dayjs().startOf('month').add(monthOffset, 'month')
  const monthKey = currentMonth.format('YYYY-MM')
  const monthName = currentMonth.toDate().toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  })
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
    const unknownRules = new Set<string>()
    let complete = true
    for (const bill of items) {
      if (bill.currency === null || bill.currency === undefined) {
        unknownRules.add(bill.description)
        continue
      }
      const result = bill.paid
        ? convertHistoricalToPreferred(bill.amount, bill.currency, bill.date)
        : convertCurrentToPreferred(bill.amount, bill.currency)
      if (result.complete) total += result.amountCentavos
      else {
        complete = false
        result.missingCurrencies.forEach((currency) => missing.add(currency))
      }
    }
    return {
      value:
        ready && mainCurrency !== null && complete && unknownRules.size === 0 && !unresolved
          ? formatMoney(total, mainCurrency)
          : '—',
      complete,
      missing: [...missing],
      unknownRules: [...unknownRules],
    }
  }
  void manualRates
  const days = Array.from({ length: Math.ceil((startDay + totalDays) / 7) * 7 }, (_, index) => {
    const day = index - startDay + 1
    return day > 0 && day <= totalDays ? day : null
  })
  const marks = useMemo(() => {
    const byDate = new Map<string, { paid: number; unpaid: number }>()
    for (const bill of bills) {
      const current = byDate.get(bill.date) ?? { paid: 0, unpaid: 0 }
      if (bill.paid) current.paid += 1
      else current.unpaid += 1
      byDate.set(bill.date, current)
    }
    return byDate
  }, [bills])
  const moveMonth = (direction: number) => {
    setMonthOffset((offset) => offset + direction)
    setSelectedDate(null)
  }
  const monthTotal = moneyTotal(bills)
  const paidTotal = moneyTotal(paid)
  const remainingTotal = moneyTotal(remaining)
  const fxMissing = [
    ...new Set([...monthTotal.missing, ...paidTotal.missing, ...remainingTotal.missing]),
  ]
  const conversionIncomplete =
    !monthTotal.complete || !paidTotal.complete || !remainingTotal.complete
  const fxIncomplete =
    mainCurrency === null || conversionIncomplete || monthTotal.unknownRules.length > 0

  return (
    <div className="page-content max-w-full min-w-0">
      <PageToolbar
        actions={
          <Button variant="outline" asChild className="min-h-11">
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
      <NativePanel className="max-w-full min-w-0 p-2 sm:p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1 px-1 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label={t('prevMonth')}
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <h2
            className="min-w-0 flex-1 basis-40 px-1 text-xl font-medium tracking-tight break-words sm:text-2xl"
            aria-live="polite"
          >
            {monthName}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label={t('nextMonth')}
            onClick={() => moveMonth(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
        {isLoading && !rules.length ? (
          <p className="text-muted-foreground p-8 text-sm" role="status">
            {t('common:status.loading')}
          </p>
        ) : (
          <MonthGrid
            monthName={monthName}
            monthKey={monthKey}
            todayKey={todayKey}
            days={days}
            marks={marks}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        )}
        {unresolved ? (
          <p className="text-warning px-1 pt-3 text-xs break-words">{t('schedule.unresolved')}</p>
        ) : null}
        <div className="border-border mt-3 border-t px-1 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-2 text-xs font-medium',
                fxIncomplete ? 'border-warning text-warning' : 'border-border text-foreground'
              )}
            >
              {fxIncomplete ? t('currency.unavailable') : mainCurrency}
            </span>
            <MethodButton
              label={t('currency.basis')}
              panelId={fxPanelId}
              open={fxOpen}
              onToggle={() => setFxOpen((open) => !open)}
            />
          </div>
          {fxIncomplete ? (
            <p className="text-warning mt-1 text-xs break-words" role="status">
              {[
                mainCurrency === null ? t('common:currencySetup.title') : null,
                mainCurrency !== null && conversionIncomplete
                  ? t('currency.missing', { currencies: fxMissing.join(', ') })
                  : null,
                monthTotal.unknownRules.length
                  ? t('estimate.unknownCurrencyRules', {
                      rules: monthTotal.unknownRules.join(', '),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          ) : null}
          {fxOpen && mainCurrency !== null ? (
            <div
              id={fxPanelId}
              className="text-muted-foreground mt-1 max-w-2xl text-xs break-words"
            >
              <p>{t('currency.actualAndEstimate', { currency: mainCurrency })}</p>
            </div>
          ) : null}
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
            <ScheduleMetric label={t('thisMonth')} value={monthTotal.value} />
            <ScheduleMetric label={t('paid')} value={paidTotal.value} />
            <ScheduleMetric label={t('remaining')} value={remainingTotal.value} />
            <ScheduleMetric
              label={t('scheduledCount', { count: bills.length })}
              value={ready ? String(bills.length) : '—'}
            />
          </div>
        </div>
      </NativePanel>
      <section className="min-w-0" aria-labelledby="bill-day-heading">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          <h3 id="bill-day-heading" className="text-sm font-medium">
            {selectedDate ? formatIsoDate(selectedDate, i18n.language, true) : t('upcomingBills')}
          </h3>
          <span className="border-border text-muted-foreground inline-flex h-7 items-center rounded-full border px-2 text-xs">
            {t('schedule.recordedChip')}
          </span>
          {selectedDate ? (
            <span className="border-border text-foreground inline-flex h-7 items-center rounded-full border px-2 text-xs">
              {t('schedule.nativeChip')}
            </span>
          ) : null}
          <MethodButton
            label={t('schedule.about')}
            panelId={scheduleAboutId}
            open={scheduleAboutOpen}
            onToggle={() => setScheduleAboutOpen((open) => !open)}
          />
          {selectedDate ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setSelectedDate(null)}
            >
              {t('schedule.allDays')}
            </Button>
          ) : null}
        </div>
        {scheduleAboutOpen ? (
          <div
            id={scheduleAboutId}
            className="text-muted-foreground mb-3 max-w-2xl space-y-1 text-xs break-words"
          >
            <p>{t('schedule.description')}</p>
            <p>{t('schedule.nativeAmounts')}</p>
          </div>
        ) : null}
        {visibleBills.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">{t('noBills')}</p>
        ) : (
          <ul aria-label={t('schedule.list')} className="border-border min-w-0 border-t">
            {visibleBills.map((bill) => (
              <li key={bill.id} className="border-border min-w-0 border-b py-3">
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{bill.description}</p>
                    <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <time dateTime={bill.date}>
                        {formatIsoDate(bill.date, i18n.language, false)}
                      </time>
                      <span aria-hidden="true">·</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1',
                          bill.paid ? 'text-success' : 'text-foreground'
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            bill.paid ? 'bg-success' : 'border-foreground border'
                          )}
                        />
                        {t(bill.paid ? 'status.paid' : 'status.unpaid')}
                      </span>
                    </p>
                  </div>
                  {selectedDate ? (
                    <p className="min-w-0 text-sm font-medium break-all tabular-nums sm:max-w-[50%] sm:text-right">
                      {bill.currency === null || bill.currency === undefined
                        ? `${fromCentavos(bill.amount).toLocaleString(i18n.language, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })} · ${t('currency.unknown')}`
                        : formatMoney(bill.amount, bill.currency)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
