import { describe, expect, it } from 'vitest'
import {
  forecastBandGeometry,
  forecastUncertaintyBand,
} from '@/components/planning-scenarios/forecast-band-geometry'
import { forecastProjectionRows } from '@/components/planning-scenarios/scenario-series'

describe('forecast band geometry', () => {
  it('pads a positive series without a zero baseline', () => {
    const geometry = forecastBandGeometry([
      { projected: 4_265_840, optimistic: 4_300_000, pessimistic: 4_200_000 },
      { projected: 4_512_730, optimistic: 4_600_000, pessimistic: 4_400_000 },
    ])

    expect(geometry).not.toBeNull()
    expect(geometry?.includesZero).toBe(false)
    expect(geometry?.flat).toBe(false)
    expect(geometry!.domain[0]).toBeGreaterThan(0)
    expect(geometry!.domain[0]).toBeLessThan(4_200_000)
    expect(geometry!.domain[1]).toBeGreaterThan(4_600_000)
    const dataSpan = 4_600_000 - 4_200_000
    const domainSpan = geometry!.domain[1] - geometry!.domain[0]
    expect(dataSpan / domainSpan).toBeGreaterThan(0.5)
  })

  it('includes zero when any outer or projected value is non-positive', () => {
    const negative = forecastBandGeometry([
      { projected: -500_000, optimistic: -490_000, pessimistic: -510_000 },
    ])
    expect(negative?.includesZero).toBe(true)
    expect(negative!.domain[0]).toBeLessThanOrEqual(-510_000)
    expect(negative!.domain[0]).toBeLessThanOrEqual(0)
    expect(negative!.domain[1]).toBeGreaterThanOrEqual(0)

    const touchesZero = forecastBandGeometry([{ projected: 0, optimistic: 100, pessimistic: 0 }])
    expect(touchesZero?.includesZero).toBe(true)
    expect(touchesZero!.domain[0]).toBeLessThanOrEqual(0)
    expect(touchesZero!.domain[1]).toBeGreaterThanOrEqual(100)

    const crossesZero = forecastBandGeometry([{ projected: -20, optimistic: 40, pessimistic: -50 }])
    expect(crossesZero?.includesZero).toBe(true)
    expect(crossesZero!.domain[0]).toBeLessThanOrEqual(-50)
    expect(crossesZero!.domain[1]).toBeGreaterThanOrEqual(40)
  })

  it('keeps a flat line honest and stops a one-centavo rise from filling the plot', () => {
    const value = 1_000_000
    const flat = forecastBandGeometry([{ projected: value, optimistic: value, pessimistic: value }])
    expect(flat?.flat).toBe(true)
    expect(flat?.includesZero).toBe(false)
    expect(flat!.domain[0]).toBeGreaterThan(0)
    expect(flat!.domain[0]).toBeLessThan(value)
    expect(flat!.domain[1]).toBeGreaterThan(value)
    expect(value - flat!.domain[0]).toBeCloseTo(flat!.domain[1] - value, 6)
    expect(flat!.domain[1] - flat!.domain[0]).toBeGreaterThan(value * 0.015)

    const base = 4_265_840
    const wiggle = forecastBandGeometry([
      { projected: base, optimistic: base, pessimistic: base },
      { projected: base + 1, optimistic: base + 1, pessimistic: base + 1 },
    ])
    const span = wiggle!.domain[1] - wiggle!.domain[0]
    expect(wiggle?.flat).toBe(false)
    expect(wiggle!.domain[0]).toBeGreaterThan(0)
    expect(span).toBeGreaterThan(base * 0.015)
    expect(1 / span).toBeLessThan(0.015)
  })

  it('centers an all-zero series on a small display pad instead of a singular domain', () => {
    const geometry = forecastBandGeometry([{ projected: 0, optimistic: 0, pessimistic: 0 }])
    expect(geometry?.flat).toBe(true)
    expect(geometry?.includesZero).toBe(true)
    expect(geometry!.domain[0]).toBeLessThan(0)
    expect(geometry!.domain[1]).toBeGreaterThan(0)
    expect(geometry!.domain[1] - geometry!.domain[0]).toBeLessThan(1_000)
    expect(Math.abs(geometry!.domain[0])).toBeCloseTo(geometry!.domain[1], 6)
  })

  it('builds the band between the outer series without inventing or reordering points', () => {
    const point = { projected: 100, optimistic: 80, pessimistic: 140 }
    expect(forecastUncertaintyBand(point)).toEqual([80, 140])
    expect(point).toEqual({ projected: 100, optimistic: 80, pessimistic: 140 })
    expect(forecastUncertaintyBand({ projected: 10, optimistic: 12, pessimistic: 8 })).toEqual([
      8, 12,
    ])

    const points = [
      { date: '2028-01-01', projected: 10000, optimistic: 11000, pessimistic: 9000 },
      { date: '2028-01-02', projected: 9900, optimistic: 11100, pessimistic: 8700 },
    ]
    expect(forecastProjectionRows(points)).toEqual(points)
    expect(forecastBandGeometry([])).toBeNull()
    expect(
      forecastBandGeometry([{ projected: Number.NaN, optimistic: 1, pessimistic: 1 }])
    ).toBeNull()
  })
})
