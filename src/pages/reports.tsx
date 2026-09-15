import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { isCashFlowEligible } from '@shikin/finance-core'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricItem, MetricStrip, NativePanel } from '@/components/ui/native-layout'
import { formatMoney } from '@/lib/money'
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

export function ReportsPage() {
  const { t } = useTranslation('analytics')
  const { accounts, fetch: fetchAccounts, isLoading: accountsLoading } = useAccountStore()
  const { budgets, fetch: fetchBudgets, isLoading: budgetsLoading } = useBudgetStore()
  const { preferredCurrency, convertToPreferred, getTotalBalanceInPreferred, loadRates } =
    useCurrencyStore()
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
  }, [transactions, convertToPreferred, t])
  const netFlow = income - expenses
  const totalBalanceResult = useMemo(
    () => getTotalBalanceInPreferred(accounts),
    [accounts, getTotalBalanceInPreferred]
  )
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
  const totalBudgeted = budgets.reduce((total, budget) => total + budget.amount, 0)
  const totalSpentAgainstBudgets = budgets.reduce((total, budget) => total + budget.spent, 0)
  const budgetUsage =
    totalBudgeted > 0 ? Math.round((totalSpentAgainstBudgets / totalBudgeted) * 100) : 0
  const isLoading = accountsLoading || budgetsLoading || transactionsLoading
  const periodLabel = dayjs().format('MMMM YYYY')

  return (
    <div className="page-content">
      <div className="text-muted-foreground text-sm">
        <span>{t('reports.title')}</span>
        <span aria-hidden="true"> · </span>
        <span>{t('reports.description')}</span>
        <span aria-hidden="true"> · </span>
        <span>{periodLabel}</span>
      </div>

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
              formatMoney(totalBalanceResult.amountCentavos, totalBalanceResult.preferredCurrency)
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
              {t('reports.cashUnavailable', { currencies: cashFlowMissingCurrencies.join(', ') })}
            </p>
          ) : topCategories.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              {t('reports.noSpending')}
            </p>
          ) : (
            <div className="space-y-3">
              {topCategories.map((category) => {
                const percent = expenses > 0 ? Math.round((category.amount / expenses) * 100) : 0
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
          <div className="my-6 flex justify-center">
            <div className="border-border bg-muted flex h-28 w-28 items-center justify-center rounded-full border">
              <span className="text-3xl font-semibold tabular-nums">{budgetUsage}%</span>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t('reports.budgeted')}</span>
              <span className="font-semibold tabular-nums">{formatMoney(totalBudgeted)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t('reports.spent')}</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(totalSpentAgainstBudgets)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t('reports.transactions')}</span>
              <span className="font-semibold tabular-nums">{monthTransactionCount}</span>
            </div>
          </div>
        </NativePanel>
      </div>
    </div>
  )
}
