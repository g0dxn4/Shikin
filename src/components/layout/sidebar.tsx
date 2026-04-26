import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  Receipt,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Puzzle,
  TrendingUp,
  Repeat,
  CreditCard,
  LineChart,
  Brain,
  Flame,
  Sparkles,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from '@/lib/constants'

const mainNavItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', label: 'Dashboard' },
  {
    path: '/transactions',
    icon: ArrowLeftRight,
    labelKey: 'nav.transactions',
    label: 'Transactions',
  },
  { path: '/accounts', icon: Landmark, labelKey: 'nav.accounts', label: 'Accounts' },
  { path: '/budgets', icon: PiggyBank, labelKey: 'nav.budgets', label: 'Budgets' },
  { path: '/bills', icon: Receipt, labelKey: 'nav.bills', label: 'Bills' },
  { path: '/reports', icon: BarChart3, labelKey: 'nav.reports', label: 'Reports' },
  { path: '/goals', icon: Sparkles, labelKey: 'nav.goals', label: 'Goals' },
] as const

const advancedNavItems = [
  { path: '/investments', icon: TrendingUp, labelKey: 'nav.investments', label: 'Investments' },
  { path: '/subscriptions', icon: Repeat, labelKey: 'nav.subscriptions', label: 'Subscriptions' },
  { path: '/debt-payoff', icon: CreditCard, labelKey: 'nav.debtPayoff', label: 'Debt payoff' },
  { path: '/forecast', icon: LineChart, labelKey: 'nav.forecast', label: 'Forecast' },
  { path: '/net-worth', icon: Landmark, labelKey: 'nav.netWorth', label: 'Net worth' },
  {
    path: '/spending-insights',
    icon: Sparkles,
    labelKey: 'nav.spendingInsights',
    label: 'Insights',
  },
  { path: '/spending-heatmap', icon: Flame, labelKey: 'nav.spendingHeatmap', label: 'Heatmap' },
  { path: '/memories', icon: Brain, labelKey: 'nav.memories', label: 'Memories' },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings', label: 'Settings' },
  { path: '/extensions', icon: Puzzle, labelKey: 'nav.extensions', label: 'Extensions' },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()

  return (
    <aside
      className="glass-sidebar hidden h-[calc(100vh-3rem)] shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out md:flex"
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-5">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-3">
            <div className="liquid-action font-heading flex h-9 w-9 items-center justify-center rounded-2xl text-sm font-bold">
              S
            </div>
            <span className="gradient-text font-heading text-xl font-bold">Shikin</span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          className="text-muted-foreground hover:text-foreground rounded-xl p-1.5 transition-colors hover:bg-white/[0.08]"
        >
          {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {!sidebarCollapsed && (
        <div className="text-muted-foreground mx-5 mb-2 flex h-10 items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.04] px-3">
          <Search size={15} aria-hidden="true" />
          <span className="text-xs font-medium">Search or command</span>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main navigation">
        {!sidebarCollapsed && (
          <div className="text-text-muted px-3 py-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
            Finance
          </div>
        )}
        {mainNavItems.map(({ path, icon: Icon, labelKey, label }) => (
          <NavLink
            key={path}
            to={path}
            aria-label={sidebarCollapsed ? t(labelKey, label) : undefined}
            className={({ isActive }) =>
              cn(
                'sidebar-link',
                isActive && 'sidebar-link-active',
                sidebarCollapsed && 'justify-center px-0'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} aria-hidden="true" />
                {!sidebarCollapsed && (
                  <span {...(isActive ? { 'aria-current': 'page' } : {})}>
                    {t(labelKey, label)}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}

        {/* ADVANCED divider */}
        {!sidebarCollapsed && (
          <div className="pt-4 pb-2">
            <div className="text-text-muted px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase">
              {t('nav.advanced', 'Advanced')}
            </div>
          </div>
        )}
        {sidebarCollapsed && <div className="border-border my-2 border-t" />}

        {advancedNavItems.map(({ path, icon: Icon, labelKey, label }) => (
          <NavLink
            key={path}
            to={path}
            aria-label={sidebarCollapsed ? t(labelKey, label) : undefined}
            className={({ isActive }) =>
              cn(
                'sidebar-link',
                isActive && 'sidebar-link-active',
                sidebarCollapsed && 'justify-center px-0'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} aria-hidden="true" />
                {!sidebarCollapsed && (
                  <span {...(isActive ? { 'aria-current': 'page' } : {})}>
                    {t(labelKey, label)}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      {!sidebarCollapsed && (
        <div className="text-success m-5 flex items-center gap-2 rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.06] px-3 py-2 text-xs font-semibold">
          <ShieldCheck size={15} aria-hidden="true" />
          Local vault active
        </div>
      )}
    </aside>
  )
}
