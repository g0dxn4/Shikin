import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Target, Plus, ArrowRight } from 'lucide-react'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { NativePanel } from '@/components/ui/native-layout'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { useInvestmentStore } from '@/stores/investment-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { useGoalStore } from '@/stores/goal-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useNetWorthStore } from '@/stores/net-worth-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { buildDashboardAnalytics, type ConversionState } from '@/lib/dashboard-analytics'
import { currencyAuthorityKey } from '@/stores/currency-authority'
import { useDashboardSplits } from '@/components/dashboard/use-dashboard-splits'
import { SpendingAnalytics } from '@/components/dashboard/spending-analytics'
import { OverviewNetWorth, type NetWorthPeriod } from '@/components/dashboard/overview-net-worth'
import { OverviewCategories } from '@/components/dashboard/overview-categories'
import { OverviewCashFlow } from '@/components/dashboard/overview-cash-flow'
import { GoalIcon } from '@/components/goals/goal-icon'

function describeIncompleteNetWorth(reasons: Array<string | false | undefined>, fallback: string) {
  const parts = reasons.filter((reason): reason is string => Boolean(reason))
  return parts.length > 0 ? parts.join(' ') : fallback
}

function describeIncompleteConversion(
  conversion: ConversionState,
  labels: {
    mainRequired: string
    invalidData: string
    missingRates: (currencies: string) => string
    unavailable: string
  }
): string {
  if (conversion.kind !== 'incomplete') return ''
  if (conversion.reason === 'main_currency_unconfigured') return labels.mainRequired
  if (conversion.reason === 'invalid_currency_data') return labels.invalidData
  if (conversion.missingCurrencies.length > 0) {
    return labels.missingRates(conversion.missingCurrencies.join(', '))
  }
  return labels.unavailable
}

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tTx } = useTranslation('transactions')
  const { t: tAnalytics } = useTranslation('analytics')
  const { openTransactionDialog } = useUIStore()
  const {
    accounts,
    isLoading: accountsLoading,
    fetchError: accountsFetchError,
    fetch: fetchAccounts,
  } = useAccountStore()
  const { investments } = useInvestmentStore()
  const {
    transactions,
    isLoading: txLoading,
    fetchError: transactionsFetchError,
    fetch: fetchTransactions,
  } = useTransactionStore()
  const { goals, fetchError: goalsFetchError, fetch: fetchGoals } = useGoalStore()
  const { error: currencyError, mainCurrency, manualRates, loadRates } = useCurrencyStore()
  const {
    history,
    historyComplete,
    historyAuthorityKey,
    historyCurrency,
    historyRequestedPeriod,
    historyLoading,
    historyError,
    historyMissingCurrencies,
    isLoading: netWorthLoading,
    netWorth,
    totalsComplete: netWorthComplete,
    preferredCurrency: netWorthCurrency,
    missingCurrencies: netWorthMissingCurrencies,
    incompleteHoldingIds: netWorthIncompleteHoldingIds,
    unresolvedAccountIds: netWorthUnresolvedAccountIds,
    loadHistory,
    calculateCurrent,
  } = useNetWorthStore()
  const [historyPeriod, setHistoryPeriod] = useState<NetWorthPeriod>('6m')
  const [netWorthCalculation, setNetWorthCalculation] = useState<{
    authorityKey: string | null
    accounts: typeof accounts | null
    investments: typeof investments | null
    error: string | null
  }>({ authorityKey: null, accounts: null, investments: null, error: null })
  const now = useMemo(() => dayjs(), [])
  const authorityKey = useMemo(
    () => currencyAuthorityKey({ mainCurrency, manualRates }),
    [mainCurrency, manualRates]
  )
  const splitDateRange = useMemo(
    () => ({
      start: now.subtract(11, 'month').startOf('month').format('YYYY-MM-DD'),
      end: now.format('YYYY-MM-DD'),
    }),
    [now]
  )
  const {
    splits: dashboardSplits,
    isLoading: splitsLoading,
    error: splitsFetchError,
    retry: retrySplits,
  } = useDashboardSplits(splitDateRange)

  useEffect(() => {
    void fetchAccounts().catch(() => {})
    void fetchTransactions().catch(() => {})
    void loadRates().catch(() => {})
  }, [fetchAccounts, fetchTransactions, loadRates])

  useEffect(() => {
    void fetchGoals().catch(() => {})
  }, [authorityKey, fetchGoals])

  useEffect(() => {
    let active = true
    void calculateCurrent()
      .then(() => {
        if (active) {
          setNetWorthCalculation({ authorityKey, accounts, investments, error: null })
        }
      })
      .catch((error) => {
        if (active) {
          setNetWorthCalculation({
            authorityKey,
            accounts,
            investments,
            error: getErrorMessage(error),
          })
        }
      })
    return () => {
      active = false
    }
  }, [accounts, authorityKey, calculateCurrent, investments])

  useEffect(() => {
    void loadHistory(historyPeriod).catch(() => {})
  }, [authorityKey, historyPeriod, loadHistory])

  const analytics = useMemo(
    () =>
      buildDashboardAnalytics({
        transactions,
        splits: dashboardSplits,
        preferredCurrency: mainCurrency,
        rates: manualRates,
        now,
      }),
    [transactions, dashboardSplits, mainCurrency, manualRates, now]
  )

  const currentMonth = analytics.trend.months.find((m) => m.isCurrent)
  const previousMonthKey = now.subtract(1, 'month').format('YYYY-MM')
  const previousMonth = analytics.trend.months.find((m) => m.key === previousMonthKey)
  const monthlyIncome = currentMonth?.income ?? 0
  const monthlyExpenses = currentMonth?.expenses ?? 0
  const previousIncome = previousMonth?.income ?? 0
  const previousExpenses = previousMonth?.expenses ?? 0
  const cashFlowDisplayable =
    !transactionsFetchError && analytics.cashFlowConversion.kind === 'complete'
  const cashFlowDisplayCurrency = analytics.cashFlowConversion.currency
  const cashFlowUnavailableLabel = cashFlowDisplayable
    ? undefined
    : transactionsFetchError
      ? t('currency.sourceUnavailable')
      : describeIncompleteConversion(analytics.cashFlowConversion, {
          mainRequired: t('currency.mainRequired'),
          invalidData: t('currency.invalidEvidence'),
          missingRates: (currencies) => t('currency.missingDatedRates', { currencies }),
          unavailable: t('currency.derivedUnavailable'),
        })

  const savingsRate = useMemo(() => {
    if (monthlyIncome <= 0) return 0
    return Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)
  }, [monthlyIncome, monthlyExpenses])

  const incomeDelta = monthlyIncome - previousIncome
  const expenseDelta = monthlyExpenses - previousExpenses
  const savedAmount = monthlyIncome - monthlyExpenses
  const monthStart = now.startOf('month').format('YYYY-MM-DD')
  const monthEnd = now.format('YYYY-MM-DD')
  const categoryTotal = analytics.categories.currentMonthBreakdown.reduce(
    (sum, item) => sum + item.amount,
    0
  )
  const categorySourceUnavailable =
    splitsLoading ||
    Boolean(splitsFetchError) ||
    Boolean(transactionsFetchError) ||
    analytics.categories.conversion.kind !== 'complete'
  const compactCashFlowMonths = analytics.trend.months.slice(-6)

  const recentTransactions = useMemo(() => transactions.slice(0, 8), [transactions])
  const dashboardErrors = [
    accountsFetchError ? t('errors.accounts', { message: accountsFetchError }) : null,
    transactionsFetchError && recentTransactions.length > 0
      ? t('errors.transactions', { message: transactionsFetchError })
      : null,
    goalsFetchError ? t('errors.goals', { message: goalsFetchError }) : null,
    splitsFetchError ? t('errors.splits', { message: splitsFetchError }) : null,
    currencyError ? t('errors.rates', { message: currencyError }) : null,
  ]

  const hasTransactionsLoadError = !!transactionsFetchError && recentTransactions.length === 0
  const isLoading = accountsLoading || txLoading
  const netWorthCalculationCurrent =
    netWorthCalculation.authorityKey === authorityKey &&
    netWorthCalculation.accounts === accounts &&
    netWorthCalculation.investments === investments
  const currentNetWorthComplete =
    netWorthCalculationCurrent &&
    mainCurrency !== null &&
    netWorthCurrency === mainCurrency &&
    !netWorthLoading &&
    !netWorthCalculation.error &&
    netWorthComplete &&
    netWorth !== null
  const historyDisplayable =
    historyComplete &&
    mainCurrency !== null &&
    historyAuthorityKey === authorityKey &&
    historyCurrency === mainCurrency &&
    historyRequestedPeriod === historyPeriod
  const displayableHistory = historyDisplayable ? history : []
  const lastHistoryDate = displayableHistory[displayableHistory.length - 1]?.date ?? null

  if (isLoading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="page-content">
      <ErrorBanner
        title={t('errors.title')}
        messages={dashboardErrors}
        onRetry={() => {
          retrySplits()
          void Promise.allSettled([fetchAccounts(), fetchTransactions(), fetchGoals(), loadRates()])
        }}
      />

      <OverviewNetWorth
        currentComplete={currentNetWorthComplete}
        currentAmount={currentNetWorthComplete ? netWorth : null}
        currentCurrency={netWorthCurrency}
        unavailableMessage={
          !mainCurrency
            ? t('currency.mainRequired')
            : ((netWorthCalculationCurrent ? netWorthCalculation.error : null) ??
              (!netWorthComplete
                ? describeIncompleteNetWorth(
                    [
                      netWorthMissingCurrencies.length > 0 &&
                        t('currency.missingRates', {
                          currencies: netWorthMissingCurrencies.join(', '),
                        }),
                      netWorthIncompleteHoldingIds.length > 0 &&
                        tAnalytics('netWorth.incompleteHoldings', {
                          count: netWorthIncompleteHoldingIds.length,
                        }),
                      netWorthUnresolvedAccountIds.length > 0 &&
                        tAnalytics('netWorth.unresolvedOwnership', {
                          count: netWorthUnresolvedAccountIds.length,
                        }),
                    ],
                    tAnalytics('netWorth.unavailable')
                  )
                : t('currency.recalculating')))
        }
        income={cashFlowDisplayable ? formatMoney(monthlyIncome, cashFlowDisplayCurrency) : '—'}
        incomeDetail={
          cashFlowDisplayable
            ? `${incomeDelta >= 0 ? '+' : '-'}${formatMoney(Math.abs(incomeDelta), cashFlowDisplayCurrency)} vs last month`
            : cashFlowUnavailableLabel
        }
        spent={cashFlowDisplayable ? formatMoney(monthlyExpenses, cashFlowDisplayCurrency) : '—'}
        spentDetail={
          cashFlowDisplayable
            ? `${expenseDelta >= 0 ? '+' : '-'}${formatMoney(Math.abs(expenseDelta), cashFlowDisplayCurrency)} vs last month`
            : cashFlowUnavailableLabel
        }
        saved={cashFlowDisplayable ? formatMoney(savedAmount, cashFlowDisplayCurrency) : '—'}
        savingsRate={cashFlowDisplayable ? `${savingsRate}%` : undefined}
        savedTone={!cashFlowDisplayable ? 'muted' : savedAmount >= 0 ? 'positive' : 'negative'}
        cashFlowLabel={t('overview.currentMonthCashFlowDated', {
          month: now.format('MMMM YYYY'),
        })}
        currentAsOfLabel={t('overview.currentValuationAsOf', {
          date: now.format('MMMM D, YYYY'),
        })}
        historyAsOfLabel={t('overview.historyValuationThrough', {
          date: dayjs(lastHistoryDate ?? now).format('MMMM D, YYYY'),
        })}
        history={displayableHistory}
        historyComplete={historyDisplayable}
        historyUnavailableMessage={
          !mainCurrency
            ? t('currency.mainRequired')
            : historyLoading
              ? t('currency.recalculating')
              : historyError
                ? historyError
                : historyMissingCurrencies.length > 0
                  ? t('currency.missingDatedRates', {
                      currencies: historyMissingCurrencies.join(', '),
                    })
                  : t('currency.historyUnavailable')
        }
        period={historyPeriod}
        onPeriodChange={setHistoryPeriod}
        historyCurrency={historyCurrency}
        emptyHistoryMessage={
          displayableHistory.length === 1
            ? tAnalytics('netWorth.firstSnapshot')
            : tAnalytics('netWorth.noHistory')
        }
        accounts={accounts}
        preferredCurrency={mainCurrency}
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <OverviewCategories
          items={categorySourceUnavailable ? [] : analytics.categories.currentMonthBreakdown}
          total={categorySourceUnavailable ? 0 : categoryTotal}
          displayCurrency={analytics.categories.conversion.currency}
          comparisonLabel={
            cashFlowDisplayable
              ? `${expenseDelta >= 0 ? '+' : '-'}${formatMoney(Math.abs(expenseDelta), cashFlowDisplayCurrency)} vs last month`
              : (cashFlowUnavailableLabel ?? t('currency.derivedUnavailable'))
          }
          dateFrom={monthStart}
          dateTo={monthEnd}
          unavailable={categorySourceUnavailable}
          unavailableMessage={
            splitsLoading
              ? t('analytics.loadingSplits')
              : splitsFetchError
                ? t('analytics.categoriesUnavailable')
                : transactionsFetchError
                  ? t('currency.sourceUnavailable')
                  : describeIncompleteConversion(analytics.categories.conversion, {
                      mainRequired: t('currency.mainRequired'),
                      invalidData: t('currency.invalidEvidence'),
                      missingRates: (currencies) => t('currency.missingDatedRates', { currencies }),
                      unavailable: t('currency.derivedUnavailable'),
                    })
          }
        />
        <OverviewCashFlow
          months={compactCashFlowMonths}
          displayCurrency={analytics.trend.conversion.currency}
          unavailable={
            Boolean(transactionsFetchError) || analytics.trend.conversion.kind !== 'complete'
          }
          unavailableMessage={
            transactionsFetchError
              ? t('currency.sourceUnavailable')
              : describeIncompleteConversion(analytics.trend.conversion, {
                  mainRequired: t('currency.mainRequired'),
                  invalidData: t('currency.invalidEvidence'),
                  missingRates: (currencies) => t('currency.missingDatedRates', { currencies }),
                  unavailable: t('currency.derivedUnavailable'),
                })
          }
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <NativePanel className="self-start p-4 sm:p-5">
          <SpendingAnalytics
            analytics={analytics}
            isLoading={txLoading || splitsLoading}
            dataError={transactionsFetchError}
            categoriesError={splitsFetchError}
          />
        </NativePanel>

        <NativePanel className="self-start p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t('recentActivity')}</h2>
            <Link
              to="/transactions"
              className="text-muted-foreground hover:text-foreground text-xs font-semibold"
            >
              {t('openActivity')}
            </Link>
          </div>
          {recentTransactions.length === 0 ? (
            hasTransactionsLoadError ? (
              <ErrorState
                title="Couldn’t load recent transactions"
                description={transactionsFetchError}
                className="py-8"
                onRetry={() => {
                  void fetchTransactions().catch(() => {})
                }}
              />
            ) : (
              <div className="flex h-72 flex-col items-center justify-center text-center">
                <p className="text-muted-foreground text-sm">{tTx('empty.description')}</p>
                <Button className="mt-3" size="sm" onClick={() => openTransactionDialog()}>
                  <Plus size={14} />
                  {tTx('addTransaction')}
                </Button>
              </div>
            )
          ) : (
            <div className="divide-border divide-y">
              {recentTransactions.map((tx) => (
                <RecentTransactionRow key={tx.id} transaction={tx} compact />
              ))}
            </div>
          )}
        </NativePanel>
      </div>

      {goals.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              <Target size={16} className="text-accent mr-2 inline" />
              {t('goals.title', { ns: 'goals', defaultValue: 'Savings Goals' })}
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/goals">
                {t('goals.viewAll', { ns: 'goals', defaultValue: 'View All' })}
                <ArrowRight size={14} />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {goals.slice(0, 3).map((goal) => {
              const progressColor =
                goal.progress >= 75
                  ? 'var(--color-success)'
                  : goal.progress >= 40
                    ? 'var(--color-warning)'
                    : 'var(--color-destructive)'
              return (
                <NativePanel key={goal.id} className="p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <GoalIcon icon={goal.icon} size={16} className="shrink-0" />
                    <h3 className="truncate text-sm font-semibold">{goal.name}</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative h-10 w-10 shrink-0">
                      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 40 40">
                        <circle
                          cx="20"
                          cy="20"
                          r="16"
                          fill="none"
                          stroke="var(--color-border)"
                          strokeWidth="4"
                        />
                        <circle
                          cx="20"
                          cy="20"
                          r="16"
                          fill="none"
                          stroke={progressColor}
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={`${(goal.progress / 100) * 100.53} 100.53`}
                        />
                      </svg>
                      <span
                        className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
                        style={{ color: progressColor }}
                      >
                        {goal.progress}%
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-sm font-medium">
                        {formatMoney(goal.current_amount, goal.currency)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('goals.of', { defaultValue: 'of' })}{' '}
                        {formatMoney(goal.target_amount, goal.currency)}
                      </p>
                    </div>
                  </div>
                </NativePanel>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="page-content">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-72 w-full" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

function RecentTransactionRow({
  transaction: tx,
  compact = false,
}: {
  transaction: TransactionWithDetails
  compact?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl', compact ? 'px-0 py-4' : 'px-4 py-3')}>
      {!compact &&
        (tx.category_color ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: tx.category_color }}
          />
        ) : (
          <span className="bg-muted-foreground/30 h-2.5 w-2.5 shrink-0 rounded-full" />
        ))}
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-bold', compact ? 'text-sm' : 'text-sm font-medium')}>
          {tx.description}
        </p>
        <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
          {tx.category_name && <span className="truncate">{tx.category_name}</span>}
          {tx.account_name && (
            <Badge variant="secondary" className="text-[10px]">
              {tx.account_name}
            </Badge>
          )}
        </div>
      </div>
      <div className="text-right">
        <span
          data-amount-type={tx.type}
          className={`font-heading text-sm font-semibold ${
            tx.type === 'income' ? 'text-success' : 'text-destructive'
          }`}
        >
          {tx.type === 'income' ? '+' : '-'}
          {formatMoney(tx.amount, tx.currency)}
        </span>
        <p className="text-muted-foreground font-mono text-[10px]">
          {dayjs(tx.date).format('MMM D')}
        </p>
      </div>
    </div>
  )
}
