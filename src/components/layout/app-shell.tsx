import { lazy, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router'
import { LayoutDashboard, ArrowLeftRight, Landmark, TrendingUp, Settings } from 'lucide-react'
import { Sidebar } from './sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

const bottomNavItems = [
  { icon: <LayoutDashboard size={20} />, label: 'Dashboard', href: '/' },
  { icon: <ArrowLeftRight size={20} />, label: 'Transactions', href: '/transactions' },
  { icon: <Landmark size={20} />, label: 'Accounts', href: '/accounts' },
  { icon: <TrendingUp size={20} />, label: 'Investments', href: '/investments' },
  { icon: <Settings size={20} />, label: 'Settings', href: '/settings' },
]

const AccountDialog = lazy(() =>
  import('@/components/accounts/account-dialog').then((m) => ({
    default: m.AccountDialog,
  }))
)
const TransactionDialog = lazy(() =>
  import('@/components/transactions/transaction-dialog').then((m) => ({
    default: m.TransactionDialog,
  }))
)
const BudgetDialog = lazy(() =>
  import('@/components/budgets/budget-dialog').then((m) => ({
    default: m.BudgetDialog,
  }))
)
const GoalDialog = lazy(() =>
  import('@/components/goals/goal-dialog').then((m) => ({
    default: m.GoalDialog,
  }))
)

export function AppShell() {
  const { pathname } = useLocation()

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      <Sidebar />
      <main className="grid-bg flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl p-6 pb-16 md:pb-0">
          <Suspense fallback={<LoadingSpinner className="h-full" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <BottomNav items={bottomNavItems} activeHref={pathname} />
      <Suspense>
        <AccountDialog />
        <TransactionDialog />
        <BudgetDialog />
        <GoalDialog />
      </Suspense>
    </div>
  )
}
