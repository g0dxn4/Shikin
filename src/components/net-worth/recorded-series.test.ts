import { describe, expect, it } from 'vitest'
import {
  RECORDED_AREA_FILL_OPACITY,
  RECORDED_BAR_SLOT_PX,
  isSafeRecordedPoint,
  recordedBarPlotMinWidth,
  recordedSeriesVisual,
} from '@/components/net-worth/recorded-series'

describe('recorded net worth series', () => {
  it('keeps the default comparison faint and the compare toggle on semantic tokens', () => {
    expect(recordedSeriesVisual('netWorth', false)).toEqual(
      expect.objectContaining({
        stroke: 'var(--color-chart-1)',
        fill: 'var(--color-chart-1)',
        strokeWidth: 2,
        areaFillOpacity: RECORDED_AREA_FILL_OPACITY,
      })
    )
    expect(recordedSeriesVisual('assets', false).stroke).toBe('var(--color-chart-3)')
    expect(recordedSeriesVisual('liabilities', false)).toEqual(
      expect.objectContaining({
        stroke: 'var(--color-chart-3)',
        strokeOpacity: 0.28,
        strokeDasharray: '3 3',
      })
    )
    expect(recordedSeriesVisual('assets', true).stroke).toBe('var(--color-chart-2)')
    expect(recordedSeriesVisual('liabilities', true).fill).toBe('var(--color-chart-5)')
    expect(RECORDED_AREA_FILL_OPACITY).toBeGreaterThan(0)
    expect(RECORDED_AREA_FILL_OPACITY).toBeLessThanOrEqual(0.2)
  })

  it('sizes bar slots from recorded points without inventing dates', () => {
    expect(recordedBarPlotMinWidth(0)).toBe(0)
    expect(recordedBarPlotMinWidth(1)).toBe(RECORDED_BAR_SLOT_PX)
    expect(recordedBarPlotMinWidth(40)).toBe(40 * RECORDED_BAR_SLOT_PX)
    expect(
      isSafeRecordedPoint({ date: '2024-01-01', netWorth: 1, assets: 2, liabilities: 0 })
    ).toBe(true)
    expect(
      isSafeRecordedPoint({
        date: '2024-01-01',
        netWorth: Number.MAX_SAFE_INTEGER + 2,
        assets: 1,
        liabilities: 1,
      })
    ).toBe(false)
  })
})
