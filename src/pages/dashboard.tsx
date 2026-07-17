import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { TrendingUp, TrendingDown, Target, Plus, ArrowRight } from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { useGoalStore } from '@/stores/goal-store'
import { useCurrencyStore } from '@/stores/currency-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney } from '@/lib/money'
import { buildDashboardAnalytics } from '@/lib/dashboard-analytics'
import { useDashboardSplits } from '@/components/dashboard/use-dashboard-splits'
import { SpendingAnalytics } from '@/components/dashboard/spending-analytics'

dayjs.extend(relativeTime)

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tTx } = useTranslation('transactions')
  const { openTransactionDialog } = useUIStore()
  const {
    accounts,
    isLoading: accountsLoading,
    fetchError: accountsFetchError,
    fetch: fetchAccounts,
  } = useAccountStore()
  const {
    transactions,
    isLoading: txLoading,
    fetchError: transactionsFetchError,
    fetch: fetchTransactions,
  } = useTransactionStore()
  const { goals, fetchError: goalsFetchError, fetch: fetchGoals } = useGoalStore()
  const {
    error: currencyError,
    preferredCurrency,
    rates,
    getTotalBalanceInPreferred,
    loadRates,
  } = useCurrencyStore()
  const now = useMemo(() => dayjs(), [])
  const splitDateRange = useMemo(
    () => ({
      start: now.subtract(11, 'month').startOf('month').format('YYYY-MM-DD'),
      end: now.format('YYYY-MM-DD'),
    }),
    [now]
  )
  const { splits: dashboardSplits, isLoading: splitsLoading } = useDashboardSplits(splitDateRange)

  useEffect(() => {
    void fetchAccounts().catch(() => {})
    void fetchTransactions().catch(() => {})
    void fetchGoals().catch(() => {})
    void loadRates().catch(() => {})
  }, [fetchAccounts, fetchTransactions, fetchGoals, loadRates])

  const totalBalanceResult = useMemo(
    () => getTotalBalanceInPreferred(accounts),
    [accounts, getTotalBalanceInPreferred]
  )
  const invalidCurrencyDetails =
    !totalBalanceResult.complete && totalBalanceResult.reason === 'invalid_currency_data'
      ? [
          ...(totalBalanceResult.invalidCurrencies ?? []).map((diagnostic) => {
            const owner =
              diagnostic.accountName ?? diagnostic.accountId ?? t('currency.preferredCurrency')
            const value = diagnostic.value || t('currency.blankValue')
            return `${owner} (${value})`
          }),
          ...(totalBalanceResult.invalidRates ?? []).map((diagnostic) =>
            t('currency.invalidRate', {
              from: diagnostic.fromCurrency || t('currency.blankValue'),
              to: diagnostic.toCurrency || t('currency.blankValue'),
              rate: diagnostic.rate || t('currency.blankValue'),
            })
          ),
        ].join(', ')
      : ''

  const ratesArray = useMemo(() => {
    const result: { fromCurrency: string; toCurrency: string; rate: number }[] = []
    for (const [pair, rate] of Object.entries(rates)) {
      const parts = pair.split(':')
      if (parts.length === 2 && Number.isFinite(rate) && rate > 0) {
        result.push({ fromCurrency: parts[0], toCurrency: parts[1], rate })
      }
    }
    return result
  }, [rates])

  const analytics = useMemo(
    () =>
      buildDashboardAnalytics({
        transactions,
        splits: dashboardSplits,
        preferredCurrency,
        rates: ratesArray,
        now,
      }),
    [transactions, dashboardSplits, preferredCurrency, ratesArray, now]
  )

  const currentMonth = analytics.trend.months.find((m) => m.isCurrent)
  const previousMonthKey = now.subtract(1, 'month').format('YYYY-MM')
  const previousMonth = analytics.trend.months.find((m) => m.key === previousMonthKey)
  const monthlyIncome = currentMonth?.income ?? 0
  const monthlyExpenses = currentMonth?.expenses ?? 0
  const previousIncome = previousMonth?.income ?? 0
  const previousExpenses = previousMonth?.expenses ?? 0
  const cashFlowDisplayable =
    analytics.conversion.kind === 'complete' || analytics.conversion.kind === 'fallback'
  const cashFlowDisplayCurrency = analytics.conversion.currency
  const cashFlowMissingCurrencies =
    analytics.conversion.kind === 'incomplete' ? analytics.conversion.missingCurrencies : []

  const savingsRate = useMemo(() => {
    if (monthlyIncome <= 0) return 0
    return Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)
  }, [monthlyIncome, monthlyExpenses])

  const incomeDelta = monthlyIncome - previousIncome
  const expenseDelta = monthlyExpenses - previousExpenses

  const recentTransactions = useMemo(() => transactions.slice(0, 8), [transactions])
  const dashboardErrors = [
    accountsFetchError ? `Accounts: ${accountsFetchError}` : null,
    transactionsFetchError && recentTransactions.length > 0
      ? `Transactions: ${transactionsFetchError}`
      : null,
    goalsFetchError ? `Goals: ${goalsFetchError}` : null,
    currencyError ? `Exchange rates: ${currencyError}` : null,
  ]

  const hasTransactionsLoadError = !!transactionsFetchError && recentTransactions.length === 0
  const isLoading = accountsLoading || txLoading

  if (isLoading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[28px]">
            Good evening
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Your money is calm, current, and completely local.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openTransactionDialog()}>
            <Plus size={16} />
            Add Transaction
          </Button>
        </div>
      </div>

      <ErrorBanner
        title="Some dashboard data couldn’t be loaded"
        messages={dashboardErrors}
        onRetry={() => {
          void Promise.allSettled([fetchAccounts(), fetchTransactions(), fetchGoals(), loadRates()])
        }}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,0.95fr)]">
        <div className="liquid-hero min-h-[284px] p-7 sm:p-8">
          <div className="flex h-full flex-col justify-between gap-12">
            <div>
              <p className="text-muted-foreground text-sm font-bold">Net Worth</p>
              {totalBalanceResult.complete ? (
                <p className="mt-10 font-mono text-4xl font-bold tracking-[-0.08em] sm:text-5xl md:text-[54px]">
                  {formatMoney(
                    totalBalanceResult.amountCentavos,
                    totalBalanceResult.preferredCurrency
                  )}
                </p>
              ) : (
                <div
                  className="border-warning/30 bg-warning/8 mt-8 max-w-xl rounded-xl border px-4 py-3"
                  role="alert"
                >
                  <p className="text-warning font-semibold">{t('currency.totalUnavailable')}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {totalBalanceResult.reason === 'invalid_currency_data'
                      ? t('currency.invalidData', { details: invalidCurrencyDetails })
                      : t('currency.missingRates', {
                          currencies: totalBalanceResult.missingCurrencies.join(', '),
                        })}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 text-sm font-bold sm:flex-row sm:items-center sm:justify-between">
              <span
                className={
                  cashFlowDisplayable
                    ? savingsRate >= 0
                      ? 'text-success'
                      : 'text-warning'
                    : 'text-warning'
                }
              >
                {cashFlowDisplayable ? (
                  <>
                    <span>{savingsRate}%</span> savings rate
                  </>
                ) : (
                  t('currency.derivedUnavailable')
                )}
              </span>
              <span className="text-muted-foreground text-xs font-semibold">Updated just now</span>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <MetricCard
            icon={<TrendingUp size={16} />}
            iconColor="text-success"
            label={t('cards.monthlyIncome')}
            value={cashFlowDisplayable ? formatMoney(monthlyIncome, cashFlowDisplayCurrency) : '—'}
            valueColor="text-success"
            subtitle={
              cashFlowDisplayable
                ? `${incomeDelta >= 0 ? '+' : '-'}${formatMoney(Math.abs(incomeDelta), cashFlowDisplayCurrency)} vs last month`
                : `${t('currency.derivedUnavailable')}: ${cashFlowMissingCurrencies.join(', ')}`
            }
          />
          <MetricCard
            icon={<TrendingDown size={16} />}
            iconColor="text-warning"
            label={t('cards.monthlyExpenses')}
            value={cashFlowDisplayable ? formatMoney(monthlyExpenses, cashFlowDisplayCurrency) : '—'}
            valueColor="text-warning"
            subtitle={
              cashFlowDisplayable
                ? `${expenseDelta >= 0 ? '+' : '-'}${formatMoney(Math.abs(expenseDelta), cashFlowDisplayCurrency)} vs last month`
                : `${t('currency.derivedUnavailable')}: ${cashFlowMissingCurrencies.join(', ')}`
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="liquid-card min-h-[572px] p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="font-heading text-[23px] font-bold tracking-tight">
              {t('analytics.spendingPace')}
            </h2>
            <Link
              to="/spending-insights"
              className="text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors"
            >
              {t('charts.drilldownTransactions')}
            </Link>
          </div>

          <SpendingAnalytics
            analytics={analytics}
            isLoading={txLoading || splitsLoading}
          />
        </div>

        <div className="liquid-card min-h-[572px] p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="font-heading text-[23px] font-bold tracking-tight">Recent activity</h2>
            <Link
              to="/transactions"
              className="text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors"
            >
              Open
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
            <div className="divide-y divide-white/[0.08]">
              {recentTransactions.map((tx) => (
                <RecentTransactionRow key={tx.id} transaction={tx} compact />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Goals preview */}
      {goals.length > 0 && (
        <div className="space-y-3">
          <div className="page-header">
            <h2 className="font-heading text-lg font-semibold">
              <Target size={16} className="text-primary mr-2 inline" />
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
                goal.progress >= 75 ? '#34D399' : goal.progress >= 40 ? '#F59E0B' : '#F87171'
              return (
                <div key={goal.id} className="liquid-card p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-base">{goal.icon || '🎯'}</span>
                    <h3 className="font-heading truncate text-sm font-semibold">{goal.name}</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative h-10 w-10 shrink-0">
                      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 40 40">
                        <circle
                          cx="20"
                          cy="20"
                          r="16"
                          fill="none"
                          stroke="rgba(255,255,255,0.08)"
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
                        className="font-heading absolute inset-0 flex items-center justify-center text-[10px] font-bold"
                        style={{ color: progressColor }}
                      >
                        {goal.progress}%
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-sm font-medium">
                        {formatMoney(goal.current_amount)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        of {formatMoney(goal.target_amount)}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  icon,
  iconColor,
  label,
  value,
  valueColor,
  subtitle,
}: {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
  valueColor?: string
  subtitle?: string
}) {
  return (
    <div className="metric-card p-5">
      <div className="text-muted-foreground mb-2 flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <span className="font-mono text-[10px] tracking-wider uppercase">{label}</span>
      </div>
      <p className={`font-heading text-2xl font-bold tracking-tight ${valueColor || ''}`}>
        {value}
      </p>
      {subtitle && <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">{subtitle}</p>}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="page-content">
      <Skeleton className="h-8 w-32" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="liquid-card space-y-3 p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="liquid-card p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-48 w-full" />
        </div>
        <div className="liquid-card p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-48 w-full" />
        </div>
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
    <div
      className={cn(
        'flex items-center gap-3 rounded-[22px] transition-colors hover:bg-white/[0.04]',
        compact ? 'px-0 py-4' : 'px-4 py-3'
      )}
    >
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
