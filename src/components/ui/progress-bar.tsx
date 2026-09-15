import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number
  max?: number
  color?: 'accent' | 'success' | 'warning' | 'destructive'
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}

const COLOR_MAP = {
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  destructive: 'var(--color-destructive)',
} as const

export function ProgressBar({
  value,
  max,
  color = 'accent',
  showLabel = false,
  size = 'md',
  className,
  ariaLabel,
}: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), 100)
  const fill = COLOR_MAP[color]
  const ariaValueNow = max !== undefined ? Math.round(value) : Math.round(clamped)
  const ariaValueMax = max ?? 100

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={ariaValueNow}
        aria-valuemin={0}
        aria-valuemax={ariaValueMax}
        className={cn(
          'bg-muted w-full overflow-hidden rounded-full',
          size === 'sm' ? 'h-1.5' : 'h-2'
        )}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${clamped}%`, backgroundColor: fill }}
        />
      </div>
      {showLabel && (
        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
          {max !== undefined ? `${Math.round(value)}/${max}` : `${Math.round(value)}%`}
        </span>
      )}
    </div>
  )
}
