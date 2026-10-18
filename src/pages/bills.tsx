import { PageToolbar } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { DueHorizon } from '@/components/bill-calendar/due-horizon'
import { useCurrencyStore } from '@/stores/currency-store'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { CalendarClock, CheckCircle, Pencil, Plus, Receipt } from 'lucide-react'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ShowMorePagination } from '@/components/shared/show-more-pagination'
import { formatMoney } from '@/lib/money'
import { useRecurringStore, type RecurringRuleWithDetails } from '@/stores/recurring-store'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

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

function formatRuleDate(isoDate: string, locale: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
    locale,
    { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

const BILLS_PAGE_SIZE = 20

function BillRow({ rule, onEdit }: { rule: RecurringRuleWithDetails; onEdit: () => void }) {
  const { t, i18n } = useTranslation('billCalendar')
  const { t: tCommon } = useTranslation('common')
  const dueIn = daysUntil(rule.next_date)
  const isOverdue = dueIn < 0
  const isSoon = dueIn >= 0 && dueIn <= 7
  const statusClass = isOverdue ? 'text-destructive' : isSoon ? 'text-warning' : 'text-success'

  return (
    <li className="border-border flex min-w-0 flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: rule.category_color || 'var(--color-muted-foreground)' }}
          />
          <h3 className="truncate text-sm font-medium">{rule.description}</h3>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {rule.category_name ?? t('uncategorized')} · {rule.account_name ?? t('unknownAccount')}
        </p>
        <p className="mt-1 text-xs">
          <time dateTime={rule.next_date} className="text-foreground tabular-nums">
            {formatRuleDate(rule.next_date, i18n.language)}
          </time>
          <span className="text-muted-foreground"> · {t(`frequency.${rule.frequency}`)}</span>
        </p>
        <p className={cn('mt-1 text-xs font-medium', statusClass)}>
          {isOverdue
            ? t('overdueBy', { count: Math.abs(dueIn) })
            : dueIn === 0
              ? t('dueToday')
              : t('dueIn', { count: dueIn })}
        </p>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
        <p className="min-w-0 flex-1 text-sm font-medium break-all tabular-nums sm:flex-none sm:text-right">
          {formatMoney(rule.amount, rule.currency ?? rule.account_currency ?? 'USD')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={onEdit}
          aria-label={`${tCommon('actions.edit')} ${rule.description}`}
        >
          <Pencil size={16} aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}

export function BillsPage() {
  const { t } = useTranslation('billCalendar')
  const { t: tCommon } = useTranslation('common')
  const { rules, isLoading, fetchError, fetch } = useRecurringStore()
  const { openRecurringDialog } = useUIStore()
  const [visibleBillCount, setVisibleBillCount] = useState(BILLS_PAGE_SIZE)

  const { convertCurrentToPreferred, preferredCurrency, mainCurrency, manualRates } =
    useCurrencyStore()
  const [status, setStatus] = useState('all')

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  const {
    bills,
    dueThisMonth,
    dueSoon,
    overdue,
    next7,
    later,
    monthlyTotal,
    missingCurrencies,
    complete,
  } = useMemo(() => {
    const today = dayjs()
    const todayStart = today.startOf('day')
    const activeBills: RecurringRuleWithDetails[] = []
    const thisMonth: RecurringRuleWithDetails[] = []
    const soon: RecurringRuleWithDetails[] = []
    const pastDue: RecurringRuleWithDetails[] = []
    const within7: RecurringRuleWithDetails[] = []
    const after7: RecurringRuleWithDetails[] = []
    let total = 0
    let conversionComplete = true
    const missing = new Set<string>()

    for (const rule of rules) {
      if (
        rule.active !== 1 ||
        rule.type !== 'expense' ||
        rule.account_is_archived === 1 ||
        (rule.end_date && rule.next_date > rule.end_date)
      )
        continue

      activeBills.push(rule)
      const result = convertCurrentToPreferred(
        monthlyEquivalent(rule),
        rule.currency ?? rule.account_currency ?? 'USD'
      )
      if (result.complete) total += result.amountCentavos
      else {
        conversionComplete = false
        result.missingCurrencies.forEach((currency) => missing.add(currency))
      }

      const dueDate = dayjs(rule.next_date)
      const dueIn = dueDate.startOf('day').diff(todayStart, 'day')
      if (dueDate.isSame(today, 'month')) thisMonth.push(rule)
      if (dueIn >= 0 && dueIn <= 30) soon.push(rule)
      if (dueIn < 0) pastDue.push(rule)
      else if (dueIn <= 7) within7.push(rule)
      else after7.push(rule)
    }

    activeBills.sort((a, b) => a.next_date.localeCompare(b.next_date))

    return {
      bills: activeBills,
      dueThisMonth: thisMonth,
      dueSoon: soon,
      overdue: pastDue,
      next7: within7,
      later: after7,
      monthlyTotal: total,
      complete: conversionComplete,
      missingCurrencies: [...missing],
    }
    // Manual authority is read by the stable store converter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, convertCurrentToPreferred, manualRates, mainCurrency, preferredCurrency])

  const filteredBills = status === 'overdue' ? overdue : status === 'soon' ? dueSoon : bills
  const visibleBills = filteredBills.slice(0, visibleBillCount)
  const runRateValue = isLoading
    ? '—'
    : complete
      ? formatMoney(monthlyTotal, preferredCurrency)
      : t('currency.unavailable')
  const runRateDetail = isLoading
    ? null
    : !complete
      ? t('currency.missing', { currencies: missingCurrencies.join(', ') })
      : t('currency.estimateToday', { currency: preferredCurrency })

  return (
    <div className="page-content max-w-full min-w-0">
      <PageToolbar
        className="flex-col items-stretch sm:flex-row sm:items-center max-sm:[&>div]:w-full max-sm:[&>div]:min-w-0"
        leading={
          <label className="text-muted-foreground flex w-full min-w-0 items-center gap-2 text-xs sm:w-auto">
            <span className="shrink-0">{t('filter.label')}</span>
            <select
              className="bg-background text-foreground border-border min-h-11 w-full min-w-0 flex-1 rounded-lg border px-3 sm:w-auto sm:max-w-xs sm:flex-none"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setVisibleBillCount(BILLS_PAGE_SIZE)
              }}
            >
              {(['all', 'soon', 'overdue'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`filter.${value}`)}
                </option>
              ))}
            </select>
          </label>
        }
        actions={
          <div className="flex w-full max-w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="ghost" asChild className="min-h-11 w-full shrink-0 sm:w-auto">
              <Link to="/bill-calendar">
                <CalendarClock size={16} aria-hidden="true" />
                {t('bills.calendarView')}
              </Link>
            </Button>
            <Button
              className="min-h-11 w-full shrink-0 sm:w-auto"
              onClick={() => openRecurringDialog()}
            >
              <Plus size={16} aria-hidden="true" />
              {t('bills.addRecurring')}
            </Button>
          </div>
        }
      />
      <ErrorBanner
        title={t('error.load')}
        message={fetchError}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />
      <DueHorizon
        overdue={overdue.length}
        next7={next7.length}
        later={later.length}
        isLoading={isLoading}
        runRateValue={runRateValue}
        runRateDetail={runRateDetail}
        runRateUnavailable={!isLoading && !complete}
        thisMonthCount={dueThisMonth.length}
        soonCount={dueSoon.length}
      />

      <section className="min-w-0" aria-labelledby="upcoming-bills-heading">
        <div className="mb-2 flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="upcoming-bills-heading" className="text-sm font-medium">
              {t('upcomingBills')}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">{t('bills.upcomingDescription')}</p>
          </div>
          {overdue.length === 0 && bills.length > 0 && (
            <p className="text-success flex items-center gap-1 text-xs font-medium">
              <CheckCircle size={14} aria-hidden="true" />
              {t('bills.onTrack')}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3" role="status" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
              <Receipt size={24} className="text-accent" aria-hidden="true" />
            </div>
            <h3 className="mb-2 text-base font-medium">
              {t(bills.length ? 'filter.empty' : 'bills.emptyTitle')}
            </h3>
            <p className="text-muted-foreground max-w-md text-sm">
              {t(bills.length ? 'filter.emptyDescription' : 'bills.emptyDescription')}
            </p>
            {bills.length === 0 ? (
              <Button className="mt-4 min-h-11" onClick={() => openRecurringDialog()}>
                <Plus size={16} aria-hidden="true" />
                {t('bills.addRecurring')}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="min-w-0">
            <ul className="border-border min-w-0 border-t">
              {visibleBills.map((rule) => (
                <BillRow key={rule.id} rule={rule} onEdit={() => openRecurringDialog(rule.id)} />
              ))}
            </ul>
            <ShowMorePagination
              shown={visibleBills.length}
              total={filteredBills.length}
              summaryLabel={tCommon('pagination.summary', {
                shown: visibleBills.length,
                total: filteredBills.length,
              })}
              showMoreLabel={tCommon('pagination.showMore', {
                count: Math.min(BILLS_PAGE_SIZE, filteredBills.length - visibleBills.length),
              })}
              onShowMore={() => setVisibleBillCount((count) => count + BILLS_PAGE_SIZE)}
              className="mt-4"
            />
          </div>
        )}
      </section>
    </div>
  )
}
