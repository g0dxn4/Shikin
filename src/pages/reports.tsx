import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowUpRight, BarChart3, PieChart, Receipt, Wallet } from 'lucide-react'
import dayjs from 'dayjs'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/lib/money'
import { useAccountStore } from '@/stores/account-store'
import { useBudgetStore } from '@/stores/budget-store'
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
  const {
    transactions,
    fetch: fetchTransactions,
    isLoading: transactionsLoading,
  } = useTransactionStore()

  useEffect(() => {
    void Promise.allSettled([fetchAccounts(), fetchBudgets(), fetchTransactions()])
  }, [fetchAccounts, fetchBudgets, fetchTransactions])

  const monthStart = startOfCurrentMonth()
  const monthEnd = endOfCurrentMonth()
  const monthTransactions = transactions.filter(
    (tx) => tx.date >= monthStart && tx.date <= monthEnd && tx.type !== 'transfer'
  )
  const income = monthTransactions
    .filter((tx) => tx.type === 'income')
    .reduce((total, tx) => total + tx.amount, 0)
  const expenses = monthTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce((total, tx) => total + tx.amount, 0)
  const netFlow = income - expenses
  const totalBalance = accounts.reduce((total, account) => total + account.balance, 0)
  const totalBudgeted = budgets.reduce((total, budget) => total + budget.amount, 0)
  const totalSpentAgainstBudgets = budgets.reduce((total, budget) => total + budget.spent, 0)
  const budgetUsage =
    totalBudgeted > 0 ? Math.round((totalSpentAgainstBudgets / totalBudgeted) * 100) : 0
  const isLoading = accountsLoading || budgetsLoading || transactionsLoading

  const topCategories = Object.values(
    monthTransactions
      .filter((tx) => tx.type === 'expense')
      .reduce<Record<string, { name: string; color: string; amount: number }>>((groups, tx) => {
        const key = tx.category_name ?? t('reports.uncategorized')
        groups[key] ??= {
          name: key,
          color: tx.category_color ?? 'var(--accent)',
          amount: 0,
        }
        groups[key].amount += tx.amount
        return groups
      }, {})
  )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  return (
    <div className="page-content animate-fade-in-up">
      <div className="liquid-card page-header p-5">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-2xl font-bold">{t('reports.title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('reports.description')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="liquid-hero p-5">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Wallet size={16} className="text-accent" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('reports.cash')}
            </span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <p className="font-heading text-2xl font-bold">{formatMoney(totalBalance)}</p>
          )}
        </div>
        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <ArrowUpRight size={16} className="text-success" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('reports.income')}
            </span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <p className="font-heading text-2xl font-bold">{formatMoney(income)}</p>
          )}
        </div>
        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <ArrowDownRight size={16} className="text-destructive" aria-hidden="true" />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('reports.expenses')}
            </span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <p className="font-heading text-2xl font-bold">{formatMoney(expenses)}</p>
          )}
        </div>
        <div className="metric-card">
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            <Receipt
              size={16}
              className={netFlow >= 0 ? 'text-success' : 'text-warning'}
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] tracking-wider uppercase">
              {t('reports.netFlow')}
            </span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <p className="font-heading text-2xl font-bold">{formatMoney(netFlow)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="liquid-card p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-semibold">
                {t('reports.categoryBreakdown')}
              </h2>
              <p className="text-muted-foreground mt-1 text-xs">{t('reports.currentMonth')}</p>
            </div>
            <PieChart size={18} className="text-primary" aria-hidden="true" />
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-11 rounded-2xl" />
              ))}
            </div>
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
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="truncate font-medium">{category.name}</span>
                      </div>
                      <span className="font-heading font-semibold">
                        {formatMoney(category.amount)}
                      </span>
                    </div>
                    <div className="bg-secondary h-2 overflow-hidden rounded-full">
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
        </div>

        <div className="liquid-card p-5">
          <h2 className="font-heading text-lg font-semibold">{t('reports.budgetHealth')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">{t('reports.budgetDescription')}</p>
          <div className="my-6 flex justify-center">
            <div className="border-accent/20 bg-accent/5 flex h-32 w-32 items-center justify-center rounded-full border">
              <span className="font-heading text-3xl font-bold">{budgetUsage}%</span>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t('reports.budgeted')}</span>
              <span className="font-semibold">{formatMoney(totalBudgeted)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t('reports.spent')}</span>
              <span className="font-semibold">{formatMoney(totalSpentAgainstBudgets)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t('reports.transactions')}</span>
              <span className="font-semibold">{monthTransactions.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
