import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ChevronLeft, ChevronRight, Moon, Palette, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from '@/lib/constants'
import {
  getAppliedAppearance,
  setAppearance,
  subscribeAppearance,
  type Appearance,
} from '@/lib/theme'
import { NAVIGATION_GROUPS } from './navigation-model'

export function Sidebar() {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const [appearance, setLocalAppearance] = useState<Appearance>(() => getAppliedAppearance())

  useEffect(() => subscribeAppearance(setLocalAppearance), [])

  const switchNativeAppearance = () => {
    const next = appearance === 'native-dark' ? 'native-light' : 'native-dark'
    void setAppearance(next)
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
          const active = group.routes.some((route) => route.path === pathname)
          const Icon = group.icon
          const label = t(group.labelKey, group.fallbackLabel)
          return (
            <Link
              key={group.id}
              to={group.homePath}
              title={sidebarCollapsed ? label : undefined}
              aria-label={sidebarCollapsed ? label : undefined}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'sidebar-link',
                active && 'sidebar-link-active',
                sidebarCollapsed && 'justify-center px-0'
              )}
            >
              <Icon size={17} aria-hidden="true" />
              {!sidebarCollapsed ? <span>{label}</span> : null}
            </Link>
          )
        })}
      </nav>

      <div className="native-sidebar-footer space-y-1 p-2">
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
        <button
          type="button"
          onClick={switchNativeAppearance}
          aria-label={t('appearance.switch', {
            appearance: appearance === 'native-dark' ? t('appearance.light') : t('appearance.dark'),
          })}
          className={cn('sidebar-footer-button', sidebarCollapsed && 'justify-center px-0')}
        >
          {appearance === 'native-dark' ? (
            <Moon size={16} aria-hidden="true" />
          ) : appearance === 'custom' ? (
            <Palette size={16} aria-hidden="true" />
          ) : (
            <Sun size={16} aria-hidden="true" />
          )}
          {!sidebarCollapsed ? (
            <>
              <span className="flex-1 text-left">{t('appearance.label')}</span>
              <strong className="text-foreground text-xs font-semibold">
                {appearance === 'native-dark'
                  ? t('appearance.dark')
                  : appearance === 'custom'
                    ? t('appearance.custom')
                    : t('appearance.light')}
              </strong>
            </>
          ) : null}
        </button>
      </div>
    </aside>
  )
}
