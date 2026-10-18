import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForecastProjectionChart } from '@/components/planning-scenarios/forecast-projection-chart'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}))

class ResizeObserverStub {
  private callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    const rect = target.getBoundingClientRect()
    this.callback(
      [
        {
          target,
          contentRect: rect,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver
    )
  }
  unobserve() {}
  disconnect() {}
}

describe('forecast projection real band', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  })

  it('draws the area between the outer series instead of down to zero', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 480,
      bottom: 240,
      width: 480,
      height: 240,
      toJSON() {
        return {}
      },
    }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 480,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 240,
    })

    const { container } = render(
      <ForecastProjectionChart
        points={[
          {
            date: '2028-01-01',
            projected: 4_265_840,
            optimistic: 4_300_000,
            pessimistic: 4_200_000,
          },
          {
            date: '2028-01-02',
            projected: 4_512_730,
            optimistic: 4_600_000,
            pessimistic: 4_400_000,
          },
        ]}
        currency="USD"
      />
    )

    const path = await waitFor(() => {
      const area = container.querySelector('.recharts-area-area')
      expect(area).not.toBeNull()
      return area as SVGPathElement
    })
    const d = path.getAttribute('d') ?? ''
    expect(d.length).toBeGreaterThan(0)
    const ys = [...d.matchAll(/[ML][^,]+,([0-9.]+)/g)].map((match) => Number(match[1]))
    expect(ys.length).toBeGreaterThan(1)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const plot = container.querySelector('.recharts-wrapper')
    const plotHeight = plot?.getBoundingClientRect().height ?? 240
    // A zero-based fill would pin one edge to the plot floor. This band stays inside the padded series.
    expect(maxY).toBeLessThan(plotHeight - 8)
    expect(minY).toBeGreaterThan(8)
    expect(maxY - minY).toBeGreaterThan(0)
    expect(maxY - minY).toBeLessThan(plotHeight * 0.9)
  })
})
