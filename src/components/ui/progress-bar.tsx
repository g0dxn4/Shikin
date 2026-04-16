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
  accent: '#bf5af2',
  success: '#22c55e',
  warning: '#f59e0b',
  destructive: '#ef4444',
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
          'w-full overflow-hidden rounded-full bg-white/[0.06]',
          size === 'sm' ? 'h-1.5' : 'h-2'
        )}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
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
