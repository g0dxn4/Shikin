import { PageToolbar, MetricStrip, MetricItem } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
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

const BILLS_PAGE_SIZE = 20

function BillRow({ rule, onEdit }: { rule: RecurringRuleWithDetails; onEdit: () => void }) {
  const { t } = useTranslation('billCalendar')
  const { t: tCommon } = useTranslation('common')
  const dueIn = daysUntil(rule.next_date)
  const isOverdue = dueIn < 0
  const isSoon = dueIn >= 0 && dueIn <= 7

  return (
    <div className="soft-divider grid min-w-0 gap-3 border-b py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className="border-border bg-muted/50 mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
          style={{ color: rule.category_color ?? 'var(--accent)' }}
        >
          <Receipt size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{rule.description}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {rule.category_name ?? t('uncategorized')} · {rule.account_name ?? t('unknownAccount')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-muted-foreground border-border bg-muted/50 rounded-full border px-2 py-1 text-[10px] tracking-wider uppercase tabular-nums">
              {rule.frequency}
            </span>
            <span
              className={`rounded-full border px-2 py-1 text-[10px] tracking-wider uppercase tabular-nums ${
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
      <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
        <div className="min-w-0 text-left sm:text-right">
          <p className="text-lg font-bold tracking-tight">
            {formatMoney(rule.amount, rule.currency ?? rule.account_currency ?? 'USD')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {dayjs(rule.next_date).format('MMM D, YYYY')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
          onClick={onEdit}
          aria-label={`${tCommon('actions.edit')} ${rule.description}`}
        >
          <Pencil size={12} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

export function BillsPage() {
  const { t } = useTranslation('billCalendar')
  const { t: tCommon } = useTranslation('common')
  const { rules, isLoading, fetchError, fetch } = useRecurringStore()
  const { openRecurringDialog } = useUIStore()
  const [visibleBillCount, setVisibleBillCount] = useState(BILLS_PAGE_SIZE)

  const { convertToPreferred, preferredCurrency, rates, invalidRates } = useCurrencyStore()
  const [status, setStatus] = useState('all')

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  const { bills, dueThisMonth, dueSoon, overdue, monthlyTotal, missingCurrencies, complete } =
    useMemo(() => {
      const today = dayjs()
      const todayStart = today.startOf('day')
      const activeBills: RecurringRuleWithDetails[] = []
      const thisMonth: RecurringRuleWithDetails[] = []
      const soon: RecurringRuleWithDetails[] = []
      const pastDue: RecurringRuleWithDetails[] = []
      let total = 0
      let complete = true
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
        const result = convertToPreferred(
          monthlyEquivalent(rule),
          rule.currency ?? rule.account_currency ?? 'USD'
        )
        if (result.complete) total += result.amountCentavos
        else {
          complete = false
          result.missingCurrencies.forEach((currency) => missing.add(currency))
        }

        const dueDate = dayjs(rule.next_date)
        const dueIn = dueDate.startOf('day').diff(todayStart, 'day')
        if (dueDate.isSame(today, 'month')) thisMonth.push(rule)
        if (dueIn >= 0 && dueIn <= 30) soon.push(rule)
        if (dueIn < 0) pastDue.push(rule)
      }

      activeBills.sort((a, b) => a.next_date.localeCompare(b.next_date))

      return {
        bills: activeBills,
        dueThisMonth: thisMonth,
        dueSoon: soon,
        overdue: pastDue,
        monthlyTotal: total,
        complete,
        missingCurrencies: [...missing],
      }
      // Rates are read by the stable store converter.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rules, convertToPreferred, rates, invalidRates, preferredCurrency])

  const filteredBills = status === 'overdue' ? overdue : status === 'soon' ? dueSoon : bills
  const visibleBills = filteredBills.slice(0, visibleBillCount)

  return (
    <div className="page-content">
      <PageToolbar
        leading={
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            {t('filter.label')}
            <select
              className="bg-background text-foreground border-border min-h-10 rounded-lg border px-3"
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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="ghost" asChild className="w-full sm:w-auto">
              <Link to="/bill-calendar">
                <CalendarClock size={16} aria-hidden="true" />
                {t('bills.calendarView')}
              </Link>
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => openRecurringDialog()}>
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
      <MetricStrip>
        <MetricItem
          label={t('monthlyRunRate')}
          value={
            isLoading
              ? '—'
              : complete
                ? formatMoney(monthlyTotal, preferredCurrency)
                : t('currency.unavailable')
          }
          detail={
            !complete
              ? t('currency.missing', { currencies: missingCurrencies.join(', ') })
              : preferredCurrency
          }
        />
        <MetricItem label={t('thisMonth')} value={isLoading ? '—' : dueThisMonth.length} />
        <MetricItem label={t('filter.soon')} value={isLoading ? '—' : dueSoon.length} />
        <MetricItem label={t('filter.overdue')} value={isLoading ? '—' : overdue.length} />
      </MetricStrip>

      <div className="native-panel p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('upcomingBills')}</h2>
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
          <div className="space-y-3" role="status" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-xl">
              <Receipt size={28} className="text-primary" aria-hidden="true" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">
              {t(bills.length ? 'filter.empty' : 'bills.emptyTitle')}
            </h3>
            <p className="text-muted-foreground max-w-md text-sm">{t('bills.emptyDescription')}</p>
          </div>
        ) : (
          <div>
            {visibleBills.map((rule) => (
              <BillRow key={rule.id} rule={rule} onEdit={() => openRecurringDialog(rule.id)} />
            ))}
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
      </div>
    </div>
  )
}
