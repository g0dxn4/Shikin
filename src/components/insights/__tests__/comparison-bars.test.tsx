import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ComparisonBars } from '@/components/insights/comparison-bars'
import { formatMoney } from '@/lib/money'
import type { SpendingComparison } from '@/stores/spending-insights-store'

const VIEWPORT_WIDTH = 320

function readPx(value: string): number | null {
  if (!value.endsWith('px')) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function layoutSize(element: Element, axis: 'width' | 'height'): number {
  if (!(element instanceof HTMLElement)) return axis === 'width' ? VIEWPORT_WIDTH : 0
  const inline = axis === 'width' ? element.style.width : element.style.height
  const pixels = readPx(inline)
  if (pixels !== null && pixels > 0) return pixels
  if (inline.endsWith('%') && element.parentElement) {
    return (Number.parseFloat(inline) / 100) * layoutSize(element.parentElement, axis)
  }
  const parent = element.parentElement
  if (parent && parent !== document.body && parent !== document.documentElement) {
    const parentSize = layoutSize(parent, axis)
    if (parentSize > 0) return parentSize
  }
  return axis === 'width' ? VIEWPORT_WIDTH : 0
}

class NotifyResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    queueMicrotask(() => {
      const rect = target.getBoundingClientRect()
      this.callback(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      )
    })
  }

  unobserve() {}

  disconnect() {}
}

function comparisons(count: number): SpendingComparison[] {
  return Array.from({ length: count }, (_, index) => ({
    categoryName: `Category ${String(index + 1).padStart(2, '0')}`,
    categoryColor: '#888888',
    current: (index + 1) * 1000,
    previous: (index + 2) * 800,
    change: (index + 1) * 1000 - (index + 2) * 800,
    changePercent: 10,
  }))
}

function renderBars(count: number) {
  return render(
    <div style={{ width: VIEWPORT_WIDTH }}>
      <ComparisonBars
        comparisons={comparisons(count)}
        currency="USD"
        title="Month comparison"
        caption="Month comparison values"
        currentLabel="Current"
        previousLabel="Previous"
        categoryLabel="Category"
      />
    </div>
  )
}

function chartCanvas(scroller: HTMLElement): HTMLElement {
  const canvas = scroller.firstElementChild
  if (!(canvas instanceof HTMLElement)) throw new Error('comparison chart canvas missing')
  return canvas
}

interface DrawnBar {
  name: string
  y: number
  height: number
  width: number
  fill: string | null
}

function drawnBars(scroller: HTMLElement): DrawnBar[] {
  return [...scroller.querySelectorAll('.recharts-bar-rectangle .recharts-rectangle')].map(
    (node) => ({
      name: node.getAttribute('name') ?? '',
      y: Number(node.getAttribute('y')),
      height: Number(node.getAttribute('height')),
      width: Number(node.getAttribute('width')),
      fill: node.getAttribute('fill'),
    })
  )
}

function expectDistinguishablePairs(scroller: HTMLElement, count: number) {
  const bars = drawnBars(scroller)
  expect(bars).toHaveLength(count * 2)
  expect(new Set(bars.map((bar) => bar.fill))).toEqual(
    new Set(['var(--color-chart-1)', 'var(--color-chart-2)'])
  )

  const byName = new Map<string, DrawnBar[]>()
  for (const bar of bars) {
    const group = byName.get(bar.name) ?? []
    group.push(bar)
    byName.set(bar.name, group)
  }
  expect(byName.size).toBe(count)

  const bands = [...byName.entries()]
    .map(([name, pair]) => {
      const ordered = [...pair].sort((a, b) => a.y - b.y)
      return { name, ordered }
    })
    .sort((a, b) => a.ordered[0].y - b.ordered[0].y)

  for (const [index, band] of bands.entries()) {
    expect(band.ordered).toHaveLength(2)
    const [first, second] = band.ordered
    expect(first.height).toBeGreaterThanOrEqual(6)
    expect(second.height).toBeGreaterThanOrEqual(6)
    expect(first.width).toBeGreaterThan(0)
    expect(second.width).toBeGreaterThan(0)
    expect(first.fill).not.toBe(second.fill)
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height)
    expect(second.y - (first.y + first.height)).toBeGreaterThanOrEqual(1)
    if (index > 0) {
      const previous = bands[index - 1].ordered[1]
      expect(first.y - (previous.y + previous.height)).toBeGreaterThanOrEqual(8)
    }
  }
}

describe('ComparisonBars', () => {
  let previousObserver: typeof ResizeObserver | undefined

  beforeEach(() => {
    previousObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = NotifyResizeObserver as unknown as typeof ResizeObserver
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return layoutSize(this, 'width')
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return layoutSize(this, 'height')
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const width = layoutSize(this, 'width')
      const height = layoutSize(this, 'height')
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON() {
          return {}
        },
      } as DOMRect
    })
  })

  afterEach(() => {
    if (previousObserver) globalThis.ResizeObserver = previousObserver
    vi.restoreAllMocks()
  })

  it('keeps 25 categories drawable inside a bounded scroller', async () => {
    const count = 25
    renderBars(count)

    const scroller = screen.getByRole('img', { name: 'Month comparison' })
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(scroller).toHaveAttribute('aria-describedby')
    expect(scroller.className).toContain('overflow-y-auto')
    expect(scroller.className).toContain('min-w-0')
    expect(scroller.style.height).toBe('')
    expect(scroller).toHaveStyle({ maxHeight: '520px', overflowY: 'auto', overflowX: 'auto' })

    const canvas = chartCanvas(scroller)
    const canvasHeight = Number.parseFloat(canvas.style.height)
    expect(canvasHeight).toBe(count * 40 + 28)
    expect(canvasHeight).toBeGreaterThan(520)

    const table = screen.getByRole('table', { name: 'Month comparison values' })
    expect(scroller.contains(table)).toBe(false)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(count)
    for (const row of comparisons(count)) {
      expect(table).toHaveTextContent(row.categoryName)
      expect(table).toHaveTextContent(formatMoney(row.current, 'USD'))
      expect(table).toHaveTextContent(formatMoney(row.previous, 'USD'))
    }

    await waitFor(() => {
      const svg = scroller.querySelector('.recharts-surface')
      expect(Number(svg?.getAttribute('height'))).toBe(canvasHeight)
      expectDistinguishablePairs(scroller, count)
    })

    const heights = [...scroller.querySelectorAll('[height]')].map((node) =>
      Number(node.getAttribute('height'))
    )
    expect(heights.some((height) => height < 0)).toBe(false)
    expect(
      scroller.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')
    ).toHaveLength(count)
    expect(scroller.querySelector('.recharts-xAxis-tick-labels')?.textContent).toContain('$')
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Previous').length).toBeGreaterThan(0)
  })

  it('does not stretch a short comparison to the scrollport', async () => {
    renderBars(2)

    const scroller = screen.getByRole('img', { name: 'Month comparison' })
    const canvas = chartCanvas(scroller)
    expect(Number.parseFloat(canvas.style.height)).toBe(168)
    expect(Number.parseFloat(canvas.style.height)).toBeLessThan(520)

    await waitFor(() => {
      expect(Number(scroller.querySelector('.recharts-surface')?.getAttribute('height'))).toBe(168)
      expectDistinguishablePairs(scroller, 2)
    })
  })
})
