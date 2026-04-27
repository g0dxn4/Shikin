import { NavLink, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from '@/lib/constants'

interface SidebarNavItem {
  path: string
  icon: LucideIcon
  labelKey: string
  label: string
  activePaths?: string[]
}

const navItems: SidebarNavItem[] = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', label: 'Dashboard' },
  {
    path: '/transactions',
    icon: ArrowLeftRight,
    labelKey: 'nav.transactions',
    label: 'Transactions',
    activePaths: ['/transactions', '/bills'],
  },
  {
    path: '/accounts',
    icon: Landmark,
    labelKey: 'nav.accounts',
    label: 'Accounts',
    activePaths: ['/accounts', '/investments'],
  },
  { path: '/budgets', icon: PiggyBank, labelKey: 'nav.budgets', label: 'Budgets' },
  {
    path: '/goals',
    icon: Sparkles,
    labelKey: 'nav.goals',
    label: 'Goals',
    activePaths: ['/goals', '/debt-payoff'],
  },
  {
    path: '/insights',
    icon: BarChart3,
    labelKey: 'nav.insights',
    label: 'Insights',
    activePaths: [
      '/insights',
      '/reports',
      '/forecast',
      '/net-worth',
      '/spending-insights',
      '/spending-heatmap',
    ],
  },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings', label: 'Settings' },
]

export function Sidebar() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()

  return (
    <aside
      className="glass-sidebar hidden h-[calc(100vh-3rem)] shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out md:flex"
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
    >
      {/* Header */}
      <div
        className={cn(
          'flex h-16 items-center px-5',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
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

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main navigation">
        {!sidebarCollapsed && (
          <div className="text-text-muted px-3 py-2 text-[10px] font-semibold tracking-[0.18em] uppercase">
            Finance
          </div>
        )}
        {navItems.map(({ path, icon: Icon, labelKey, label, activePaths }) => {
          const isSectionActive = activePaths ? activePaths.includes(pathname) : pathname === path

          return (
            <NavLink
              key={path}
              to={path}
              aria-label={sidebarCollapsed ? t(labelKey, label) : undefined}
              className={({ isActive }) =>
                cn(
                  'sidebar-link',
                  (isActive || isSectionActive) && 'sidebar-link-active',
                  sidebarCollapsed && 'justify-center px-0'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} aria-hidden="true" />
                  {!sidebarCollapsed && (
                    <span {...(isActive || isSectionActive ? { 'aria-current': 'page' } : {})}>
                      {t(labelKey, label)}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
