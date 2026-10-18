import { cn } from '@/lib/utils'
import type { BudgetUsageVisual } from '@/components/budgets/budget-visual-model'

const TRACK_TONE = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  unavailable: 'bg-transparent',
} as const

const SIZE = 96
const STROKE = 8
const CENTER = SIZE / 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const TONE_CLASS = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  unavailable: 'text-muted-foreground',
} as const

export function BudgetUsageRing({
  visual,
  label,
  percentText,
}: {
  visual: BudgetUsageVisual
  label: string
  percentText: string
}) {
  const capped = visual.filled && visual.visualPercent !== null && visual.visualPercent >= 100
  const showArc = visual.filled && visual.visualPercent !== null && visual.visualPercent > 0
  const dash =
    showArc && visual.visualPercent !== null
      ? Math.round((visual.visualPercent / 100) * CIRCUMFERENCE * 100) / 100
      : 0
  const tone = TONE_CLASS[visual.tone]

  return (
    <div
      className={cn('relative size-14 shrink-0 overflow-hidden', tone)}
      role={visual.filled ? 'progressbar' : 'img'}
      aria-label={label}
      aria-valuemin={visual.filled ? 0 : undefined}
      aria-valuemax={visual.filled ? 100 : undefined}
      aria-valuenow={visual.filled ? (visual.visualPercent ?? 0) : undefined}
      aria-valuetext={visual.filled && visual.percent !== null ? `${visual.percent}%` : undefined}
      data-budget-usage-filled={visual.filled ? 'true' : 'false'}
      data-budget-usage-percent={visual.percent ?? ''}
      data-budget-usage-visual-percent={visual.visualPercent ?? ''}
      data-budget-usage-tone={visual.tone}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full" aria-hidden="true">
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={STROKE}
        />
        {showArc ? (
          <circle
            data-budget-usage-arc={visual.visualPercent ?? 0}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap={capped ? 'butt' : 'round'}
            strokeDasharray={capped ? undefined : `${dash} ${Math.max(CIRCUMFERENCE - dash, 0)}`}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            className="transition-[stroke-dasharray] duration-300 motion-reduce:transition-none"
          />
        ) : null}
      </svg>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 grid place-items-center px-1 text-center leading-none font-medium tabular-nums',
          percentText.length > 4 ? 'text-[10px]' : 'text-xs'
        )}
      >
        {percentText}
      </span>
    </div>
  )
}

/** Slim scan track. Same capped visual percent and tone as the ring; no second percent. */
export function BudgetUsageTrack({
  visual,
  className,
}: {
  visual: BudgetUsageVisual
  className?: string
}) {
  const showFill = visual.filled && visual.visualPercent !== null && visual.visualPercent > 0

  return (
    <div
      className={cn('bg-border h-2 w-full min-w-0 overflow-hidden rounded-full', className)}
      data-budget-usage-track=""
      data-budget-usage-track-filled={visual.filled ? 'true' : 'false'}
      data-budget-usage-track-visual-percent={visual.visualPercent ?? ''}
      data-budget-usage-track-tone={visual.tone}
      aria-hidden="true"
    >
      {showFill && visual.visualPercent !== null ? (
        <div
          data-budget-usage-track-fill=""
          className={cn(
            'h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
            TRACK_TONE[visual.tone]
          )}
          style={{ width: `${visual.visualPercent}%` }}
        />
      ) : null}
    </div>
  )
}
