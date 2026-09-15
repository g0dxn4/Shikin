import { Link } from 'react-router'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { NAVIGATION_GROUPS } from './navigation-model'

interface BottomNavProps {
  activeHref: string
}

const PRIMARY_GROUP_IDS = new Set(['overview', 'transactions', 'accounts'])

export function BottomNav({ activeHref }: BottomNavProps) {
  const { t } = useTranslation('common')
  const primaryGroups = NAVIGATION_GROUPS.filter((group) => PRIMARY_GROUP_IDS.has(group.id))
  const moreActive = !primaryGroups.some((group) =>
    group.routes.some((route) => route.path === activeHref)
  )

  return (
    <nav className="native-bottom-nav md:hidden" aria-label={t('navigation.mobile')}>
      {primaryGroups.map((group) => {
        const active = group.routes.some((route) => route.path === activeHref)
        const Icon = group.icon
        const label = t(group.labelKey, group.fallbackLabel)
        return (
          <Link
            key={group.id}
            to={group.homePath}
            className={cn('bottom-nav-link', active && 'bottom-nav-link-active')}
            {...(active ? { 'aria-current': 'page' as const } : {})}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        )
      })}

      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={t('navigation.more')}
            className={cn('bottom-nav-link', moreActive && 'bottom-nav-link-active')}
          >
            <Menu size={20} aria-hidden="true" />
            <span>{t('navigation.moreShort')}</span>
          </button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[82dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pr-10 text-left">
            <SheetTitle>{t('navigation.allDestinations')}</SheetTitle>
            <SheetDescription>{t('navigation.allDestinationsDescription')}</SheetDescription>
          </SheetHeader>
          <nav className="mt-5 space-y-5" aria-label={t('navigation.more')}>
            {NAVIGATION_GROUPS.map((group) => (
              <section key={group.id} aria-labelledby={`mobile-nav-${group.id}`}>
                <h3
                  id={`mobile-nav-${group.id}`}
                  className="text-muted-foreground mb-2 px-1 text-xs font-semibold"
                >
                  {t(group.labelKey, group.fallbackLabel)}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {group.routes.map((route) => {
                    const active = route.path === activeHref
                    const Icon = route.icon
                    return (
                      <SheetClose key={route.path} asChild>
                        <Link
                          to={route.path}
                          className={cn(
                            'mobile-destination',
                            active && 'mobile-destination-active'
                          )}
                          {...(active ? { 'aria-current': 'page' as const } : {})}
                        >
                          <Icon size={17} aria-hidden="true" />
                          <span>{t(route.labelKey, route.fallbackLabel)}</span>
                        </Link>
                      </SheetClose>
                    )
                  })}
                </div>
              </section>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </nav>
  )
}
