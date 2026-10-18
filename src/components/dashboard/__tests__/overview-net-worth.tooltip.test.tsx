import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { OverviewNetWorth } from '@/components/dashboard/overview-net-worth'

vi.mock('@/components/dashboard/overview-account-comparison', () => ({
  OverviewAccountComparison: () => null,
}))

const CHART_WIDTH = 640
const CHART_HEIGHT = 280

const SNAPSHOTS = [
  { date: '2026-01-31', netWorth: 100_000, label: 'Jan 31, 2026', amount: '$1,000.00' },
  { date: '2026-06-15', netWorth: 123_400, label: 'Jun 15, 2026', amount: '$1,234.00' },
  { date: '2026-10-17', netWorth: 150_050, label: 'Oct 17, 2026', amount: '$1,500.50' },
] as const

const INDEX_DATES = ['Jan 1, 2000', 'Jan 1, 2001', 'Feb 1, 2001']

const rect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: CHART_WIDTH,
  bottom: CHART_HEIGHT,
  width: CHART_WIDTH,
  height: CHART_HEIGHT,
  toJSON() {
    return this
  },
} as DOMRect

const sizeDescriptors = ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

beforeAll(async () => {
  await i18n.changeLanguage('en')

  class ResizeObserverMock {
    private readonly callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(target: Element) {
      this.callback(
        [{ target, contentRect: rect } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      )
    }

    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

  for (const name of sizeDescriptors) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get() {
        return name.endsWith('Width') ? CHART_WIDTH : CHART_HEIGHT
      },
    })
  }
  Element.prototype.getBoundingClientRect = () => rect
})

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  for (const name of sizeDescriptors) {
    const descriptor = originalDescriptors.get(name)
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
  }
})

