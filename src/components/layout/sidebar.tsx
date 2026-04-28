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
  LayoutGrid,
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
    activePaths: ['/transactions', '/bills', '/bill-calendar'],
  },
  {
    path: '/accounts',
    icon: Landmark,
    labelKey: 'nav.accounts',
    label: 'Accounts',
    activePaths: ['/accounts', '/investments'],
  },
  { path: '/budgets', icon: PiggyBank, labelKey: 'nav.budgets', label: 'Budgets' },
  { path: '/categories', icon: LayoutGrid, labelKey: 'nav.categories', label: 'Categories' },
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
      aria-label="Sidebar"
      className="glass-sidebar hidden h-[calc(100vh-1rem)] shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out md:flex"
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
    >
      {/* Header */}
      <div
        className={cn(
          'flex h-14 items-center px-4',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2.5">
            <div className="liquid-action font-heading flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold">
              S
            </div>
            <span className="gradient-text font-heading text-xl font-bold">Shikin</span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-xl p-1.5 transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:outline-none"
        >
          {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1" aria-label="Main navigation">
        {!sidebarCollapsed && (
          <div className="text-text-muted px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.18em] uppercase">
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
              aria-current={isSectionActive ? 'page' : undefined}
              className={({ isActive }) =>
                cn(
                  'sidebar-link',
                  (isActive || isSectionActive) && 'sidebar-link-active',
                  sidebarCollapsed && 'justify-center px-0'
                )
              }
            >
              <Icon size={18} aria-hidden="true" />
              {!sidebarCollapsed && <span>{t(labelKey, label)}</span>}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
