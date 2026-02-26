import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  TrendingUp,
  Settings,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from '@/lib/constants'

const navItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { path: '/transactions', icon: ArrowLeftRight, labelKey: 'nav.transactions' },
  { path: '/accounts', icon: Landmark, labelKey: 'nav.accounts' },
  { path: '/budgets', icon: PiggyBank, labelKey: 'nav.budgets' },
  { path: '/investments', icon: TrendingUp, labelKey: 'nav.investments' },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const { sidebarCollapsed, toggleSidebar, toggleAIPanel } = useUIStore()

  return (
    <aside
      className="glass-sidebar flex h-screen flex-col transition-all duration-200"
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-4">
        {!sidebarCollapsed && (
          <span className="gradient-text font-heading text-lg font-bold tracking-tight">
            Valute
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 hover:bg-white/5"
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
            className={({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active')}
          >
            <Icon size={18} />
            {!sidebarCollapsed && <span>{t(labelKey)}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="border-border space-y-0.5 border-t px-2 py-2">
        <button onClick={toggleAIPanel} className="sidebar-link w-full text-left">
          <Sparkles size={18} />
          {!sidebarCollapsed && <span>{t('nav.ai')}</span>}
        </button>
        <NavLink
          to="/settings"
          className={({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active')}
        >
          <Settings size={18} />
          {!sidebarCollapsed && <span>{t('nav.settings')}</span>}
        </NavLink>
      </div>
    </aside>
  )
}
