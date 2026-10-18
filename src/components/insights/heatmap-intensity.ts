import type { CSSProperties } from 'react'

/** Neutral chart-1 mixes. Zero stays muted so an empty day is not a pale accent field. */
const POSITIVE_MIX = [18, 32, 46, 62, 78, 100] as const

function mix(percent: number): string {
  return `color-mix(in srgb, var(--color-chart-1) ${percent}%, var(--color-muted))`
}

export function heatmapCellStyle(value: number | null, maxSpend: number): CSSProperties {
  if (value === null) {
    return { backgroundColor: 'var(--color-muted)', opacity: 0.4 }
  }
  if (value <= 0 || maxSpend <= 0) {
    return { backgroundColor: 'var(--color-muted)' }
  }
  const ratio = Math.min(1, value / maxSpend)
  const index =
    ratio < 0.15 ? 0 : ratio < 0.3 ? 1 : ratio < 0.45 ? 2 : ratio < 0.6 ? 3 : ratio < 0.8 ? 4 : 5
  return { backgroundColor: mix(POSITIVE_MIX[index]) }
}

export function heatmapLegendStyles(): CSSProperties[] {
  return [
    { backgroundColor: 'var(--color-muted)' },
    ...POSITIVE_MIX.map((percent) => ({ backgroundColor: mix(percent) })),
  ]
}
