import { cn } from '@/lib/utils'

interface FilterPillsProps {
  options: { label: string; value: string; count?: number }[]
  selected: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}

export function FilterPills({
  options,
  selected,
  onChange,
  className,
  ariaLabel,
}: FilterPillsProps) {
  return (
    <div className={cn('flex gap-2', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = option.value === selected
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
            className={cn(
              'rounded-full px-4 py-1.5 font-mono text-xs transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn('ml-1.5', isActive ? 'opacity-70' : 'opacity-50')}>
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
