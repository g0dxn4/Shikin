import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Wallet, TrendingUp, TrendingDown, PiggyBank, Plus, ArrowRight } from 'lucide-react'
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

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: t('cards.totalBalance'),
            icon: Wallet,
            value: formatMoney(totalBalance),
          },
          {
            label: t('cards.monthlyIncome'),
            icon: TrendingUp,
            value: formatMoney(monthlyIncome),
          },
          {
            label: t('cards.monthlyExpenses'),
            icon: TrendingDown,
            value: formatMoney(monthlyExpenses),
          },
          {
            label: t('cards.savings'),
            icon: PiggyBank,
            value: `${savingsRate}%`,
          },
        ].map(({ label, icon: Icon, value }) => (
          <div key={label} className="glass-card p-4">
            <div className="text-muted-foreground mb-2 flex items-center gap-2">
              <Icon size={16} />
              <span className="font-mono text-xs tracking-wider uppercase">{label}</span>
            </div>
            <p className="font-heading text-2xl font-bold">{value}</p>
          </div>
        ))}
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
        /* Recent transactions + quick actions */
        <div className="space-y-4">
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
            <div className="space-y-2">
              {recentTransactions.map((tx) => (
                <RecentTransactionRow key={tx.id} transaction={tx} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RecentTransactionRow({ transaction: tx }: { transaction: TransactionWithDetails }) {
  return (
    <div className="glass-card flex items-center gap-3 p-3">
      {tx.category_color && (
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: tx.category_color }}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{tx.description}</p>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {tx.category_name && <span>{tx.category_name}</span>}
          {tx.account_name && (
            <Badge variant="secondary" className="text-xs">
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
        <p className="text-muted-foreground font-mono text-xs">{dayjs(tx.date).format('MMM D')}</p>
      </div>
    </div>
  )
}