describe('Overview summary recorded tooltip', () => {
  it('labels first, middle, and last snapshots with their dates and full amounts', async () => {
    render(
      <OverviewNetWorth
        currentComplete
        currentAmount={150_050}
        currentCurrency="USD"
        income="$0.00"
        spent="$0.00"
        saved="$0.00"
        savedTone="muted"
        monthlySummaryLabel="All time"
        currentAsOfLabel="Current value · Oct 17, 2026"
        historyAsOfLabel=""
        history={SNAPSHOTS.map(({ date, netWorth }) => ({ date, netWorth }))}
        historyComplete
        period="all"
        onPeriodChange={() => {}}
        historyCurrency="USD"
        emptyHistoryMessage="No history"
        accounts={[]}
        preferredCurrency={null}
      />
    )

    const summary = document.getElementById('overview-summary-panel')!
    expect(summary.querySelector('.h-28')).toBeTruthy()
    expect(summary.querySelector('[role="group"]')).toBeNull()

    const dots = await waitFor(() => {
      const nodes = [...summary.querySelectorAll('.recharts-line-dot')]
      expect(nodes).toHaveLength(3)
      const xs = nodes.map((dot) => Number(dot.getAttribute('cx')))
      expect(xs.every((x) => Number.isFinite(x))).toBe(true)
      expect(new Set(xs).size).toBe(3)
      return nodes
    })

    const xs = dots.map((dot) => Number(dot.getAttribute('cx')))
    expect(xs[2]).toBeGreaterThan(xs[1])
    expect(xs[1]).toBeGreaterThan(xs[0])
    expect(Math.abs(xs[1] - xs[0] - (xs[2] - xs[1]))).toBeLessThan(0.5)
    expect(summary.querySelector('.recharts-cartesian-axis')).toBeNull()
    expect(summary.querySelector('.recharts-xAxis')).toBeNull()
    expect(summary.querySelector('.recharts-yAxis')).toBeNull()

    const wrapper = summary.querySelector('.recharts-wrapper') as HTMLElement
    const tooltip = summary.querySelector('.recharts-tooltip-wrapper') as HTMLElement

    for (const [index, snapshot] of SNAPSHOTS.entries()) {
      const dot = dots[index]!
      fireEvent.mouseMove(wrapper, {
        clientX: Number(dot.getAttribute('cx')),
        clientY: Number(dot.getAttribute('cy')),
      })
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      })

      await waitFor(() => {
        expect(tooltip).toHaveStyle({ visibility: 'visible' })
        expect(tooltip.querySelector('.recharts-tooltip-label')).toHaveTextContent(snapshot.label)
        expect(tooltip.querySelector('.recharts-tooltip-item-name')).toHaveTextContent('Net worth')
        expect(tooltip.querySelector('.recharts-tooltip-item-value')).toHaveTextContent(
          snapshot.amount
        )
      })
      expect(tooltip.querySelector('.recharts-tooltip-label')).not.toHaveTextContent(
        INDEX_DATES[index]!
      )
      expect(tooltip.textContent).not.toMatch(/\$1\.2k|\$1K/i)
    }

    const table = document.getElementById('overview-summary-recorded-snapshots')!
    for (const snapshot of SNAPSHOTS) {
      expect(table.querySelector(`time[datetime="${snapshot.date}"]`)).toHaveTextContent(
        snapshot.label
      )
      expect(table).toHaveTextContent(snapshot.amount)
    }
  })

  it('keeps a flat recorded series horizontal and off a zero baseline', async () => {
    render(
      <OverviewNetWorth
        currentComplete
        currentAmount={100_000}
        currentCurrency="USD"
        income="$0.00"
        spent="$0.00"
        saved="$0.00"
        savedTone="muted"
        monthlySummaryLabel="All time"
        currentAsOfLabel="Current value"
        historyAsOfLabel=""
        history={[
          { date: '2026-01-01', netWorth: 100_000 },
          { date: '2026-06-01', netWorth: 100_000 },
          { date: '2026-10-01', netWorth: 100_000 },
        ]}
        historyComplete
        period="all"
        onPeriodChange={() => {}}
        historyCurrency="USD"
        emptyHistoryMessage="No history"
        accounts={[]}
        preferredCurrency={null}
      />
    )

    const summary = document.getElementById('overview-summary-panel')!
    const dots = await waitFor(() => {
      const nodes = [...summary.querySelectorAll('.recharts-line-dot')]
      expect(nodes).toHaveLength(3)
      return nodes
    })
    const ys = dots.map((dot) => Number(dot.getAttribute('cy')))
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5)
    expect(ys[0]).toBeGreaterThan(60)
    expect(ys[0]).toBeLessThan(220)
    expect(summary.querySelector('.recharts-yAxis')).toBeNull()
    expect(summary.querySelector('.recharts-xAxis')).toBeNull()
  })

  it('uses the recorded range instead of a zero baseline or a one-cent slope', async () => {
    const { rerender } = render(
      <OverviewNetWorth
        currentComplete
        currentAmount={1_200_000}
        currentCurrency="USD"
        income="$0.00"
        spent="$0.00"
        saved="$0.00"
        savedTone="muted"
        monthlySummaryLabel="All time"
        currentAsOfLabel="Current value"
        historyAsOfLabel=""
        history={[
          { date: '2026-01-01', netWorth: 1_000_000 },
          { date: '2026-06-01', netWorth: 1_200_000 },
        ]}
        historyComplete
        period="all"
        onPeriodChange={() => {}}
        historyCurrency="USD"
        emptyHistoryMessage="No history"
        accounts={[]}
        preferredCurrency={null}
      />
    )

    const summary = document.getElementById('overview-summary-panel')!
    const rangeDots = await waitFor(() => {
      const nodes = [...summary.querySelectorAll('.recharts-line-dot')]
      expect(nodes).toHaveLength(2)
      return nodes
    })
    const rangeDelta = Math.abs(
      Number(rangeDots[0]!.getAttribute('cy')) - Number(rangeDots[1]!.getAttribute('cy'))
    )
    expect(rangeDelta).toBeGreaterThan(120)
    expect(summary.querySelector('.recharts-yAxis')).toBeNull()

    rerender(
      <OverviewNetWorth
        currentComplete
        currentAmount={1_000_001}
        currentCurrency="USD"
        income="$0.00"
        spent="$0.00"
        saved="$0.00"
        savedTone="muted"
        monthlySummaryLabel="All time"
        currentAsOfLabel="Current value"
        historyAsOfLabel=""
        history={[
          { date: '2026-01-01', netWorth: 1_000_000 },
          { date: '2026-06-01', netWorth: 1_000_001 },
        ]}
        historyComplete
        period="all"
        onPeriodChange={() => {}}
        historyCurrency="USD"
        emptyHistoryMessage="No history"
        accounts={[]}
        preferredCurrency={null}
      />
    )
    const centDots = await waitFor(() => {
      const nodes = [...summary.querySelectorAll('.recharts-line-dot')]
      expect(nodes).toHaveLength(2)
      return nodes
    })
    const centDelta = Math.abs(
      Number(centDots[0]!.getAttribute('cy')) - Number(centDots[1]!.getAttribute('cy'))
    )
    expect(centDelta).toBeLessThan(3)
    expect(centDelta).toBeLessThan(rangeDelta / 8)
  })
})
