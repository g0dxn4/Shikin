import { describe, expect, it } from 'vitest'
import enDebt from '@/i18n/locales/en/debtPayoff.json'
import esDebt from '@/i18n/locales/es/debtPayoff.json'
import enForecast from '@/i18n/locales/en/forecast.json'
import esForecast from '@/i18n/locales/es/forecast.json'
import { calculatePayoffPlan } from '@/lib/debt-service'
import {
  FORECAST_SERIES_COLOR,
  debtLineColor,
  debtTrajectoryRows,
  forecastProjectionRows,
  strategyTrajectoryColor,
} from '@/components/planning-scenarios/scenario-series'

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key)
  )
}

describe('planning scenario series', () => {
  it('graphs only actual payoff schedule rows in the selected currency set', () => {
    const usd = { id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 10 }
    const plan = calculatePayoffPlan([usd], 'avalanche', 0)
    const rows = debtTrajectoryRows(plan.schedule, [usd.id])

    expect(rows).toHaveLength(plan.schedule.length)
    expect(rows[0]).toEqual({
      month: plan.schedule[0].month,
      total: plan.schedule[0].totalBalance,
      balances: { usd: plan.schedule[0].balances.usd },
    })
    expect(rows.some((row) => row.month === 0)).toBe(false)
    expect(rows[rows.length - 1]?.total).toBe(plan.schedule[plan.schedule.length - 1]?.totalBalance)
  })

  it('copies forecast points without fabricating dates or recurrence events', () => {
    const points = [
      { date: '2028-01-01', projected: 10000, optimistic: 11000, pessimistic: 9000 },
      { date: '2028-01-02', projected: 9900, optimistic: 11100, pessimistic: 8700 },
    ]

    expect(forecastProjectionRows(points)).toEqual(points)
    expect(forecastProjectionRows(points).map((point) => point.date)).toEqual([
      '2028-01-01',
      '2028-01-02',
    ])
  })

  it('uses chart tokens instead of the primary field', () => {
    expect(strategyTrajectoryColor('avalanche')).toBe('var(--color-chart-1)')
    expect(strategyTrajectoryColor('snowball')).toBe('var(--color-chart-3)')
    expect(debtLineColor(0, 'avalanche')).not.toBe('var(--color-chart-1)')
    expect(debtLineColor(0, 'snowball')).not.toBe('var(--color-chart-3)')
    expect(FORECAST_SERIES_COLOR.projected).toBe('var(--color-chart-1)')
    expect(FORECAST_SERIES_COLOR.optimistic).toBe('var(--color-chart-2)')
    expect(FORECAST_SERIES_COLOR.pessimistic).toBe('var(--color-chart-5)')
    expect(JSON.stringify(FORECAST_SERIES_COLOR)).not.toContain('primary')
    expect(JSON.stringify(FORECAST_SERIES_COLOR)).not.toContain('accent')
  })

  it('keeps English and Spanish planning copy keys aligned', () => {
    expect(keyPaths(enDebt).sort()).toEqual(keyPaths(esDebt).sort())
    expect(keyPaths(enForecast).sort()).toEqual(keyPaths(esForecast).sort())
    expect(enDebt.hero.disclaimer.length).toBeGreaterThan(0)
    expect(esDebt.hero.disclaimer.length).toBeGreaterThan(0)
    expect(enForecast.table.independent.length).toBeGreaterThan(0)
    expect(esForecast.table.independent.length).toBeGreaterThan(0)
  })
})
