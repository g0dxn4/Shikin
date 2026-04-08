import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  Target,
  TrendingUp,
  Repeat,
  LineChart,
  Brain,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Wallet,
  Lightbulb,
  Flame,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from '@/lib/constants'

const navItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { path: '/transactions', icon: ArrowLeftRight, labelKey: 'nav.transactions' },
  { path: '/accounts', icon: Landmark, labelKey: 'nav.accounts' },
  { path: '/budgets', icon: PiggyBank, labelKey: 'nav.budgets' },
  { path: '/goals', icon: Target, labelKey: 'nav.goals' },
  { path: '/investments', icon: TrendingUp, labelKey: 'nav.investments' },
  { path: '/subscriptions', icon: Repeat, labelKey: 'nav.subscriptions' },
  { path: '/debt-payoff', icon: Target, labelKey: 'nav.debtPayoff' },
  { path: '/net-worth', icon: Wallet, labelKey: 'nav.netWorth' },
  { path: '/spending-insights', icon: Lightbulb, labelKey: 'nav.spendingInsights' },
  { path: '/spending-heatmap', icon: Flame, labelKey: 'nav.spendingHeatmap' },
  { path: '/forecast', icon: LineChart, labelKey: 'nav.forecast' },
  { path: '/memories', icon: Brain, labelKey: 'nav.memories' },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()

  return (
    <aside
      className="glass-sidebar hidden h-screen flex-col transition-[width] duration-200 ease-out md:flex"
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-4">
        {!sidebarCollapsed && (
          <span className="gradient-text font-heading text-lg font-bold tracking-tight">
            Shikin
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 transition-colors hover:bg-white/5"
        >
          {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {navItems.map(({ path, icon: Icon, labelKey }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              cn(
                'sidebar-link',
                isActive && 'sidebar-link-active',
                sidebarCollapsed && 'justify-center px-0'
              )
            }
          >
            <Icon size={18} />
            {!sidebarCollapsed && <span>{t(labelKey)}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="border-border space-y-0.5 border-t px-2 py-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'sidebar-link',
              isActive && 'sidebar-link-active',
              sidebarCollapsed && 'justify-center px-0'
            )
          }
        >
          <Settings size={18} />
          {!sidebarCollapsed && <span>{t('nav.settings')}</span>}
        </NavLink>
      </div>
    </aside>
  )
}
