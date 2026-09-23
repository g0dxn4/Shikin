import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ActionDisclosureItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}

interface ActionDisclosureProps {
  label: string
  ariaLabel?: string
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
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn('transition-transform', open ? 'rotate-180' : '')}
        />
      </Button>
      {open ? (
        <div
          id={id}
          className={cn(
            'border-border bg-surface z-30 mt-1 min-w-48 rounded-lg border p-1 shadow-[var(--shadow-dialog)]',
            inline ? 'relative' : cn('absolute top-full', align === 'end' ? 'right-0' : 'left-0')
          )}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
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
