import { lazy, Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'
import { getNavigationGroup, getNavigationRoute } from './navigation-model'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { TauriTitleBar } from '@/components/layout/tauri-title-bar'
import { cn } from '@/lib/utils'

const AccountDialog = lazy(() =>
  import('@/components/accounts/account-dialog').then((module) => ({
    default: module.AccountDialog,
  }))
)
const TransactionDialog = lazy(() =>
  import('@/components/transactions/transaction-dialog').then((module) => ({
    default: module.TransactionDialog,
  }))
)
const RecurringRuleDialog = lazy(() =>
  import('@/components/transactions/recurring-rule-dialog').then((module) => ({
    default: module.RecurringRuleDialog,
  }))
)
const BudgetDialog = lazy(() =>
  import('@/components/budgets/budget-dialog').then((module) => ({ default: module.BudgetDialog }))
)
const GoalDialog = lazy(() =>
  import('@/components/goals/goal-dialog').then((module) => ({ default: module.GoalDialog }))
)

export function AppShell() {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const route = getNavigationRoute(pathname)
  const group = getNavigationGroup(pathname)

  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    main.scrollTop = 0
    main.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground sr-only fixed top-4 left-4 z-[70] rounded-lg px-3 py-2 focus:not-sr-only"
      >
        {t('navigation.skipToContent')}
      </a>
      <TauriTitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="native-topbar">
            <h1 className="truncate text-[15px] font-semibold sm:text-base">
              {t(route.labelKey, route.fallbackLabel)}
            </h1>
          </header>
          {group.routes.length > 1 ? (
            <nav
              className="native-subnav"
              aria-label={t('navigation.section', {
                section: t(group.labelKey, group.fallbackLabel),
              })}
            >
              {group.routes.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => cn('subnav-link', isActive && 'subnav-link-active')}
                >
                  {t(item.labelKey, item.fallbackLabel)}
                </NavLink>
              ))}
            </nav>
          ) : null}
          <main
            key={pathname}
            id="main-content"
            ref={mainRef}
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none"
          >
            <div className="route-content mx-auto w-full max-w-[1320px] p-4 pb-24 sm:p-5 sm:pb-24 lg:p-7 lg:pb-8">
              <Suspense fallback={<LoadingSpinner className="min-h-64" />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
        <BottomNav activeHref={pathname} />
      </div>
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
