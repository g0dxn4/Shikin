import { lazy, Suspense, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  Receipt,
  BarChart3,
  Settings,
  Puzzle,
  TrendingUp,
  Repeat,
  CreditCard,
  LineChart,
  Brain,
  Flame,
  Sparkles,
} from 'lucide-react'
import { Sidebar } from './sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

const mobilePrimaryNavItems = [
  { icon: <LayoutDashboard size={20} />, label: 'Dashboard', href: '/' },
  { icon: <ArrowLeftRight size={20} />, label: 'Transactions', href: '/transactions' },
  { icon: <Landmark size={20} />, label: 'Accounts', href: '/accounts' },
  { icon: <PiggyBank size={20} />, label: 'Budgets', href: '/budgets' },
]

const mobileMoreNavItems = [
  { icon: <Receipt size={20} />, label: 'Bills', href: '/bills' },
  { icon: <BarChart3 size={20} />, label: 'Reports', href: '/reports' },
  { icon: <TrendingUp size={20} />, label: 'Investments', href: '/investments' },
  { icon: <Repeat size={20} />, label: 'Subscriptions', href: '/subscriptions' },
  { icon: <CreditCard size={20} />, label: 'Debt Payoff', href: '/debt-payoff' },
  { icon: <LineChart size={20} />, label: 'Forecast', href: '/forecast' },
  { icon: <Landmark size={20} />, label: 'Net Worth', href: '/net-worth' },
  { icon: <Sparkles size={20} />, label: 'Insights', href: '/spending-insights' },
  { icon: <Flame size={20} />, label: 'Heatmap', href: '/spending-heatmap' },
  { icon: <Brain size={20} />, label: 'Memories', href: '/memories' },
  { icon: <Settings size={20} />, label: 'Settings', href: '/settings' },
  { icon: <Puzzle size={20} />, label: 'Extensions', href: '/extensions' },
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
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mainRef.current?.focus()
  }, [pathname])

  return (
    <div className="bg-background flex h-screen overflow-hidden p-0 md:p-6">
      <a
        href="#main-content"
        className="bg-accent text-accent-foreground sr-only fixed top-4 left-4 z-[60] rounded px-3 py-2 focus:not-sr-only"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className="grid-bg flex-1 overflow-y-auto focus:outline-none md:rounded-[32px] md:border md:border-white/[0.06]"
      >
        <div className="mx-auto max-w-[1420px] p-4 pb-24 sm:p-6 md:p-8 md:pb-8">
          <Suspense fallback={<LoadingSpinner className="h-full" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <BottomNav
        items={mobilePrimaryNavItems}
        moreItems={mobileMoreNavItems}
        activeHref={pathname}
      />
      <Suspense>
        <AccountDialog />
        <TransactionDialog />
        <BudgetDialog />
        <GoalDialog />
      </Suspense>
    </div>
  )
}
