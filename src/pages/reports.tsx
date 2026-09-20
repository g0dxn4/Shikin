import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { isCashFlowEligible } from '@shikin/finance-core'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MetricItem, MetricStrip, NativePanel } from '@/components/ui/native-layout'
import { useBudgetDisplay } from '@/components/budgets/use-budget-display'
import { formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import {
  isValidNetConsumptionPeriod,
  readNetConsumptionReport,
  type FrontendNetConsumptionReport,
} from '@/lib/consumption-service'
import { buildTransactionsHref } from '@/lib/transaction-query-href'
import { useAccountStore } from '@/stores/account-store'
import { useBudgetStore } from '@/stores/budget-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useTransactionStore } from '@/stores/transaction-store'

function startOfCurrentMonth() {
  return dayjs().startOf('month').format('YYYY-MM-DD')
}

function endOfCurrentMonth() {
  return dayjs().endOf('month').format('YYYY-MM-DD')
}

function startOfPreviousMonth() {
  return dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
}

function endOfPreviousMonth() {
  return dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')
}

export function ReportsPage() {
  const { t } = useTranslation('analytics')
  const [basis, setBasis] = useState<'gross_cashflow' | 'net_consumption'>('gross_cashflow')
  const [netStart, setNetStart] = useState(startOfCurrentMonth)
  const [netEnd, setNetEnd] = useState(endOfCurrentMonth)
  const { accounts, fetch: fetchAccounts, isLoading: accountsLoading } = useAccountStore()
  const { budgets, fetch: fetchBudgets, isLoading: budgetsLoading } = useBudgetStore()
  const {
    preferredCurrency,
    rates,
    invalidRates,
    convertToPreferred,
    getTotalBalanceInPreferred,
    loadRates,
  } = useCurrencyStore()
  const {
    transactions,
    fetch: fetchTransactions,
    isLoading: transactionsLoading,
  } = useTransactionStore()

  useEffect(() => {
    void Promise.allSettled([fetchAccounts(), fetchBudgets(), fetchTransactions(), loadRates()])
  }, [fetchAccounts, fetchBudgets, fetchTransactions, loadRates])

  const {
    monthTransactionCount,
    income,
    expenses,
    topCategories,
    cashFlowComplete,
    cashFlowMissingCurrencies,
  } = useMemo(() => {
    // Currency actions are stable Zustand methods that read these mutable store fields.
    void preferredCurrency
    void rates
    void invalidRates
    const monthStart = startOfCurrentMonth()
    const monthEnd = endOfCurrentMonth()
    const categoryTotals = new Map<string, { name: string; color: string; amount: number }>()
    let transactionCount = 0
    let totalIncome = 0
    let totalExpenses = 0
    const incompleteCurrencies = new Set<string>()

    for (const tx of transactions) {
      if (tx.date < monthStart || tx.date > monthEnd) continue
      if (
        !isCashFlowEligible({
          type: tx.type,
          status: tx.status ?? 'posted',
          ledgerTreatment: tx.ledger_treatment ?? 'normal',
          reportingTreatment: tx.reporting_treatment ?? 'normal',
          transactionKind: tx.transaction_kind ?? 'standard',
          isArchived: tx.is_archived ?? 0,
        })
      )
        continue

      const converted = convertToPreferred(tx.amount, tx.currency)
      if (!converted.complete) {
        incompleteCurrencies.add(tx.currency?.trim().toUpperCase() || t('reports.blankCurrency'))
        continue
      }
      const amount = converted.amountCentavos
      transactionCount += 1
      if (tx.type === 'income') {
        totalIncome += amount
      } else if (tx.type === 'expense') {
        totalExpenses += amount
        const key = tx.category_name ?? t('reports.uncategorized')
        const existing = categoryTotals.get(key)
        categoryTotals.set(key, {
          name: key,
          color: existing?.color ?? tx.category_color ?? 'var(--accent)',
          amount: (existing?.amount ?? 0) + amount,
        })
      }
    }

    return {
      monthTransactionCount: transactionCount,
      income: totalIncome,
      expenses: totalExpenses,
      topCategories: [...categoryTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
      cashFlowComplete: incompleteCurrencies.size === 0,
      cashFlowMissingCurrencies: [...incompleteCurrencies].sort(),
    }
  }, [transactions, preferredCurrency, rates, invalidRates, convertToPreferred, t])
  const netFlow = income - expenses
  const totalBalanceResult = useMemo(() => {
    // The stable store action reads these values when invoked.
    void preferredCurrency
    void rates
    void invalidRates
    return getTotalBalanceInPreferred(accounts)
  }, [accounts, preferredCurrency, rates, invalidRates, getTotalBalanceInPreferred])
  const invalidCurrencyDetails =
    !totalBalanceResult.complete && totalBalanceResult.reason === 'invalid_currency_data'
      ? [
          ...(totalBalanceResult.invalidCurrencies ?? []).map((diagnostic) => {
            const owner =
              diagnostic.accountName ?? diagnostic.accountId ?? t('reports.preferredCurrency')
            const value = diagnostic.value || t('reports.blankCurrency')
            return `${owner} (${value})`
          }),
          ...(totalBalanceResult.invalidRates ?? []).map((diagnostic) =>
            t('reports.invalidRate', {
              from: diagnostic.fromCurrency || t('reports.blankCurrency'),
              to: diagnostic.toCurrency || t('reports.blankCurrency'),
              rate: diagnostic.rate || t('reports.blankCurrency'),
            })
          ),
        ].join(', ')
      : ''
  const {
    budgets: displayBudgets,
    complete: budgetsComplete,
    error: budgetsDisplayError,
  } = useBudgetDisplay(budgets)
  const totalBudgeted = displayBudgets.reduce((total, budget) => total + budget.amount, 0)
  const totalSpentAgainstBudgets = displayBudgets.reduce((total, budget) => total + budget.spent, 0)
  const budgetUsage =
    budgetsComplete && totalBudgeted > 0
      ? Math.round((totalSpentAgainstBudgets / totalBudgeted) * 100)
      : 0
  const isLoading = accountsLoading || budgetsLoading || transactionsLoading
  const periodLabel = dayjs().format('MMMM YYYY')
  const netPeriodValid = isValidNetConsumptionPeriod(netStart, netEnd)

  return (
    <div className="page-content">
      <div className="text-muted-foreground text-sm">
        <span>{t('reports.title')}</span>
        <span aria-hidden="true"> · </span>
        <span>{t('reports.description')}</span>
        <span aria-hidden="true"> · </span>
        <span>{basis === 'net_consumption' ? `${netStart} – ${netEnd}` : periodLabel}</span>
      </div>

      <ReportBasisControl basis={basis} onChange={setBasis} />

      {basis === 'net_consumption' ? (
        <>
          <NetPeriodControls
            start={netStart}
            end={netEnd}
            onStartChange={setNetStart}
            onEndChange={setNetEnd}
          />
          {netPeriodValid ? (
            <NetConsumptionPanel key={`${netStart}:${netEnd}`} start={netStart} end={netEnd} />
          ) : (
            <p className="text-destructive text-sm font-semibold" role="alert">
              <NetPeriodInvalidMessage />
            </p>
          )}
        </>
      ) : (
        <>
          <MetricStrip aria-label={t('reports.title')}>
            <MetricItem
              label={t('reports.income')}
              value={
                isLoading ? (
                  <Skeleton className="h-6 w-24" />
                ) : cashFlowComplete ? (
                  formatMoney(income, preferredCurrency)
                ) : (
                  '—'
                )
              }
            />
            <MetricItem
              label={t('reports.expenses')}
              value={
                isLoading ? (
                  <Skeleton className="h-6 w-24" />
                ) : cashFlowComplete ? (
                  formatMoney(expenses, preferredCurrency)
                ) : (
                  '—'
                )
              }
            />
            <MetricItem
              label={t('reports.netFlow')}
              value={
                isLoading ? (
                  <Skeleton className="h-6 w-24" />
                ) : cashFlowComplete ? (
                  formatMoney(netFlow, preferredCurrency)
                ) : (
                  '—'
                )
              }
              className={cashFlowComplete && netFlow < 0 ? 'text-destructive' : undefined}
            />
            <MetricItem
              label={t('reports.cash')}
              value={
                isLoading ? (
                  <Skeleton className="h-6 w-24" />
                ) : totalBalanceResult.complete ? (
                  formatMoney(
                    totalBalanceResult.amountCentavos,
                    totalBalanceResult.preferredCurrency
                  )
                ) : (
                  <span className="text-warning block text-sm leading-snug" role="alert">
                    {totalBalanceResult.reason === 'invalid_currency_data'
                      ? t('reports.cashInvalidData', { details: invalidCurrencyDetails })
                      : t('reports.cashUnavailable', {
                          currencies: totalBalanceResult.missingCurrencies.join(', '),
                        })}
                  </span>
                )
              }
            />
          </MetricStrip>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
            <NativePanel className="p-5 sm:p-6">
              <div className="mb-4">
                <h2 className="text-base font-semibold">{t('reports.categoryBreakdown')}</h2>
                <p className="text-muted-foreground mt-1 text-xs">{t('reports.currentMonth')}</p>
              </div>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-11 rounded-xl" />
                  ))}
                </div>
              ) : !cashFlowComplete ? (
                <p className="text-warning py-10 text-center text-sm" role="alert">
                  {t('reports.cashUnavailable', {
                    currencies: cashFlowMissingCurrencies.join(', '),
                  })}
                </p>
              ) : topCategories.length === 0 ? (
                <p className="text-muted-foreground py-10 text-center text-sm">
                  {t('reports.noSpending')}
                </p>
              ) : (
                <div className="space-y-3">
                  {topCategories.map((category) => {
                    const percent =
                      expenses > 0 ? Math.round((category.amount / expenses) * 100) : 0
                    return (
                      <div key={category.name}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: category.color }}
                            />
                            <span className="truncate font-medium">{category.name}</span>
                          </div>
                          <span className="font-semibold tabular-nums">
                            {formatMoney(category.amount, preferredCurrency)}
                          </span>
                        </div>
                        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                          <div
                            className="bg-accent h-full rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </NativePanel>

            <NativePanel className="p-5 sm:p-6">
              <h2 className="text-base font-semibold">{t('reports.budgetHealth')}</h2>
              <p className="text-muted-foreground mt-1 text-xs">{t('reports.budgetDescription')}</p>
              {budgetsDisplayError ? (
                <p className="text-warning py-10 text-center text-sm" role="alert">
                  {t('reports.budgetReadError', { message: budgetsDisplayError })}
                </p>
              ) : !budgetsComplete ? (
                <p className="text-warning py-10 text-center text-sm" role="alert">
                  {t('reports.budgetUnavailable')}
                </p>
              ) : (
                <>
                  <div className="my-6 flex justify-center">
                    <div className="border-border bg-muted flex h-28 w-28 items-center justify-center rounded-full border">
                      <span className="text-3xl font-semibold tabular-nums">{budgetUsage}%</span>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{t('reports.budgeted')}</span>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(totalBudgeted, preferredCurrency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{t('reports.spent')}</span>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(totalSpentAgainstBudgets, preferredCurrency)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{t('reports.transactions')}</span>
                      <span className="font-semibold tabular-nums">{monthTransactionCount}</span>
                    </div>
                  </div>
                </>
              )}
            </NativePanel>
          </div>
        </>
      )}
    </div>
  )
}

function ReportBasisControl({
  basis,
  onChange,
}: {
  basis: 'gross_cashflow' | 'net_consumption'
  onChange: (basis: 'gross_cashflow' | 'net_consumption') => void
}) {
  const { t } = useTranslation('consumption')
  return (
    <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">{t('basis.label')}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {basis === 'gross_cashflow' ? t('basis.grossDescription') : t('basis.netDescription')}
        </p>
      </div>
      <div className="bg-muted flex rounded-lg p-0.5" role="group" aria-label={t('basis.label')}>
        <button
          type="button"
          aria-pressed={basis === 'gross_cashflow'}
          className={`filter-pill min-h-11 ${basis === 'gross_cashflow' ? 'filter-pill-active' : ''}`}
          onClick={() => onChange('gross_cashflow')}
        >
          {t('basis.gross')}
        </button>
        <button
          type="button"
          aria-pressed={basis === 'net_consumption'}
          className={`filter-pill min-h-11 ${basis === 'net_consumption' ? 'filter-pill-active' : ''}`}
          onClick={() => onChange('net_consumption')}
        >
          {t('basis.net')}
        </button>
      </div>
    </div>
  )
}

function NetPeriodInvalidMessage() {
  const { t } = useTranslation('consumption')
  return t('period.invalid')
}

function NetPeriodControls({
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  start: string
  end: string
  onStartChange: (value: string) => void
  onEndChange: (value: string) => void
}) {
  const { t } = useTranslation('consumption')
  const currentStart = startOfCurrentMonth()
  const currentEnd = endOfCurrentMonth()
  const previousStart = startOfPreviousMonth()
  const previousEnd = endOfPreviousMonth()
  const isCurrent = start === currentStart && end === currentEnd
  const isPrevious = start === previousStart && end === previousEnd

  return (
    <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-wrap gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="net-period-start">{t('period.start')}</Label>
            <Input
              id="net-period-start"
              type="date"
              className="min-h-11 w-[11.5rem]"
              value={start}
              onChange={(event) => onStartChange(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="net-period-end">{t('period.end')}</Label>
            <Input
              id="net-period-end"
              type="date"
              className="min-h-11 w-[11.5rem]"
              value={end}
              onChange={(event) => onEndChange(event.target.value)}
            />
          </div>
        </div>
        <div className="bg-muted flex rounded-lg p-0.5" role="group" aria-label={t('period.label')}>
          <button
            type="button"
            aria-pressed={isPrevious}
            className={`filter-pill min-h-11 ${isPrevious ? 'filter-pill-active' : ''}`}
            onClick={() => {
              onStartChange(previousStart)
              onEndChange(previousEnd)
            }}
          >
            {t('period.previousMonth')}
          </button>
          <button
            type="button"
            aria-pressed={isCurrent}
            className={`filter-pill min-h-11 ${isCurrent ? 'filter-pill-active' : ''}`}
            onClick={() => {
              onStartChange(currentStart)
              onEndChange(currentEnd)
            }}
          >
            {t('period.currentMonth')}
          </button>
        </div>
      </div>
    </div>
  )
}

function NetConsumptionPanel({ start, end }: { start: string; end: string }) {
  const { t } = useTranslation('consumption')
  const { accounts = [], archivedAccounts = [] } = useAccountStore()
  const [report, setReport] = useState<FrontendNetConsumptionReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryNonce, setRetryNonce] = useState(0)
  const requestSequence = useRef(0)
  const accountNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const account of [...accounts, ...archivedAccounts]) {
      if (account.id && account.name) names.set(account.id, account.name)
    }
    return names
  }, [accounts, archivedAccounts])

  useEffect(() => {
    const sequence = ++requestSequence.current
    void Promise.resolve()
      .then(() => {
        if (sequence !== requestSequence.current) return null
        setLoading(true)
        setError(null)
        setReport(null)
        return readNetConsumptionReport(start, end)
      })
      .then((nextReport) => {
        if (nextReport && sequence === requestSequence.current) setReport(nextReport)
      })
      .catch((readError) => {
        if (sequence !== requestSequence.current) return
        setReport(null)
        setError(getErrorMessage(readError))
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false)
      })
    return () => {
      if (sequence === requestSequence.current) requestSequence.current += 1
    }
  }, [end, start, retryNonce])

  if (loading) {
    return (
      <NativePanel className="space-y-3 p-5 sm:p-6" aria-busy="true" aria-label={t('report.title')}>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </NativePanel>
    )
  }
  if (error) {
    return (
      <NativePanel className="space-y-3 p-5 sm:p-6">
        <p className="text-destructive text-sm font-semibold" role="alert">
          {t('report.loadError')}: {error}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => setRetryNonce((value) => value + 1)}
        >
          {t('actions.retry')}
        </Button>
      </NativePanel>
    )
  }
  if (!report) return null

  const reviewStart = report.period.start
  const reviewEnd = report.period.end

  return (
    <div className="space-y-3">
      <NativePanel className="p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {report.complete ? t('report.completeStatus') : t('report.knownOnly')}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{t('report.title')}</h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              {report.complete ? t('report.complete') : t('report.incomplete')}
            </p>
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {reviewStart} – {reviewEnd}
          </span>
        </div>

        {report.totalsByCurrency.length === 0 ? (
          <p className="border-border bg-muted/30 text-muted-foreground mt-5 rounded-lg border p-4 text-sm">
            {t('report.noKnownTotals')}
          </p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {report.totalsByCurrency.map((total) => (
              <section key={total.currency} className="border-border rounded-xl border p-4">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  {total.currency}
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('report.consumption')}</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatMoney(total.consumptionCentavos, total.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('report.earnedIncome')}</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatMoney(total.earnedIncomeCentavos, total.currency)}
                    </dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
        )}
      </NativePanel>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <NativePanel className="min-w-0 p-5">
          <h2 className="text-sm font-semibold">{t('report.categoryBreakdown')}</h2>
          <div className="mt-3 space-y-2">
            {report.byCategory.map((category) => (
              <div
                key={`${category.currency}:${category.categoryId ?? 'none'}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 break-all">
                  {category.categoryName ?? category.categoryId ?? t('report.uncategorized')}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(category.amountCentavos, category.currency)}
                </span>
              </div>
            ))}
          </div>
        </NativePanel>

        <NativePanel className="min-w-0 overflow-x-hidden p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusBlock
              label={t('report.classification')}
              complete={report.classificationComplete}
              count={report.unresolvedIds.length}
            />
            <StatusBlock
              label={t('report.coverage')}
              complete={report.coverageComplete}
              count={report.uncoveredAccountIds.length}
            />
          </div>
          {report.unresolvedIds.length > 0 ? (
            <div className="mt-4 min-w-0">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" className="min-h-11">
                  <Link
                    to={buildTransactionsHref({
                      reviewReason: 'unclassified',
                      dateFrom: reviewStart,
                      dateTo: reviewEnd,
                    })}
                  >
                    {t('actions.reviewUnclassified')}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="min-h-11">
                  <Link to={buildTransactionsHref({ dateFrom: reviewStart, dateTo: reviewEnd })}>
                    {t('actions.reviewPeriod')}
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
          {report.uncoveredAccountIds.length > 0 ? (
            <div className="mt-4 min-w-0">
              <p className="text-muted-foreground text-xs break-all">
                {t('report.uncovered')}:{' '}
                {report.uncoveredAccountIds
                  .map((accountId) => accountNames.get(accountId) ?? accountId)
                  .join(', ')}
              </p>
              <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                {report.uncoveredAccountIds.map((accountId) => {
                  const name = accountNames.get(accountId) ?? accountId
                  return (
                    <Button
                      key={accountId}
                      asChild
                      variant="outline"
                      className="min-h-11 max-w-full"
                    >
                      <Link
                        to={`/accounts?account=${encodeURIComponent(accountId)}`}
                        className="max-w-full min-w-0"
                      >
                        <span className="min-w-0 break-all">
                          {t('actions.reviewAccount')} · {name}
                        </span>
                      </Link>
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </NativePanel>
      </div>
    </div>
  )
}

function StatusBlock({
  label,
  complete,
  count,
}: {
  label: string
  complete: boolean
  count: number
}) {
  const { t } = useTranslation('consumption')
  return (
    <div className="border-border rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-sm font-semibold">
        {complete ? t('report.completeStatus') : `${t('report.incompleteStatus')} · ${count}`}
      </p>
    </div>
  )
}
