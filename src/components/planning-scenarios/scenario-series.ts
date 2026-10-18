import type { MonthlySnapshot } from '@/lib/debt-service'
import type { ForecastPoint } from '@/lib/forecast-service'
import type { DebtStrategy } from '@/stores/debt-store'

/** Trajectory stroke for the selected payoff strategy. Never primary or accent. */
export const STRATEGY_TRAJECTORY_COLOR = {
  avalanche: 'var(--color-chart-1)',
  snowball: 'var(--color-chart-3)',
} as const

const DEBT_LINE_COLORS = [
  'var(--color-chart-2)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-1)',
  'var(--color-chart-3)',
] as const

/** Forecast series. Projected is the neutral chart-1 wash, not a primary field. */
export const FORECAST_SERIES_COLOR = {
  projected: 'var(--color-chart-1)',
  optimistic: 'var(--color-chart-2)',
  pessimistic: 'var(--color-chart-5)',
} as const

export function strategyTrajectoryColor(strategy: DebtStrategy): string {
  return STRATEGY_TRAJECTORY_COLOR[strategy]
}

export function debtLineColor(index: number, strategy: DebtStrategy): string {
  const reserved = strategyTrajectoryColor(strategy)
  const palette = DEBT_LINE_COLORS.filter((color) => color !== reserved)
  return palette[index % palette.length]
}

export interface DebtTrajectoryRow {
  month: number
  total: number
  balances: Record<string, number>
}

/** Actual schedule rows only. Does not insert a synthetic opening month. */
export function debtTrajectoryRows(
  schedule: MonthlySnapshot[],
  debtIds: string[]
): DebtTrajectoryRow[] {
  return schedule.map((snapshot) => ({
    month: snapshot.month,
    total: snapshot.totalBalance,
    balances: Object.fromEntries(debtIds.map((id) => [id, snapshot.balances[id] ?? 0])),
  }))
}

export interface ForecastProjectionRow {
  date: string
  projected: number
  optimistic: number
  pessimistic: number
}

/** One row per service point. Does not append recurrence events or invented dates. */
export function forecastProjectionRows(points: ForecastPoint[]): ForecastProjectionRow[] {
  return points.map((point) => ({
    date: point.date,
    projected: point.projected,
    optimistic: point.optimistic,
    pessimistic: point.pessimistic,
  }))
}
