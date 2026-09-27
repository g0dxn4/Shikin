import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ActionDisclosureItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  expanded?: boolean
}

interface ActionDisclosureProps {
  label: string
  ariaLabel?: string
  trigger?: ReactNode
  actions: ActionDisclosureItem[]
  align?: 'start' | 'end'
  inline?: boolean
  className?: string
  triggerClassName?: string
}

/**
 * A small disclosure of ordinary buttons. This intentionally does not use menu ARIA:
 * actions keep native button keyboard behavior and are reached in normal tab order.
 */
export function ActionDisclosure({
  label,
  ariaLabel,
  trigger,
  actions,
  align = 'end',
  inline = false,
  className,
  triggerClassName,
}: ActionDisclosureProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ top: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || inline) return

    const updatePlacement = () => {
      const root = rootRef.current
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!root || !trigger || !panel) return

      const rootRect = root.getBoundingClientRect()
      const triggerRect = trigger.getBoundingClientRect()
      const mainRect = root.closest('main')?.getBoundingClientRect()
      const bottomNav = document.querySelector<HTMLElement>('.native-bottom-nav')
      const navRect =
        bottomNav && getComputedStyle(bottomNav).display !== 'none'
          ? bottomNav.getBoundingClientRect()
          : null
      const gap = 4
      const topEdge = Math.max(0, mainRect?.top ?? 0) + gap
      const bottomEdge =
        Math.min(
          window.innerHeight,
          mainRect?.bottom ?? window.innerHeight,
          navRect && navRect.top < window.innerHeight && navRect.bottom > 0
            ? navRect.top
            : window.innerHeight
        ) - gap
      // scrollHeight stays intrinsic even when the panel has already been clamped.
      const height = Math.max(
        panel.scrollHeight + panel.clientTop * 2,
        panel.getBoundingClientRect().height
      )
      const belowTop = Math.max(topEdge, triggerRect.bottom + gap)
      const aboveBottom = Math.min(bottomEdge, triggerRect.top - gap)
      const belowSpace = Math.max(0, bottomEdge - belowTop)
      const aboveSpace = Math.max(0, aboveBottom - topEdge)
      const above = height > belowSpace && (height <= aboveSpace || aboveSpace > belowSpace)
      const maxHeight = above ? aboveSpace : belowSpace
      const top = (above ? aboveBottom - Math.min(height, maxHeight) : belowTop) - rootRect.top
      setPlacement((previous) =>
        previous?.top === top && previous.maxHeight === maxHeight ? previous : { top, maxHeight }
      )
    }

    updatePlacement()
    // The route scrolls in main, not window; capture also covers nested scroll containers.
    window.addEventListener('scroll', updatePlacement, true)
    window.addEventListener('resize', updatePlacement)
    return () => {
      window.removeEventListener('scroll', updatePlacement, true)
      window.removeEventListener('resize', updatePlacement)
    }
  }, [open, inline, actions.length])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const closeAndFocusTrigger = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative flex flex-col',
        align === 'end' ? 'items-end' : 'items-start',
        className
      )}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        closeAndFocusTrigger()
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className={cn('min-h-11 md:min-h-9', triggerClassName)}
        aria-label={ariaLabel ?? (trigger ? label : undefined)}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger ?? (
          <>
            {label}
            <ChevronDown
              aria-hidden="true"
              className={cn('transition-transform', open ? 'rotate-180' : '')}
            />
          </>
        )}
      </Button>
      {open ? (
        <div
          ref={panelRef}
          id={id}
          style={
            !inline && placement
              ? ({ top: placement.top, maxHeight: placement.maxHeight } satisfies CSSProperties)
              : undefined
          }
          className={cn(
            'border-border bg-surface z-30 min-w-48 rounded-lg border p-1 shadow-[var(--shadow-dialog)]',
            inline
              ? 'relative mt-1'
              : cn(
                  'absolute top-full overflow-y-auto overscroll-contain',
                  align === 'end' ? 'right-0' : 'left-0'
                )
          )}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              aria-expanded={action.expanded}
              className={cn(
                'hover:bg-muted focus-visible:ring-ring flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                action.destructive ? 'text-destructive' : 'text-foreground'
              )}
              onClick={() => {
                closeAndFocusTrigger()
                action.onSelect()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
