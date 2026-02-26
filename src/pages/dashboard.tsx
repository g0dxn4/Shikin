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
} from 'lucide-react'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney } from '@/lib/money'

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tTx } = useTranslation('transactions')
  const { t: tAcc } = useTranslation('accounts')
  const { setAIPanelOpen } = useUIStore()
  const { openAccountDialog, openTransactionDialog } = useUIStore()
  const { accounts, fetch: fetchAccounts } = useAccountStore()
  const { transactions, fetch: fetchTransactions } = useTransactionStore()

  useEffect(() => {
    fetchAccounts()
    fetchTransactions()
  }, [fetchAccounts, fetchTransactions])

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

  const recentTransactions = useMemo(() => transactions.slice(0, 5), [transactions])

  const hasAccounts = accounts.length > 0

  return (
    <div className="animate-fade-in-up space-y-6">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>

      {/* Hero balance card */}
      <div className="glass-card bg-gradient-to-br from-[#BF5AF218] to-transparent p-8">
        <p className="text-muted-foreground mb-2 font-mono text-xs tracking-wider uppercase">
          {t('cards.totalBalance')}
        </p>
        <p className="font-heading text-4xl font-bold tracking-tight">
          {formatMoney(totalBalance)}
        </p>
        {hasAccounts && (
          <p className="text-muted-foreground mt-2 text-sm">
            across {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
          </p>
        )}
      </div>

      {/* 3-column metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="glass-card p-5">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <TrendingUp size={16} className="text-success" />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('cards.monthlyIncome')}
            </span>
          </div>
          <p className="font-heading text-2xl font-bold tracking-tight text-success">
            {formatMoney(monthlyIncome)}
          </p>
        </div>
        <div className="glass-card p-5">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <TrendingDown size={16} className="text-destructive" />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('cards.monthlyExpenses')}
            </span>
          </div>
          <p className="font-heading text-2xl font-bold tracking-tight text-destructive">
            {formatMoney(monthlyExpenses)}
          </p>
        </div>
        <div className="glass-card p-5">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <PiggyBank size={16} className="text-primary" />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('cards.savings')}
            </span>
          </div>
          <p className="font-heading text-primary text-2xl font-bold tracking-tight">
            {savingsRate}%
          </p>
        </div>
      </div>

      {!hasAccounts ? (
        /* Empty state */
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <Wallet size={32} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-xl font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-6 max-w-md text-sm">{t('empty.description')}</p>
          <div className="flex gap-3">
            <Button onClick={() => openAccountDialog()}>{t('empty.addAccount')}</Button>
            <button
              onClick={() => setAIPanelOpen(true)}
              className="border-border text-foreground border px-4 py-2 text-sm font-medium hover:bg-white/5"
            >
              {t('empty.askAI')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Accounts section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
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
                <div key={account.id} className="glass-card p-4">
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
            <div className="flex items-center justify-between">
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
        </>
      )}
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
