import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

const transactionViews = ['timeline', 'ledger', 'review'] as const

export type TransactionViewTab = (typeof transactionViews)[number]

/**
 * Roving tablist for Timeline / Ledger / Review. Arrow, Home, and End match the
 * Overview tabs: they move selection and focus, and do not wrap a second widget.
 */
export function TransactionViewTabs({
  label,
  value,
  labels,
  onChange,
}: {
  label: string
  value: TransactionViewTab
  labels: Record<TransactionViewTab, string>
  onChange: (view: TransactionViewTab) => void
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % transactionViews.length
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + transactionViews.length) % transactionViews.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = transactionViews.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = transactionViews[nextIndex]
    onChange(next)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="border-border bg-muted grid w-full min-w-0 grid-cols-3 gap-0.5 rounded-lg border p-0.5 md:flex md:w-auto"
    >
      {transactionViews.map((view, index) => {
        const selected = value === view
        return (
          <button
            key={view}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            id={`transactions-${view}-tab`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`transactions-${view}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(view)}
            onKeyDown={(event) => selectFromKeyboard(event, index)}
            className={cn(
              'focus-visible:ring-ring h-11 min-h-11 min-w-0 rounded-md px-1 text-center text-[11px] leading-tight font-medium break-words whitespace-normal focus-visible:ring-2 focus-visible:outline-none md:h-8 md:min-h-8 md:px-3 md:text-xs md:whitespace-nowrap',
              selected
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
            )}
          >
            {labels[view]}
          </button>
        )
      })}
    </div>
  )
}
