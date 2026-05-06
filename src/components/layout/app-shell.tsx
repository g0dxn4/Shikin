import { lazy, Suspense, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  BarChart3,
  Settings,
  Sparkles,
  LayoutGrid,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

const mobilePrimaryNavItems = [
  { icon: <LayoutDashboard size={20} />, labelKey: 'nav.dashboard', label: 'Dashboard', href: '/' },
  {
    icon: <ArrowLeftRight size={20} />,
    labelKey: 'nav.transactions',
    label: 'Transactions',
    href: '/transactions',
    activeHrefs: ['/bills', '/bill-calendar'],
  },
  {
    icon: <Landmark size={20} />,
    labelKey: 'nav.accounts',
    label: 'Accounts',
    href: '/accounts',
    activeHrefs: ['/investments'],
  },
  {
    icon: <BarChart3 size={20} />,
    labelKey: 'nav.insights',
    label: 'Insights',
    href: '/insights',
    activeHrefs: ['/reports', '/forecast', '/net-worth', '/spending-insights', '/spending-heatmap'],
  },
]

const mobileMoreNavItems = [
  { icon: <PiggyBank size={20} />, labelKey: 'nav.budgets', label: 'Budgets', href: '/budgets' },
  {
    icon: <LayoutGrid size={20} />,
    labelKey: 'nav.categories',
    label: 'Categories',
    href: '/categories',
  },
  {
    icon: <Sparkles size={20} />,
    labelKey: 'nav.goals',
    label: 'Goals',
    href: '/goals',
    activeHrefs: ['/debt-payoff'],
  },
  { icon: <Settings size={20} />, labelKey: 'nav.settings', label: 'Settings', href: '/settings' },
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
const RecurringRuleDialog = lazy(() =>
  import('@/components/transactions/recurring-rule-dialog').then((m) => ({
    default: m.RecurringRuleDialog,
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
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const primaryItems = mobilePrimaryNavItems.map((item) => ({
    ...item,
    label: t(item.labelKey, item.label),
  }))
  const moreItems = mobileMoreNavItems.map((item) => ({
    ...item,
    label: t(item.labelKey, item.label),
  }))

  useEffect(() => {
    mainRef.current?.focus()
  }, [pathname])

  return (
    <div className="bg-background flex h-screen gap-0 overflow-hidden p-0 md:gap-2 md:p-2">
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
        className="grid-bg focus-visible:ring-ring flex-1 overflow-y-auto focus-visible:ring-2 focus-visible:outline-none md:rounded-[24px] md:border md:border-white/[0.06]"
      >
        <div className="w-full p-3 pb-24 sm:p-4 md:p-3 md:pb-3">
          <Suspense fallback={<LoadingSpinner className="h-full" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <BottomNav items={primaryItems} moreItems={moreItems} activeHref={pathname} />
      <Suspense>
        <AccountDialog />
        <TransactionDialog />
        <RecurringRuleDialog />
        <BudgetDialog />
        <GoalDialog />
      </Suspense>
    </div>
  )
}
