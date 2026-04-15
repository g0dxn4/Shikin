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
}

interface BottomNavProps {
  items: NavItem[]
  moreItems?: NavItem[]
  activeHref: string
}

export function BottomNav({ items, moreItems = [], activeHref }: BottomNavProps) {
  const moreActive = moreItems.some((item) => item.href === activeHref)

  return (
    <nav className="bg-surface fixed right-0 bottom-0 left-0 z-50 flex h-14 items-center justify-around border-t border-white/[0.06] md:hidden">
      {items.map((item) => {
        const isActive = item.href === activeHref
        return (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              'flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] transition-colors',
              isActive ? 'text-accent' : 'text-muted-foreground'
            )}
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
                'flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] transition-colors',
                moreActive ? 'text-accent' : 'text-muted-foreground'
              )}
            >
              <Menu size={20} />
              <span>More</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="bg-surface rounded-t-2xl border-white/[0.06] px-4 pb-8"
          >
            <SheetHeader>
              <SheetTitle>More pages</SheetTitle>
              <SheetDescription>Open the rest of Shikin&apos;s pages on mobile.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {moreItems.map((item) => {
                const isActive = item.href === activeHref

                return (
                  <SheetClose key={item.href} asChild>
                    <Link
                      to={item.href}
                      className={cn(
                        'glass-card flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors',
                        isActive ? 'text-accent' : 'text-foreground'
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  </SheetClose>
                )
              })}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </nav>
  )
}
