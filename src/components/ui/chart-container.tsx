import { cn } from '@/lib/utils'

interface ChartContainerProps {
  title: string
  periods?: { label: string; value: string }[]
  selectedPeriod?: string
  onPeriodChange?: (value: string) => void
  children: React.ReactNode
  className?: string
}

export function ChartContainer({
  title,
  periods,
  selectedPeriod,
  onPeriodChange,
  children,
  className,
}: ChartContainerProps) {
  return (
    <div className={cn('glass-card p-5', className)}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold">{title}</h3>
        {periods && periods.length > 0 && (
          <div className="flex gap-1">
            {periods.map((period) => {
              const isActive = period.value === selectedPeriod
              return (
                <button
                  key={period.value}
                  type="button"
                  onClick={() => onPeriodChange?.(period.value)}
                  className={cn(
                    'rounded-full px-3 py-1 font-mono text-[10px] transition-colors',
                    isActive
                      ? 'bg-accent/15 text-accent'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {period.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
