import { useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  TrendingUp,
  TrendingDown,
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
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
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
import { CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE } from '@/lib/constants'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import type { AnomalyType, AnomalySeverity } from '@/lib/anomaly-service'
import { useHealthStore } from '@/stores/health-store'
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import type { SubScore } from '@/lib/health-score-service'
import { formatMoney, fromCentavos } from '@/lib/money'

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
    insights: spendingInsights,
    momComparisons = [],
    isLoading: insightsLoading = false,
    loadComparisons: loadInsights,
  } = useSpendingInsightsStore()

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
    accountsFetchError ? `Accounts: ${accountsFetchError}` : null,
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

  const maxMonthlyFlow = useMemo(
    () => Math.max(1, ...monthlyChartData.map((month) => Math.max(month.expenses, month.income))),
    [monthlyChartData]
  )

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
              <p className="mt-10 font-mono text-4xl font-bold tracking-[-0.08em] sm:text-5xl md:text-[54px]">
                {hasMixedCurrencies
                  ? formatMoney(convertedTotalBalance, preferredCurrency)
                  : formatMoney(totalBalance)}
              </p>
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
          <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.035] p-4 sm:p-6">
            <div className="flex h-56 items-end justify-between gap-2 sm:gap-5">
              {monthlyChartData.map((month, index) => {
                const height = Math.max(28, Math.round((month.expenses / maxMonthlyFlow) * 200))
                const isHot = index === monthlyChartData.length - 1 || index === 3
                return (
                  <div key={month.month} className="flex flex-1 flex-col items-center gap-3">
                    <div
                      className={cn(
                        'w-full max-w-[54px] rounded-t-lg rounded-b-[3px]',
                        isHot ? 'bg-accent-hover' : 'bg-white/[0.12]'
                      )}
                      style={{ height }}
                      title={`${month.month}: ${formatMoney(month.expenses)}`}
                    />
                    <span className="text-muted-foreground font-mono text-[10px] font-bold uppercase">
                      {month.month}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs font-bold tracking-[0.16em] uppercase">
                Backend signals
              </p>
              {insightsLoading && (
                <span className="text-muted-foreground font-mono text-[10px]">Syncing</span>
              )}
            </div>
            {spendingInsights.length > 0 ? (
              spendingInsights.slice(0, 3).map((insight) => (
                <div
                  key={insight.id}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border px-3 py-2.5',
                    insight.severity === 'alert' && 'border-destructive/20 bg-destructive/5',
                    insight.severity === 'warning' && 'border-warning/20 bg-warning/5',
                    insight.severity === 'info' && 'border-white/[0.08] bg-white/[0.03]'
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: insight.categoryColor }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {insight.message}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-xs font-bold',
                      insight.type === 'decrease' ? 'text-success' : 'text-warning'
                    )}
                  >
                    {formatMoney(Math.round(Math.abs(insight.amount) * 100))}
                  </span>
                </div>
              ))
            ) : momComparisons.some((comparison) => comparison.current > 0) ? (
              momComparisons
                .filter((comparison) => comparison.current > 0)
                .slice(0, 3)
                .map((comparison) => (
                  <div
                    key={comparison.categoryName}
                    className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: comparison.categoryColor }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {comparison.categoryName}
                    </span>
                    <span className="font-mono text-xs font-bold">
                      {formatMoney(Math.round(comparison.current * 100))}
                    </span>
                  </div>
                ))
            ) : (
              <p className="text-muted-foreground rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-sm">
                Add a few expenses and Shikin will surface category changes here.
              </p>
            )}
          </div>

          <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs font-bold">Projected runway</p>
              <p className="mt-2 font-mono text-2xl font-bold tracking-[-0.04em]">
                {monthlyExpenses > 0
                  ? `${Math.max(0, convertedTotalBalance / monthlyExpenses).toFixed(1)} months`
                  : 'Stable'}
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

      {/* Alerts section */}
      <AlertsSection
        anomalies={activeAnomalies}
        isLoading={anomalyLoading}
        onDismiss={dismissAnomaly}
        t={t}
      />

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
          <Button variant="outline" size="sm" onClick={handleGenerateRecap} disabled={recapLoading}>
            <RefreshCw size={14} className={recapLoading ? 'animate-spin' : ''} />
            {recapLoading ? t('recap.generating') : t('recap.generate')}
          </Button>
        </div>

        {currentRecap ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm leading-relaxed">{currentRecap.summary}</p>
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
