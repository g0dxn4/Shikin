import { useEffect, useMemo, useCallback } from 'react'
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
  RefreshCw,
  FileText,
} from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
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
import { useRecapStore } from '@/stores/recap-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney } from '@/lib/money'

dayjs.extend(relativeTime)

const CHART_COLORS = ['#bf5af2', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6']

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tTx } = useTranslation('transactions')
  const { t: tAcc } = useTranslation('accounts')
  const { setAIPanelOpen, openAccountDialog, openTransactionDialog } = useUIStore()
  const { accounts, isLoading: accountsLoading, fetch: fetchAccounts } = useAccountStore()
  const { transactions, isLoading: txLoading, fetch: fetchTransactions } = useTransactionStore()
  const {
    currentRecap,
    isLoading: recapLoading,
    generateWeekly,
    loadLatestWeekly,
  } = useRecapStore()

  useEffect(() => {
    fetchAccounts()
    fetchTransactions()
    loadLatestWeekly()
  }, [fetchAccounts, fetchTransactions, loadLatestWeekly])

  const handleGenerateRecap = useCallback(() => {
    generateWeekly()
  }, [generateWeekly])

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

  const savingsRate = useMemo(() => {
    if (monthlyIncome <= 0) return 0
    return Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)
  }, [monthlyIncome, monthlyExpenses])

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
      if (tx.type === 'expense' && tx.date >= startOfMonth && tx.date <= today && tx.category_name) {
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
                <h3 className="font-heading mb-4 text-sm font-semibold">{t('charts.categories')}</h3>
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
                            style={{ backgroundColor: cat.color || CHART_COLORS[i % CHART_COLORS.length] }}
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

          {/* Weekly Recap */}
          <div className="glass-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-primary" />
                <h3 className="font-heading text-sm font-semibold">{t('recap.title')}</h3>
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
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/6 bg-white/4 px-3 py-1 text-xs"
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
            <Button
              variant="outline"
              onClick={() => setAIPanelOpen(true)}
            >
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

function RecentTransactionRow({ transaction: tx }: { transaction: TransactionWithDetails }) {
  return (
    <div className="glass-card flex items-center gap-3 px-4 py-2.5">
      {tx.category_color && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: tx.category_color }}
        />
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
