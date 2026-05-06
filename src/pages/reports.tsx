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
      <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-[28px] font-bold tracking-tight">
              {t('reports.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('reports.description')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="liquid-hero relative min-h-[240px] overflow-hidden p-7 sm:p-8">
          <BarChart3
            size={260}
            className="pointer-events-none absolute -right-12 -bottom-20 text-white/[0.035]"
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full flex-col justify-between gap-8">
            <div>
              <div className="text-muted-foreground mb-3 flex items-center gap-2">
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
                <Skeleton className="h-14 w-56" />
              ) : (
                <p
                  className={`font-heading text-4xl font-bold tracking-tight sm:text-5xl ${
                    netFlow >= 0 ? 'text-success' : 'text-warning'
                  }`}
                >
                  {formatMoney(netFlow)}
                </p>
              )}
              <p className="text-muted-foreground mt-3 max-w-xl text-sm">
                {t('reports.currentMonth')}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ReportMiniMetric
                icon={<Wallet size={15} />}
                label={t('reports.cash')}
                value={isLoading ? null : formatMoney(totalBalance)}
                tone="accent"
              />
              <ReportMiniMetric
                icon={<ArrowUpRight size={15} />}
                label={t('reports.income')}
                value={isLoading ? null : formatMoney(income)}
                tone="success"
              />
              <ReportMiniMetric
                icon={<ArrowDownRight size={15} />}
                label={t('reports.expenses')}
                value={isLoading ? null : formatMoney(expenses)}
                tone="danger"
              />
            </div>
          </div>
        </div>

        <div className="liquid-card p-5">
          <h2 className="font-heading text-lg font-semibold">{t('reports.budgetHealth')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">{t('reports.budgetDescription')}</p>
          <div className="my-6 flex justify-center">
            <div className="border-accent/20 bg-accent/5 flex h-36 w-36 items-center justify-center rounded-full border shadow-[0_0_60px_rgba(124,92,255,0.14)]">
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

      <div className="liquid-card p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">{t('reports.categoryBreakdown')}</h2>
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
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {topCategories.map((category) => {
              const percent = expenses > 0 ? Math.round((category.amount / expenses) * 100) : 0
              return (
                <div
                  key={category.name}
                  className="rounded-[18px] border border-white/[0.06] bg-white/[0.035] p-4"
                >
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
    </div>
  )
}

function ReportMiniMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  tone: 'accent' | 'success' | 'danger'
}) {
  const toneClass = {
    accent: 'text-accent',
    success: 'text-success',
    danger: 'text-destructive',
  }[tone]

  return (
    <div className="rounded-[18px] border border-white/[0.06] bg-black/20 p-4 backdrop-blur-xl">
      <div className="text-muted-foreground mb-2 flex items-center gap-2">
        <span className={toneClass}>{icon}</span>
        <span className="font-mono text-[10px] tracking-wider uppercase">{label}</span>
      </div>
      {value ? (
        <p className="font-heading text-lg font-bold">{value}</p>
      ) : (
        <Skeleton className="h-6 w-28" />
      )}
    </div>
  )
}
