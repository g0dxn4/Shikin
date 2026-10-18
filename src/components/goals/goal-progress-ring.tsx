import { GoalIcon } from './goal-icon'

const RING_RADIUS = 52
const RING_SIZE = 120
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface GoalProgressRingProps {
  progress: number
  color: string
  icon?: string | null
  label: string
  valueText: string
}

/** Thin stored-progress ring. Same dash pattern as the overview goal ring, no chart library. */
export function GoalProgressRing({
  progress,
  color,
  icon,
  label,
  valueText,
}: GoalProgressRingProps) {
  const recorded = Number.isFinite(progress) ? progress : 0
  const clamped = Math.min(Math.max(recorded, 0), 100)
  const dash = (clamped / 100) * RING_CIRCUMFERENCE
  const shown = Number.isFinite(progress) ? Math.round(progress) : null

  return (
    <div
      className="relative h-36 w-36 shrink-0"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={valueText}
    >
      <svg
        className="h-full w-full -rotate-90"
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden="true"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="2.5"
        />
        {dash > 0 ? (
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${RING_CIRCUMFERENCE}`}
          />
        ) : null}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
        <GoalIcon icon={icon} size={18} className="text-foreground" />
        <span className="text-foreground text-sm font-medium tabular-nums">
          {shown === null ? '—' : `${shown}%`}
        </span>
      </div>
    </div>
  )
}
