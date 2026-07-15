import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { TrendingUp, TrendingDown, Target, Plus, ArrowRight } from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { isCashFlowEligible } from '@shikin/finance-core'
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
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import { formatMoney } from '@/lib/money'

dayjs.extend(relativeTime)

type SpendingGraphMode = 'trend' | 'categories' | 'movement'

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
  const { error: currencyError, getTotalBalanceInPreferred, loadRates } = useCurrencyStore()
  const { loadComparisons: loadInsights } = useSpendingInsightsStore()
  const [spendingGraphMode, setSpendingGraphMode] = useState<SpendingGraphMode>('trend')

  useEffect(() => {
    void fetchAccounts().catch(() => {})
    void fetchTransactions().catch(() => {})
    void fetchGoals().catch(() => {})
    void loadRates().catch(() => {})
  }, [fetchAccounts, fetchTransactions, fetchGoals, loadRates])

  // Load spending insights after transactions are loaded.
  useEffect(() => {
    if (transactions.length > 0 && !txLoading) {
      loadInsights()
    }
  }, [transactions.length, txLoading, loadInsights])

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

  const {
    monthlyIncome,
    monthlyExpenses,
    previousIncome,
    previousExpenses,
    spendingIntelligence,
    monthlySpendingGraph,
  } = useMemo(() => {
    const now = dayjs()
    const currentStart = now.startOf('month').format('YYYY-MM-DD')
    const currentEnd = now.format('YYYY-MM-DD')
    const previousMonth = now.subtract(1, 'month')
    const previousStart = previousMonth.startOf('month').format('YYYY-MM-DD')
    const previousEnd = previousMonth.endOf('month').format('YYYY-MM-DD')
    const graphMonths = Array.from({ length: 6 }, (_, index) => {
      const month = now.subtract(5 - index, 'month')
      return {
        key: month.format('YYYY-MM'),
        label: month.format('MMM'),
        start: month.startOf('month').format('YYYY-MM-DD'),
        end: month.endOf('month').format('YYYY-MM-DD'),
        amount: 0,
        isCurrent: month.isSame(now, 'month'),
      }
    })
    const graphMonthsByKey = new Map(graphMonths.map((month) => [month.key, month]))

    let currentIncome = 0
    let currentExpenses = 0
    let lastIncome = 0
    let lastExpenses = 0
    const current = new Map<string, { name: string; color: string; amount: number }>()
    const previous = new Map<string, { name: string; color: string; amount: number }>()

    for (const tx of transactions) {
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

      if (tx.date >= currentStart && tx.date <= currentEnd) {
        if (tx.type === 'income') currentIncome += tx.amount
        else if (tx.type === 'expense') currentExpenses += tx.amount
      } else if (tx.date >= previousStart && tx.date <= previousEnd) {
        if (tx.type === 'income') lastIncome += tx.amount
        else if (tx.type === 'expense') lastExpenses += tx.amount
      }

      if (tx.type !== 'expense') continue

      const graphMonth = graphMonthsByKey.get(tx.date.slice(0, 7))
      if (graphMonth && tx.date >= graphMonth.start && tx.date <= graphMonth.end) {
        graphMonth.amount += tx.amount
      }

      let target: typeof current | typeof previous | null = null
      if (tx.date >= currentStart && tx.date <= currentEnd) {
        target = current
      } else if (tx.date >= previousStart && tx.date <= previousEnd) {
        target = previous
      }

      if (!target) continue

      const key = tx.category_name || 'Uncategorized'
      const color = tx.category_color || '#7C5CFF'
      const existing = target.get(key)
      target.set(key, {
        name: key,
        color,
        amount: (existing?.amount ?? 0) + tx.amount,
      })
    }

    const names = new Set([...current.keys(), ...previous.keys()])
    const categories = [...names]
      .map((name) => {
        const currentAmount = current.get(name)?.amount ?? 0
        const previousAmount = previous.get(name)?.amount ?? 0
        const change = currentAmount - previousAmount
        const changePercent =
          previousAmount > 0
            ? Math.round((change / previousAmount) * 100)
            : currentAmount > 0
              ? 100
              : 0

        return {
          name,
          color: current.get(name)?.color ?? previous.get(name)?.color ?? '#7C5CFF',
          current: currentAmount,
          previous: previousAmount,
          change,
          changePercent,
        }
      })
      .sort((a, b) => b.current - a.current)

    const currentTotal = categories.reduce((sum, category) => sum + category.current, 0)
    const previousTotal = categories.reduce((sum, category) => sum + category.previous, 0)
    const totalChange = currentTotal - previousTotal
    const totalChangePercent =
      previousTotal > 0
        ? Math.round((totalChange / previousTotal) * 100)
        : currentTotal > 0
          ? 100
          : 0
    const maxCategorySpend = Math.max(1, ...categories.map((category) => category.current))
    const months = graphMonths.map((month) => ({
      key: month.key,
      label: month.label,
      amount: month.amount,
      isCurrent: month.isCurrent,
    }))
    const maxAmount = Math.max(1, ...months.map((month) => month.amount))

    return {
      monthlyIncome: currentIncome,
      monthlyExpenses: currentExpenses,
      previousIncome: lastIncome,
      previousExpenses: lastExpenses,
      spendingIntelligence: {
        categories,
        currentTotal,
        previousTotal,
        totalChange,
        totalChangePercent,
        maxCategorySpend,
      },
      monthlySpendingGraph: { months, maxAmount },
    }
  }, [transactions])

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
              <span className={savingsRate >= 0 ? 'text-success' : 'text-warning'}>
                <span>{savingsRate}%</span> savings rate
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
            value={formatMoney(monthlyIncome)}
            valueColor="text-success"
            subtitle={`${incomeDelta >= 0 ? '+' : '-'}${formatMoney(Math.abs(incomeDelta))} vs last month`}
          />
          <MetricCard
            icon={<TrendingDown size={16} />}
            iconColor="text-warning"
            label={t('cards.monthlyExpenses')}
            value={formatMoney(monthlyExpenses)}
            valueColor="text-warning"
            subtitle={`${expenseDelta >= 0 ? '+' : '-'}${formatMoney(Math.abs(expenseDelta))} vs last month`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="liquid-card min-h-[572px] p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="font-heading text-[23px] font-bold tracking-tight">
              Spending intelligence
            </h2>
            <Link
              to="/spending-insights"
              className="text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors"
            >
              Insights
            </Link>
          </div>
          <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.035] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs font-bold tracking-[0.14em] uppercase">
                Spending graph
              </p>
              <div className="flex rounded-full border border-white/[0.08] bg-black/20 p-1">
                {(
                  [
                    ['trend', 'Trend'],
                    ['categories', 'Categories'],
                    ['movement', 'Movement'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSpendingGraphMode(mode)}
                    className={cn(
                      'rounded-full px-2.5 py-1 font-mono text-[10px] font-bold transition-colors',
                      spendingGraphMode === mode
                        ? 'bg-accent-hover text-white'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {spendingGraphMode === 'trend' && (
              <div className="flex min-h-[360px] items-end justify-between gap-3 rounded-2xl border border-white/[0.04] bg-black/10 px-3 py-4">
                {monthlySpendingGraph.months.map((month) => {
                  const height = Math.max(
                    month.amount > 0 ? 26 : 8,
                    Math.round((month.amount / monthlySpendingGraph.maxAmount) * 290)
                  )
                  return (
                    <div key={month.key} className="flex flex-1 flex-col items-center gap-3">
                      <div className="flex h-[300px] w-full items-end justify-center">
                        <div
                          className={cn(
                            'w-full max-w-[48px] rounded-t-2xl rounded-b-md transition-all',
                            month.isCurrent ? 'bg-accent-hover' : 'bg-white/[0.14]'
                          )}
                          style={{ height }}
                          title={`${month.label}: ${formatMoney(month.amount)}`}
                        />
                      </div>
                      <div className="text-center">
                        <p className="text-muted-foreground font-mono text-[10px] font-bold uppercase">
                          {month.label}
                        </p>
                        <p className="font-mono text-[10px] font-bold">
                          {formatMoney(month.amount)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {spendingGraphMode === 'categories' &&
              (spendingIntelligence.categories.some((category) => category.current > 0) ? (
                <div className="min-h-[360px] space-y-3 rounded-2xl border border-white/[0.04] bg-black/10 p-4">
                  {spendingIntelligence.categories
                    .filter((category) => category.current > 0)
                    .slice(0, 6)
                    .map((category) => (
                      <div key={category.name}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: category.color }}
                            />
                            <span className="truncate font-semibold">{category.name}</span>
                          </div>
                          <span className="font-mono text-xs font-bold">
                            {formatMoney(category.current)}
                          </span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(5, Math.round((category.current / spendingIntelligence.maxCategorySpend) * 100))}%`,
                              backgroundColor: category.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <SpendingGraphEmpty />
              ))}

            {spendingGraphMode === 'movement' &&
              (spendingIntelligence.categories.some((category) => category.current > 0) ? (
                <div className="min-h-[360px] space-y-3 rounded-2xl border border-white/[0.04] bg-black/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs font-bold tracking-[0.14em] uppercase">
                      Month over month
                    </span>
                    <span
                      className={cn(
                        'font-mono text-xs font-bold',
                        spendingIntelligence.totalChange <= 0 ? 'text-success' : 'text-warning'
                      )}
                    >
                      {spendingIntelligence.totalChangePercent >= 0 ? '+' : ''}
                      {spendingIntelligence.totalChangePercent}%
                    </span>
                  </div>
                  {spendingIntelligence.categories.slice(0, 6).map((category) => (
                    <div key={category.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-semibold">{category.name}</span>
                          <span
                            className={cn(
                              'font-mono font-bold',
                              category.change <= 0 ? 'text-success' : 'text-warning'
                            )}
                          >
                            {category.change >= 0 ? '+' : '-'}
                            {formatMoney(Math.abs(category.change))}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-white/[0.2]"
                              style={{
                                width: `${Math.max(4, Math.round((category.previous / spendingIntelligence.maxCategorySpend) * 100))}%`,
                              }}
                            />
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(4, Math.round((category.current / spendingIntelligence.maxCategorySpend) * 100))}%`,
                                backgroundColor: category.color,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="text-muted-foreground flex justify-end gap-4 font-mono text-[10px] font-bold uppercase">
                    <span>Previous</span>
                    <span>Current</span>
                  </div>
                </div>
              ) : (
                <SpendingGraphEmpty />
              ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs font-bold">Projected runway</p>
              <p className="mt-2 font-mono text-2xl font-bold tracking-[-0.04em]">
                {totalBalanceResult.complete
                  ? monthlyExpenses > 0
                    ? `${Math.max(0, totalBalanceResult.amountCentavos / monthlyExpenses).toFixed(1)} months`
                    : 'Stable'
                  : t('currency.derivedUnavailable')}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-bold">Safe to spend</p>
              <p className="text-success mt-2 font-mono text-2xl font-bold tracking-[-0.04em]">
                {formatMoney(Math.max(0, monthlyIncome - monthlyExpenses))}
              </p>
            </div>
          </div>
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

function SpendingGraphEmpty() {
  return (
    <div className="flex min-h-[278px] items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-black/10 text-center">
      <p className="text-muted-foreground max-w-sm text-sm">
        Add a few categorized expenses and this graph will show what is driving your month.
      </p>
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
