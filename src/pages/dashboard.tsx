import { useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Target,
  Plus,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  Copy,
  Zap,
  Receipt,
  DollarSign,
  X,
  ShieldAlert,
  Heart,
  RefreshCw,
  FileText,
} from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { AreaChart, Area, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { useAnomalyStore } from '@/stores/anomaly-store'
import { useForecastStore } from '@/stores/forecast-store'
import { useGoalStore } from '@/stores/goal-store'
import { useRecapStore } from '@/stores/recap-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useAchievementStore } from '@/stores/achievement-store'
import { ACHIEVEMENTS } from '@/lib/achievement-service'
import { CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE } from '@/lib/constants'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import type { AnomalyType, AnomalySeverity } from '@/lib/anomaly-service'
import { useHealthStore } from '@/stores/health-store'
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import type { SubScore } from '@/lib/health-score-service'
import { formatMoney, fromCentavos } from '@/lib/money'

dayjs.extend(relativeTime)

const CHART_COLORS = [
  '#7C5CFF',
  '#34D399',
  '#5AC8FA',
  '#F59E0B',
  '#F87171',
  '#BFA4FF',
  '#06B6D4',
  '#8B5CF6',
]

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tTx } = useTranslation('transactions')
  const { t: tAcc } = useTranslation('accounts')
  const { openAccountDialog, openTransactionDialog } = useUIStore()
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
  const {
    isLoading: anomalyLoading,
    scanForAnomalies,
    getActiveAnomalies,
    dismissAnomaly,
  } = useAnomalyStore()
  const { goals, fetchError: goalsFetchError, fetch: fetchGoals } = useGoalStore()
  const {
    score: healthScore,
    isLoading: healthLoading,
    error: healthError,
    calculateScore,
  } = useHealthStore()
  const {
    currentRecap,
    isLoading: recapLoading,
    generateWeekly,
    loadLatestWeekly,
  } = useRecapStore()
  const {
    preferredCurrency,
    error: currencyError,
    getTotalBalanceInPreferred,
    loadRates,
  } = useCurrencyStore()
  const {
    currentStreak,
    longestStreak,
    newlyUnlocked,
    checkForNew: checkAchievements,
    dismissNew,
  } = useAchievementStore()
  const { insights: spendingInsights, loadComparisons: loadInsights } = useSpendingInsightsStore()

  useEffect(() => {
    void fetchAccounts().catch(() => {})
    void fetchTransactions().catch(() => {})
    void fetchGoals().catch(() => {})
    void loadLatestWeekly()
    void loadRates().catch(() => {})
  }, [fetchAccounts, fetchTransactions, fetchGoals, loadLatestWeekly, loadRates])

  // Run anomaly scan and load spending insights after transactions are loaded
  useEffect(() => {
    if (transactions.length > 0 && !txLoading) {
      scanForAnomalies()
      loadInsights()
    }
  }, [transactions.length, txLoading, scanForAnomalies, loadInsights])

  const activeAnomalies = getActiveAnomalies()

  // Calculate health score after data loads
  useEffect(() => {
    if (!accountsLoading && !txLoading && accounts.length > 0) {
      void calculateScore()
    }
  }, [accountsLoading, txLoading, accounts.length, calculateScore])

  const handleGenerateRecap = useCallback(() => {
    generateWeekly()
  }, [generateWeekly])

  // Check achievements after transactions load
  useEffect(() => {
    if (!txLoading && transactions.length >= 0) {
      checkAchievements()
    }
  }, [txLoading, transactions.length, checkAchievements])

  const totalBalance = useMemo(() => accounts.reduce((sum, a) => sum + a.balance, 0), [accounts])

  // Check if accounts have mixed currencies
  const hasMixedCurrencies = useMemo(() => {
    const currencies = new Set(accounts.map((a) => a.currency))
    return currencies.size > 1
  }, [accounts])

  // Converted total balance in preferred currency
  const convertedTotalBalance = useMemo(() => {
    if (!hasMixedCurrencies) return totalBalance
    return getTotalBalanceInPreferred(accounts)
  }, [hasMixedCurrencies, totalBalance, accounts, getTotalBalanceInPreferred])

  const { monthlyIncome, monthlyExpenses } = useMemo(() => {
    const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD')
    const today = dayjs().format('YYYY-MM-DD')
    let income = 0
    let expenses = 0
    for (const tx of transactions) {
      if (tx.date >= startOfMonth && tx.date <= today) {
        if (tx.type === 'income') income += tx.amount
        else if (tx.type === 'expense') expenses += tx.amount
      }
    }
    return { monthlyIncome: income, monthlyExpenses: expenses }
  }, [transactions])

  const { previousIncome, previousExpenses } = useMemo(() => {
    const start = dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
    const end = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')
    let income = 0
    let expenses = 0
    for (const tx of transactions) {
      if (tx.date >= start && tx.date <= end) {
        if (tx.type === 'income') income += tx.amount
        else if (tx.type === 'expense') expenses += tx.amount
      }
    }
    return { previousIncome: income, previousExpenses: expenses }
  }, [transactions])

  const savingsRate = useMemo(() => {
    if (monthlyIncome <= 0) return 0
    return Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)
  }, [monthlyIncome, monthlyExpenses])

  const incomeDelta = monthlyIncome - previousIncome
  const expenseDelta = monthlyExpenses - previousExpenses

  const recentTransactions = useMemo(() => transactions.slice(0, 8), [transactions])
  const dashboardErrors = [
    accountsFetchError && accounts.length > 0 ? `Accounts: ${accountsFetchError}` : null,
    transactionsFetchError && recentTransactions.length > 0
      ? `Transactions: ${transactionsFetchError}`
      : null,
    goalsFetchError ? `Goals: ${goalsFetchError}` : null,
    currencyError ? `Exchange rates: ${currencyError}` : null,
    healthError ? `Financial health: ${healthError}` : null,
  ]

  // Monthly spending chart data (last 6 months)
  const monthlyChartData = useMemo(() => {
    const months: { month: string; expenses: number; income: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const m = dayjs().subtract(i, 'month')
      const start = m.startOf('month').format('YYYY-MM-DD')
      const end = m.endOf('month').format('YYYY-MM-DD')
      let expenses = 0
      let income = 0
      for (const tx of transactions) {
        if (tx.date >= start && tx.date <= end) {
          if (tx.type === 'expense') expenses += tx.amount
          else if (tx.type === 'income') income += tx.amount
        }
      }
      months.push({ month: m.format('MMM'), expenses, income })
    }
    return months
  }, [transactions])

  // Category breakdown (this month)
  const categoryData = useMemo(() => {
    const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD')
    const today = dayjs().format('YYYY-MM-DD')
    const cats = new Map<string, { name: string; value: number; color: string }>()
    for (const tx of transactions) {
      if (
        tx.type === 'expense' &&
        tx.date >= startOfMonth &&
        tx.date <= today &&
        tx.category_name
      ) {
        const existing = cats.get(tx.category_name)
        if (existing) {
          existing.value += tx.amount
        } else {
          cats.set(tx.category_name, {
            name: tx.category_name,
            value: tx.amount,
            color: tx.category_color || '#888',
          })
        }
      }
    }
    return Array.from(cats.values()).sort((a, b) => b.value - a.value)
  }, [transactions])

  // Income breakdown (this month) by category
  const incomeData = useMemo(() => {
    const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD')
    const today = dayjs().format('YYYY-MM-DD')
    const cats = new Map<string, { name: string; value: number; color: string }>()
    for (const tx of transactions) {
      if (tx.type === 'income' && tx.date >= startOfMonth && tx.date <= today) {
        const catName = tx.category_name || 'Other Income'
        const existing = cats.get(catName)
        if (existing) {
          existing.value += tx.amount
        } else {
          cats.set(catName, {
            name: catName,
            value: tx.amount,
            color: tx.category_color || '#34D399',
          })
        }
      }
    }
    return Array.from(cats.values()).sort((a, b) => b.value - a.value)
  }, [transactions])

  const hasAccounts = accounts.length > 0
  const hasAccountsLoadError = !!accountsFetchError && !hasAccounts
  const hasTransactionsLoadError = !!transactionsFetchError && recentTransactions.length === 0
  const isLoading = accountsLoading || txLoading

  if (isLoading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header p-5">
        <div>
          <p className="text-muted-foreground font-mono text-[10px] tracking-[0.3em] uppercase">
            Local-first finance
          </p>
          <h1 className="font-heading mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {t('title')}
          </h1>
        </div>
        {currentStreak > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1"
            style={{
              background: 'rgba(124, 92, 255, 0.16)',
              border: '1px solid rgba(191, 164, 255, 0.32)',
            }}
            title={t('streak.longest', { count: longestStreak })}
          >
            <span className="text-sm">{'\uD83D\uDD25'}</span>
            <span className="font-heading text-accent-hover text-sm font-bold">
              {currentStreak}
            </span>
            <span className="text-muted-foreground text-xs">{t('streak.label')}</span>
          </div>
        )}
      </div>

      <ErrorBanner
        title="Some dashboard data couldn’t be loaded"
        messages={dashboardErrors}
        onRetry={() => {
          void Promise.allSettled([fetchAccounts(), fetchTransactions(), fetchGoals(), loadRates()])
        }}
      />

      {/* Achievement unlock notifications */}
      {newlyUnlocked.length > 0 && (
        <div className="space-y-2">
          {newlyUnlocked.map((a) => {
            const def = ACHIEVEMENTS[a.id]
            return (
              <div
                key={a.id}
                className="liquid-card animate-fade-in-up flex items-center gap-3 px-4 py-3"
                style={{
                  background: 'rgba(124, 92, 255, 0.1)',
                  border: '1px solid rgba(191, 164, 255, 0.2)',
                }}
              >
                <span className="text-xl">{def.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-sm font-semibold">{t(`achievements.${a.id}`)}</p>
                  <p className="text-muted-foreground text-xs">{t(`achievements.${a.id}_desc`)}</p>
                </div>
                <Badge
                  variant="secondary"
                  className="shrink-0 text-[10px]"
                  style={{ color: '#BFA4FF' }}
                >
                  {t('achievements.unlocked')}
                </Badge>
                <button
                  onClick={() => dismissNew(a.id)}
                  className="text-muted-foreground hover:text-foreground shrink-0 p-1"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 4-column metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<Wallet size={16} />}
          iconColor="text-primary"
          label={hasMixedCurrencies ? t('cards.totalBalanceConverted') : t('cards.totalBalance')}
          value={
            hasMixedCurrencies
              ? formatMoney(convertedTotalBalance, preferredCurrency)
              : formatMoney(totalBalance)
          }
          subtitle={hasMixedCurrencies ? preferredCurrency : undefined}
        />
        <MetricCard
          icon={<TrendingUp size={16} />}
          iconColor="text-success"
          label={t('cards.monthlyIncome')}
          value={formatMoney(monthlyIncome)}
          valueColor="text-success"
        />
        <MetricCard
          icon={<TrendingDown size={16} />}
          iconColor="text-destructive"
          label={t('cards.monthlyExpenses')}
          value={formatMoney(monthlyExpenses)}
          valueColor="text-destructive"
        />
        <MetricCard
          icon={<PiggyBank size={16} />}
          iconColor="text-primary"
          label={t('cards.savings')}
          value={`${savingsRate}%`}
          valueColor={savingsRate >= 0 ? 'text-primary' : 'text-destructive'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="liquid-card px-5 py-4">
          <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            {t('cards.incomeVsLastMonth')}
          </p>
          <p
            className={`font-heading mt-1 text-lg font-semibold ${incomeDelta >= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {incomeDelta >= 0 ? '+' : '-'}
            {formatMoney(Math.abs(incomeDelta))}
          </p>
        </div>
        <div className="liquid-card px-5 py-4">
          <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            {t('cards.expensesVsLastMonth')}
          </p>
          <p
            className={`font-heading mt-1 text-lg font-semibold ${expenseDelta <= 0 ? 'text-success' : 'text-destructive'}`}
          >
            {expenseDelta >= 0 ? '+' : '-'}
            {formatMoney(Math.abs(expenseDelta))}
          </p>
        </div>
      </div>

      {!hasAccounts ? (
        hasAccountsLoadError ? (
          <ErrorState
            title="Couldn’t load your dashboard accounts"
            description={accountsFetchError}
            onRetry={() => {
              void fetchAccounts().catch(() => {})
            }}
          />
        ) : (
          <div className="liquid-card flex flex-col items-center justify-center py-16 text-center">
            <div className="bg-accent-muted mb-4 flex h-16 w-16 items-center justify-center rounded-3xl">
              <Wallet size={32} className="text-primary" />
            </div>
            <h2 className="font-heading mb-2 text-xl font-semibold">{t('empty.title')}</h2>
            <p className="text-muted-foreground mb-6 max-w-md text-sm">{t('empty.description')}</p>
            <div className="flex gap-3">
              <Button onClick={() => openAccountDialog()}>{t('empty.addAccount')}</Button>
            </div>
          </div>
        )
      ) : (
        <>
          {/* Charts row */}
          {transactions.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Spending area chart */}
              <div className="liquid-card p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="font-heading text-lg font-semibold">{t('charts.spending')}</h3>
                  <Link
                    to="/transactions"
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    {t('charts.drilldownTransactions')}
                  </Link>
                </div>
                <div className="h-48">
                  <SafeChart>
                    <AreaChart data={monthlyChartData}>
                      <defs>
                        <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F87171" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#F87171" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34D399" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#34D399" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="month"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#A9A9B4', fontSize: 11 }}
                      />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        itemStyle={CHART_ITEM_STYLE}
                        labelStyle={CHART_LABEL_STYLE}
                      />
                      <Area
                        type="monotone"
                        dataKey="income"
                        stroke="#34D399"
                        strokeWidth={2}
                        fill="url(#incomeGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="expenses"
                        stroke="#F87171"
                        strokeWidth={2}
                        fill="url(#expenseGrad)"
                      />
                    </AreaChart>
                  </SafeChart>
                </div>
              </div>

              {/* Category donut */}
              <div className="liquid-card p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="font-heading text-lg font-semibold">{t('charts.categories')}</h3>
                  <Link
                    to="/budgets"
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    {t('charts.drilldownBudgets')}
                  </Link>
                </div>
                {categoryData.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <div className="h-48 w-48 shrink-0">
                      <SafeChart>
                        <PieChart>
                          <Pie
                            data={categoryData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={75}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {categoryData.map((entry, i) => (
                              <Cell
                                key={entry.name}
                                fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={CHART_TOOLTIP_STYLE}
                            formatter={(value) => formatMoney(value as number)}
                          />
                        </PieChart>
                      </SafeChart>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
                      {categoryData.slice(0, 5).map((cat, i) => (
                        <div key={cat.name} className="flex items-center gap-2 text-xs">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: cat.color || CHART_COLORS[i % CHART_COLORS.length],
                            }}
                          />
                          <span className="truncate">{cat.name}</span>
                          <span className="text-muted-foreground ml-auto shrink-0">
                            {formatMoney(cat.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center">
                    <p className="text-muted-foreground text-xs">No expenses this month</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Income Sources */}
          {incomeData.length > 0 && (
            <div className="liquid-card p-6">
              <h3 className="font-heading mb-4 text-lg font-semibold">
                {t('charts.incomeSources', 'Income Sources')}
              </h3>
              <div className="flex items-center gap-4">
                <div className="h-40 w-40 shrink-0">
                  <SafeChart>
                    <PieChart>
                      <Pie
                        data={incomeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={65}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {incomeData.map((entry, i) => (
                          <Cell
                            key={entry.name}
                            fill={entry.color || CHART_COLORS[i % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value) => formatMoney(value as number)}
                      />
                    </PieChart>
                  </SafeChart>
                </div>
                <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
                  {incomeData.map((inc, i) => {
                    const total = incomeData.reduce((s, d) => s + d.value, 0)
                    const percent = total > 0 ? Math.round((inc.value / total) * 100) : 0
                    return (
                      <div key={inc.name} className="flex items-center gap-2 text-xs">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: inc.color || CHART_COLORS[i % CHART_COLORS.length],
                          }}
                        />
                        <span className="truncate">{inc.name}</span>
                        <span className="text-muted-foreground ml-auto shrink-0">
                          {formatMoney(inc.value)}
                          <span className="text-muted-foreground ml-1 text-[10px]">
                            ({percent}%)
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Alerts section */}
          <AlertsSection
            anomalies={activeAnomalies}
            isLoading={anomalyLoading}
            onDismiss={dismissAnomaly}
            t={t}
          />

          {/* Spending Insights */}
          {spendingInsights.length > 0 && (
            <div className="liquid-card p-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={16} className="text-accent" />
                  <h3 className="font-heading text-lg font-semibold">
                    {t('insights.title', 'Spending Insights')}
                  </h3>
                </div>
                <Link
                  to="/spending-insights"
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  {t('insights.viewAll', 'View all')} <ArrowRight size={12} className="inline" />
                </Link>
              </div>
              <div className="space-y-2">
                {spendingInsights.slice(0, 3).map((insight) => (
                  <div
                    key={insight.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2',
                      insight.severity === 'alert' && 'bg-destructive/5',
                      insight.severity === 'warning' && 'bg-warning/5',
                      insight.severity === 'info' && 'bg-accent/5'
                    )}
                  >
                    <div
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: insight.categoryColor }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{insight.message}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 font-mono text-[10px]',
                        insight.type === 'increase'
                          ? 'border-destructive/30 text-destructive'
                          : 'border-success/30 text-success'
                      )}
                    >
                      {insight.type === 'decrease' ? '-' : '+'}$
                      {Math.abs(insight.amount).toFixed(0)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cash Flow Forecast Widget */}
          {transactions.length > 0 && <ForecastWidget />}

          {/* Financial Health Score */}
          {(healthScore || healthLoading) && (
            <HealthScoreWidget score={healthScore} isLoading={healthLoading} />
          )}

          {/* Weekly Recap */}
          <div className="liquid-card p-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-primary" />
                <h3 className="font-heading text-lg font-semibold">{t('recap.title')}</h3>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateRecap}
                disabled={recapLoading}
              >
                <RefreshCw size={14} className={recapLoading ? 'animate-spin' : ''} />
                {recapLoading ? t('recap.generating') : t('recap.generate')}
              </Button>
            </div>

            {currentRecap ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {currentRecap.summary}
                </p>
                <div className="flex flex-wrap gap-2">
                  {currentRecap.highlights.map((h) => (
                    <span
                      key={h.label}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs"
                    >
                      <span className="text-muted-foreground">{h.label}:</span>
                      <span className="font-semibold">{h.value}</span>
                      {h.change && (
                        <span
                          className={`font-mono text-[10px] ${
                            h.change.startsWith('+') ? 'text-destructive' : 'text-success'
                          }`}
                        >
                          {h.change}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  {t('recap.generatedAt', { time: dayjs(currentRecap.generated_at).fromNow() })}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <p className="text-muted-foreground text-sm">{t('recap.noRecap')}</p>
                <p className="text-muted-foreground mt-1 text-xs">{t('recap.noRecapHint')}</p>
              </div>
            )}
          </div>

          {/* Accounts preview */}
          <div className="space-y-3">
            <div className="page-header">
              <h2 className="font-heading text-lg font-semibold">{tAcc('title')}</h2>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/accounts">
                  {tTx('viewAll')}
                  <ArrowRight size={14} />
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.slice(0, 3).map((account) => (
                <div key={account.id} className="liquid-card p-5">
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="font-heading text-sm font-semibold">{account.name}</h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {tAcc(`types.${account.type}`)}
                    </Badge>
                  </div>
                  <p className="font-heading text-xl font-bold tracking-tight">
                    {formatMoney(account.balance, account.currency)}
                  </p>
                  <p className="text-muted-foreground mt-1 font-mono text-[10px]">
                    {account.currency}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent transactions */}
          <div className="space-y-3">
            <div className="page-header">
              <h2 className="font-heading text-lg font-semibold">{tTx('recentTransactions')}</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openTransactionDialog()}>
                  <Plus size={14} />
                  {tTx('addQuick')}
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/transactions">
                    {tTx('viewAll')}
                    <ArrowRight size={14} />
                  </Link>
                </Button>
              </div>
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
                <div className="liquid-card flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-muted-foreground text-sm">{tTx('empty.description')}</p>
                  <Button className="mt-3" size="sm" onClick={() => openTransactionDialog()}>
                    <Plus size={14} />
                    {tTx('addTransaction')}
                  </Button>
                </div>
              )
            ) : (
              <div className="liquid-card divide-y divide-white/[0.08] overflow-hidden p-1">
                {recentTransactions.map((tx) => (
                  <RecentTransactionRow key={tx.id} transaction={tx} />
                ))}
              </div>
            )}
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

          {/* Quick actions */}
          <div className="flex gap-3">
            <Button onClick={() => openTransactionDialog()}>
              <Plus size={16} />
              {t('quickActions.addTransaction')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function ForecastWidget() {
  const { t } = useTranslation('dashboard')
  const { forecast, isLoading, selectedRange, setRange, generateForecast } = useForecastStore()

  useEffect(() => {
    generateForecast()
  }, [generateForecast])

  const chartData = useMemo(() => {
    if (!forecast) return []
    return forecast.points
      .filter(
        (_, i) =>
          i % Math.max(1, Math.floor(forecast.points.length / 30)) === 0 ||
          i === forecast.points.length - 1
      )
      .map((p) => ({
        date: dayjs(p.date).format('MMM D'),
        projected: fromCentavos(p.projected),
        optimistic: fromCentavos(p.optimistic),
        pessimistic: fromCentavos(p.pessimistic),
      }))
  }, [forecast])

  const ranges = [30, 60, 90] as const

  if (isLoading && !forecast) {
    return (
      <div className="liquid-card p-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-48 w-full" />
      </div>
    )
  }

  if (!forecast) return null

  const firstDangerDate = forecast.dangerDates[0]

  return (
    <div className="liquid-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-lg font-semibold">{t('forecast.title')}</h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {ranges.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  selectedRange === r
                    ? 'text-accent-hover bg-white/[0.1]'
                    : 'text-muted-foreground hover:text-foreground bg-white/[0.05] hover:bg-white/[0.1]'
                }`}
              >
                {t(`forecast.range${r}` as 'forecast.range30')}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/forecast">
              {t('forecast.viewFull')}
              <ArrowRight size={14} />
            </Link>
          </Button>
        </div>
      </div>

      {firstDangerDate && (
        <div className="bg-destructive/10 border-destructive/20 mb-3 flex items-center gap-2 rounded-2xl border px-3 py-2">
          <AlertTriangle size={14} className="text-destructive shrink-0" />
          <p className="text-destructive text-xs">
            {t('forecast.dangerWarning', {
              threshold: formatMoney(0),
              date: dayjs(firstDangerDate).format('MMM D'),
            })}
          </p>
        </div>
      )}

      <div className="h-48">
        <SafeChart>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7C5CFF" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#7C5CFF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#A9A9B4', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis hide />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              itemStyle={CHART_ITEM_STYLE}
              labelStyle={CHART_LABEL_STYLE}
              formatter={(value) =>
                `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            />
            <Area
              type="monotone"
              dataKey="optimistic"
              name={t('forecast.optimistic')}
              stroke="#34D399"
              strokeWidth={1}
              strokeDasharray="6 3"
              fill="none"
            />
            <Area
              type="monotone"
              dataKey="projected"
              name={t('forecast.projected')}
              stroke="#7C5CFF"
              strokeWidth={2}
              fill="url(#forecastGrad)"
            />
            <Area
              type="monotone"
              dataKey="pessimistic"
              name={t('forecast.pessimistic')}
              stroke="#F87171"
              strokeWidth={1}
              strokeDasharray="6 3"
              fill="none"
            />
          </AreaChart>
        </SafeChart>
      </div>
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

const ANOMALY_ICONS: Record<AnomalyType, React.ReactNode> = {
  unusual_amount: <AlertTriangle size={14} />,
  duplicate_charge: <Copy size={14} />,
  spending_spike: <Zap size={14} />,
  subscription_price_change: <Receipt size={14} />,
  large_transaction: <DollarSign size={14} />,
}

const SEVERITY_STYLES: Record<
  AnomalySeverity,
  { border: string; bg: string; text: string; badge: string }
> = {
  high: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    badge: 'bg-red-500/20 text-red-400',
  },
  medium: {
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    badge: 'bg-yellow-500/20 text-yellow-400',
  },
  low: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    badge: 'bg-blue-500/20 text-blue-400',
  },
}

function AlertsSection({
  anomalies,
  isLoading,
  onDismiss,
  t,
}: {
  anomalies: Array<{
    id: string
    type: AnomalyType
    severity: AnomalySeverity
    title: string
    description: string
    amount?: number
  }>
  isLoading: boolean
  onDismiss: (id: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: any) => string
}) {
  if (isLoading) {
    return (
      <div className="liquid-card flex items-center gap-3 p-4">
        <ShieldAlert size={16} className="text-primary animate-pulse" />
        <span className="text-muted-foreground text-sm">{t('alerts.scanning')}</span>
      </div>
    )
  }

  if (anomalies.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="page-header">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-lg font-semibold">{t('alerts.title')}</h2>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/20 px-1.5 font-mono text-[10px] font-bold text-red-400">
            {anomalies.length}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        {anomalies.map((anomaly) => {
          const styles = SEVERITY_STYLES[anomaly.severity]
          return (
            <div
              key={anomaly.id}
              className={`liquid-card flex items-start gap-3 border px-4 py-3 ${styles.border}`}
            >
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${styles.bg} ${styles.text}`}
              >
                {ANOMALY_ICONS[anomaly.type]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{anomaly.title}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.badge}`}
                  >
                    {t(`alerts.severity.${anomaly.severity}`)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {anomaly.description}
                </p>
              </div>
              <button
                onClick={() => onDismiss(anomaly.id)}
                className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0 rounded-xl p-1 transition-colors hover:bg-white/[0.08]"
                title={t('alerts.dismiss')}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HealthScoreGauge({ score, grade }: { score: number; grade: string }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference

  const getColor = (s: number) => {
    if (s >= 80) return '#34D399'
    if (s >= 60) return '#F59E0B'
    if (s >= 40) return '#FB923C'
    return '#F87171'
  }

  const color = getColor(score)

  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
        {/* Background ring */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="8"
        />
        {/* Score ring */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-heading text-3xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="font-mono text-xs font-semibold tracking-wider" style={{ color }}>
          {grade}
        </span>
      </div>
    </div>
  )
}

function SubScoreBar({ subscore }: { subscore: SubScore }) {
  const getColor = (s: number) => {
    if (s >= 80) return '#34D399'
    if (s >= 60) return '#F59E0B'
    if (s >= 40) return '#FB923C'
    return '#F87171'
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/70">{subscore.name}</span>
        <span
          className="font-mono text-xs font-semibold"
          style={{ color: getColor(subscore.score) }}
        >
          {subscore.score}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${subscore.score}%`,
            backgroundColor: getColor(subscore.score),
          }}
        />
      </div>
    </div>
  )
}

function HealthScoreWidget({
  score,
  isLoading,
}: {
  score: ReturnType<typeof useHealthStore.getState>['score']
  isLoading: boolean
}) {
  const { t } = useTranslation('dashboard')

  if (isLoading || !score) {
    return (
      <div className="liquid-card flex items-center justify-center p-8">
        <div className="flex items-center gap-3">
          <Heart size={16} className="text-primary animate-pulse" />
          <span className="text-muted-foreground text-sm">{t('healthScore.calculating')}</span>
        </div>
      </div>
    )
  }

  const trendIcon =
    score.trend === 'improving' ? (
      <TrendingUp size={12} className="text-success" />
    ) : score.trend === 'declining' ? (
      <TrendingDown size={12} className="text-destructive" />
    ) : null

  return (
    <div className="liquid-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Heart size={16} className="text-primary" />
        <h3 className="font-heading text-lg font-semibold">{t('healthScore.title')}</h3>
        {trendIcon && (
          <Badge variant="secondary" className="ml-auto flex items-center gap-1 text-[10px]">
            {trendIcon}
            {t(`healthScore.trending.${score.trend}`)}
          </Badge>
        )}
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        {/* Gauge */}
        <div className="shrink-0">
          <HealthScoreGauge score={score.overall} grade={score.grade} />
        </div>

        {/* Sub-scores */}
        <div className="flex-1 space-y-3">
          {score.subscores.map((sub) => (
            <SubScoreBar key={sub.name} subscore={sub} />
          ))}
        </div>
      </div>

      {/* Top tip */}
      {score.tips[0] && (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">
                {t('healthScore.topTip')}
              </p>
              <p className="mt-0.5 text-sm text-white/80">{score.tips[0]}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RecentTransactionRow({ transaction: tx }: { transaction: TransactionWithDetails }) {
  return (
    <div className="flex items-center gap-3 rounded-[22px] px-4 py-3 transition-colors hover:bg-white/[0.04]">
      {tx.category_color ? (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: tx.category_color }}
        />
      ) : (
        <span className="bg-muted-foreground/30 h-2.5 w-2.5 shrink-0 rounded-full" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{tx.description}</p>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {tx.category_name && <span>{tx.category_name}</span>}
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
