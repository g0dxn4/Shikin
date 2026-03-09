import { cn } from '@/lib/utils'

interface FilterPillsProps {
  options: { label: string; value: string; count?: number }[]
  selected: string
  onChange: (value: string) => void
  className?: string
}

export function FilterPills({ options, selected, onChange, className }: FilterPillsProps) {
  return (
    <div className={cn('flex gap-2', className)}>
      {options.map((option) => {
        const isActive = option.value === selected
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-full px-4 py-1.5 font-mono text-xs transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
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
