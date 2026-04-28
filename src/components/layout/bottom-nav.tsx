import { Link } from 'react-router'
import { Menu } from 'lucide-react'
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

interface NavItem {
  icon: React.ReactNode
  label: string
  href: string
  activeHrefs?: string[]
}

interface BottomNavProps {
  items: NavItem[]
  moreItems?: NavItem[]
  activeHref: string
}

export function BottomNav({ items, moreItems = [], activeHref }: BottomNavProps) {
  const isItemActive = (item: NavItem) =>
    item.href === activeHref || item.activeHrefs?.includes(activeHref)
  const moreActive = moreItems.some(isItemActive)

  return (
    <nav
      className="bg-surface/85 fixed right-4 bottom-4 left-4 z-50 flex h-16 items-center justify-around rounded-full border border-white/[0.12] px-2 pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black/40 backdrop-blur-2xl md:hidden"
      aria-label="Mobile primary navigation"
    >
      {items.map((item) => {
        const isActive = isItemActive(item)
        return (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              'focus-visible:ring-ring flex h-11 min-w-12 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-[10px] font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none',
              isActive
                ? 'text-accent-hover bg-white/[0.1]'
                : 'text-muted-foreground hover:text-foreground'
            )}
            {...(isActive ? { 'aria-current': 'page' } : {})}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        )
      })}
      {moreItems.length > 0 && (
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="More pages"
              className={cn(
                'focus-visible:ring-ring flex h-11 min-w-12 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-[10px] font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none',
                moreActive
                  ? 'text-accent-hover bg-white/[0.1]'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Menu size={20} aria-hidden="true" />
              <span>More</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="bg-surface/95 rounded-t-[28px] border-white/[0.1] px-4 pb-8 backdrop-blur-2xl"
          >
            <SheetHeader>
              <SheetTitle>More pages</SheetTitle>
              <SheetDescription>Open the rest of Shikin&apos;s pages on mobile.</SheetDescription>
            </SheetHeader>
            <nav className="mt-4 grid grid-cols-2 gap-2" aria-label="Mobile more navigation">
              {moreItems.map((item) => {
                const isActive = isItemActive(item)

                return (
                  <SheetClose key={item.href} asChild>
                    <Link
                      to={item.href}
                      className={cn(
                        'liquid-card focus-visible:ring-ring flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                        isActive ? 'text-accent-hover' : 'text-foreground'
                      )}
                      {...(isActive ? { 'aria-current': 'page' } : {})}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  </SheetClose>
                )
              })}
            </nav>
          </SheetContent>
        </Sheet>
      )}
    </nav>
  )
}
