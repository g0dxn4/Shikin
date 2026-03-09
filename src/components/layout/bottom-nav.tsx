import { Link } from 'react-router'
import { cn } from '@/lib/utils'

interface BottomNavProps {
  items: { icon: React.ReactNode; label: string; href: string }[]
  activeHref: string
}

export function BottomNav({ items, activeHref }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t border-white/[0.06] bg-surface md:hidden">
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
    </nav>
  )
}
