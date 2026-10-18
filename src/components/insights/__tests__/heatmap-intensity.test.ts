import { describe, expect, it } from 'vitest'
import { heatmapCellStyle, heatmapLegendStyles } from '@/components/insights/heatmap-intensity'

describe('heatmap intensity', () => {
  it('distinguishes recorded intensity without an accent fill', () => {
    const empty = heatmapCellStyle(null, 100)
    const zero = heatmapCellStyle(0, 100)
    const low = heatmapCellStyle(10, 100)
    const high = heatmapCellStyle(100, 100)
    const styles = [empty, zero, low, high, ...heatmapLegendStyles()]

    expect(JSON.stringify(styles)).not.toMatch(/accent|primary|violet|#9448d8|#c4a0e3/i)
    expect(zero.backgroundColor).not.toBe(low.backgroundColor)
    expect(low.backgroundColor).not.toBe(high.backgroundColor)
    expect(empty.backgroundColor).not.toBe(high.backgroundColor)
    expect(heatmapLegendStyles().length).toBeGreaterThan(3)
  })
})
