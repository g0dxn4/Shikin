import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
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
} from 'lucide-react'
import dayjs from 'dayjs'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { useAnomalyStore } from '@/stores/anomaly-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import type { AnomalyType, AnomalySeverity } from '@/lib/anomaly-service'
import { formatMoney } from '@/lib/money'

const CHART_COLORS = [
  '#bf5af2',
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
]

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tTx } = useTranslation('transactions')
  const { t: tAcc } = useTranslation('accounts')
  const { setAIPanelOpen, openAccountDialog, openTransactionDialog } = useUIStore()
  const { accounts, isLoading: accountsLoading, fetch: fetchAccounts } = useAccountStore()
  const { transactions, isLoading: txLoading, fetch: fetchTransactions } = useTransactionStore()
  const { isLoading: anomalyLoading, scanForAnomalies, getActiveAnomalies, dismissAnomaly } = useAnomalyStore()

  useEffect(() => {
    fetchAccounts()
    fetchTransactions()
  }, [fetchAccounts, fetchTransactions])

  // Run anomaly scan after transactions are loaded
  useEffect(() => {
    if (transactions.length > 0 && !txLoading) {
      scanForAnomalies()
    }
  }, [transactions.length, txLoading, scanForAnomalies])

  const activeAnomalies = getActiveAnomalies()

  const totalBalance = useMemo(() => accounts.reduce((sum, a) => sum + a.balance, 0), [accounts])

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

  const hasAccounts = accounts.length > 0
  const isLoading = accountsLoading || txLoading

  if (isLoading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="animate-fade-in-up page-content">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>

      {/* 4-column metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<Wallet size={16} />}
          iconColor="text-primary"
          label={t('cards.totalBalance')}
          value={formatMoney(totalBalance)}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="glass-card px-4 py-3">
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
        <div className="glass-card px-4 py-3">
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
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <Wallet size={32} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-xl font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-6 max-w-md text-sm">{t('empty.description')}</p>
          <div className="flex gap-3">
            <Button onClick={() => openAccountDialog()}>{t('empty.addAccount')}</Button>
            <Button variant="outline" onClick={() => setAIPanelOpen(true)}>
              <Sparkles size={16} />
              {t('empty.askAI')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Charts row */}
          {transactions.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Spending area chart */}
              <div className="glass-card p-5">
                <h3 className="font-heading mb-4 text-sm font-semibold">{t('charts.spending')}</h3>
                <div className="mb-2 text-right">
                  <Link
                    to="/transactions"
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    {t('charts.drilldownTransactions')}
                  </Link>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyChartData}>
                      <defs>
                        <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#bf5af2" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#bf5af2" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="month"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#71717a', fontSize: 11 }}
                      />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{
                          background: '#0a0a0a',
                          border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        itemStyle={{ color: '#ffffff' }}
                        labelStyle={{ color: '#a1a1aa' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="income"
                        stroke="#22c55e"
                        strokeWidth={2}
                        fill="url(#incomeGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="expenses"
                        stroke="#bf5af2"
                        strokeWidth={2}
                        fill="url(#expenseGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Category donut */}
              <div className="glass-card p-5">
                <h3 className="font-heading mb-4 text-sm font-semibold">
                  {t('charts.categories')}
                </h3>
                <div className="mb-2 text-right">
                  <Link
                    to="/budgets"
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    {t('charts.drilldownBudgets')}
                  </Link>
                </div>
                {categoryData.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <div className="h-48 w-48 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
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
                            contentStyle={{
                              background: '#0a0a0a',
                              border: '1px solid rgba(255,255,255,0.06)',
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            formatter={(value) => formatMoney(value as number)}
                          />
                        </PieChart>
                      </ResponsiveContainer>
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

          {/* Alerts section */}
          <AlertsSection
            anomalies={activeAnomalies}
            isLoading={anomalyLoading}
            onDismiss={dismissAnomaly}
            t={t}
          />

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
                <div key={account.id} className="metric-card">
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
              <div className="glass-card flex flex-col items-center justify-center py-8 text-center">
                <p className="text-muted-foreground text-sm">{tTx('empty.description')}</p>
                <Button className="mt-3" size="sm" onClick={() => openTransactionDialog()}>
                  <Plus size={14} />
                  {tTx('addTransaction')}
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {recentTransactions.map((tx) => (
                  <RecentTransactionRow key={tx.id} transaction={tx} />
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex gap-3">
            <Button onClick={() => openTransactionDialog()}>
              <Plus size={16} />
              {t('quickActions.addTransaction')}
            </Button>
            <Button variant="outline" onClick={() => setAIPanelOpen(true)}>
              <Sparkles size={16} />
              {t('quickActions.askVal')}
            </Button>
          </div>
        </>
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
}: {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="metric-card">
      <div className="text-muted-foreground mb-2 flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <span className="font-mono text-[10px] tracking-wider uppercase">{label}</span>
      </div>
      <p className={`font-heading text-2xl font-bold tracking-tight ${valueColor || ''}`}>
        {value}
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
          <div key={i} className="glass-card space-y-3 p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="glass-card p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-48 w-full" />
        </div>
        <div className="glass-card p-5">
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

const SEVERITY_STYLES: Record<AnomalySeverity, { border: string; bg: string; text: string; badge: string }> = {
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
      <div className="glass-card flex items-center gap-3 p-4">
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
              className={`glass-card flex items-start gap-3 border px-4 py-3 ${styles.border}`}
            >
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${styles.bg} ${styles.text}`}>
                {ANOMALY_ICONS[anomaly.type]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{anomaly.title}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.badge}`}>
                    {t(`alerts.severity.${anomaly.severity}`)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {anomaly.description}
                </p>
              </div>
              <button
                onClick={() => onDismiss(anomaly.id)}
                className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0 rounded-md p-1 transition-colors hover:bg-white/5"
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

function RecentTransactionRow({ transaction: tx }: { transaction: TransactionWithDetails }) {
  return (
    <div className="glass-card flex items-center gap-3 px-4 py-2.5">
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
