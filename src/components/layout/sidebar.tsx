import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from '@/lib/constants'
import { getNavigationGroup, NAVIGATION_GROUPS, type NavigationGroupId } from './navigation-model'

export function Sidebar() {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const [groupDisclosures, setGroupDisclosures] = useState<
    Map<NavigationGroupId, { pathname: string; expanded: boolean }>
  >(() => new Map())
  const activeGroup = getNavigationGroup(pathname)

  const toggleGroup = (groupId: NavigationGroupId, expanded: boolean) => {
    setGroupDisclosures((current) => {
      const next = new Map(current)
      next.set(groupId, { pathname, expanded: sidebarCollapsed || !expanded })
      return next
    })

    if (sidebarCollapsed) toggleSidebar()
  }

  return (
    <aside
      aria-label={t('navigation.primary')}
      data-collapsed={sidebarCollapsed ? 'true' : 'false'}
      className="native-sidebar hidden h-full shrink-0 flex-col overflow-hidden md:flex"
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
    >
      <div
        className={cn('flex h-16 shrink-0 items-center px-3', sidebarCollapsed && 'justify-center')}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          {!sidebarCollapsed ? (
            <span className="min-w-0">
              <strong className="block text-[15px] leading-tight font-semibold">Shikin</strong>
              <span className="text-muted-foreground block text-[11px] leading-tight">
                {t('app.tagline')}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2" aria-label={t('navigation.main')}>
        {NAVIGATION_GROUPS.map((group) => {
          const active = group.id === activeGroup.id
          const Icon = group.icon
          const label = t(group.labelKey, group.fallbackLabel)

          if (group.routes.length === 1) {
            const route = group.routes[0]
            const routeActive = route.path === pathname
            return (
              <Link
                key={group.id}
                to={route.path}
                title={sidebarCollapsed ? label : undefined}
                aria-label={sidebarCollapsed ? label : undefined}
                aria-current={routeActive ? 'page' : undefined}
                className={cn(
                  'sidebar-link',
                  routeActive && 'sidebar-link-active',
                  sidebarCollapsed && 'justify-center px-0'
                )}
              >
                <Icon size={17} aria-hidden="true" />
                {!sidebarCollapsed ? <span className="min-w-0">{label}</span> : null}
              </Link>
            )
          }

          const disclosure = groupDisclosures.get(group.id)
          const expanded =
            !sidebarCollapsed && (disclosure?.pathname === pathname ? disclosure.expanded : active)
          const groupButtonId = `sidebar-group-${group.id}-button`
          const groupPanelId = `sidebar-group-${group.id}-routes`

          return (
            <div key={group.id}>
              <button
                id={groupButtonId}
                type="button"
                aria-controls={groupPanelId}
                aria-expanded={expanded}
                aria-label={sidebarCollapsed ? label : undefined}
                title={
                  sidebarCollapsed
                    ? label
                    : expanded
                      ? t('navigation.collapseGroup', { section: label })
                      : t('navigation.expandGroup', { section: label })
                }
                onClick={() => toggleGroup(group.id, expanded)}
                className={cn(
                  'sidebar-link w-full text-left',
                  active && 'sidebar-group-active',
                  sidebarCollapsed && 'justify-center px-0'
                )}
              >
                <Icon size={17} aria-hidden="true" />
                {!sidebarCollapsed ? (
                  <>
                    <span className="min-w-0 flex-1">{label}</span>
                    {expanded ? (
                      <ChevronDown className="sidebar-group-chevron" size={15} aria-hidden="true" />
                    ) : (
                      <ChevronRight
                        className="sidebar-group-chevron"
                        size={15}
                        aria-hidden="true"
                      />
                    )}
                  </>
                ) : null}
              </button>
              <div
                id={groupPanelId}
                role="group"
                aria-labelledby={groupButtonId}
                className="sidebar-children"
                hidden={!expanded}
              >
                {group.routes.map((route) => {
                  const routeActive = route.path === pathname
                  const RouteIcon = route.icon
                  return (
                    <Link
                      key={route.path}
                      to={route.path}
                      aria-current={routeActive ? 'page' : undefined}
                      className={cn(
                        'sidebar-child-link',
                        routeActive && 'sidebar-child-link-active'
                      )}
                    >
                      <RouteIcon size={14} aria-hidden="true" />
                      <span>{t(route.labelKey, route.fallbackLabel)}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="native-sidebar-footer p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-expanded={!sidebarCollapsed}
          className={cn('sidebar-footer-button', sidebarCollapsed && 'justify-center px-0')}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={17} aria-hidden="true" />
          ) : (
            <ChevronLeft size={17} aria-hidden="true" />
          )}
          {!sidebarCollapsed ? <span>{t('sidebar.collapse')}</span> : null}
        </button>
      </div>
    </aside>
  )
}
