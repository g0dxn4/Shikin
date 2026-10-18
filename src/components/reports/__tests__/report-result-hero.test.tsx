import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  projectScopedRecurringEstimate,
  projectScopedReport,
  resolveReportWindow,
} from '@shikin/finance-core'
import '@/i18n'
import { formatMoney } from '@/lib/money'
import { fixtureWindow, scopedFixture } from '@/test/scoped-fixture'
import { ReportResultHero } from '@/components/reports/report-result-hero'

describe('ReportResultHero', () => {
  it('does not chart an incomplete net result or invent months', () => {
    const snapshot = scopedFixture()
    const window = resolveReportWindow(fixtureWindow)
    const result = projectScopedReport({
      dataset: snapshot.dataset,
      scope: {},
      currency: 'MXN',
      window,
      basis: 'net_consumption',
      groupBy: 'month',
    })
    expect(result.complete).toBe(false)

    render(
      <ReportResultHero
        result={result}
        window={window}
        accounts={snapshot.accounts}
        categories={snapshot.categories}
      />
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument()
    expect(screen.getByText(/UTC/)).toBeInTheDocument()
    expect(screen.getByText('Incomplete')).toBeInTheDocument()
    expect(screen.getByText(/No chart until this result is complete/)).toBeInTheDocument()
    expect(screen.queryByText('2026-02')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getAllByText('Net consumption').length).toBeGreaterThan(0)
    for (const field of [
      'Earned income',
      'Other income',
      'Principal recovery',
      'Asset acquisitions',
    ]) {
      expect(screen.getByText(field)).toBeInTheDocument()
    }
    expect(screen.getByText(/Source coverage/)).toBeInTheDocument()
    expect(screen.getByText(/Classification/)).toBeInTheDocument()
  })

  it('does not turn estimate month grouping into an occurrence chart', () => {
    const snapshot = scopedFixture()
    snapshot.estimates = {
      ...snapshot.estimates,
      recurringRules: [
        {
          id: 'rule',
          amount: 10000,
          currency: 'MXN',
          account_id: 'bank',
          category_id: 'food',
          is_active: 1,
          type: 'expense',
          frequency: 'monthly',
        },
      ],
    }
    const window = resolveReportWindow(fixtureWindow)
    const result = projectScopedRecurringEstimate({
      dataset: snapshot.estimates,
      scope: {},
      currency: 'MXN',
      asOf: window.asOf,
      groupBy: 'month',
    })

    render(
      <ReportResultHero
        result={result}
        window={window}
        accounts={snapshot.accounts}
        categories={snapshot.categories}
      />
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Separate estimate sources')).toBeInTheDocument()
    expect(screen.queryByText(formatMoney(30000, 'MXN'))).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getAllByText(/Definition equivalents/).length).toBeGreaterThan(0)
    expect(screen.getByText(/not added together/)).toBeInTheDocument()
    expect(screen.queryByText(/No combined total/)).not.toBeInTheDocument()
  })

  it('paints complete group bars instead of withholding the graphic', async () => {
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 240,
      width: 640,
      height: 240,
      toJSON() {
        return this
      },
    } as DOMRect
    class ResizeObserverMock {
      private readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as never)
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const size = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const snapshot = scopedFixture()
      const window = resolveReportWindow(fixtureWindow)
      const result = projectScopedReport({
        dataset: snapshot.dataset,
        scope: {},
        currency: 'MXN',
        window,
        basis: 'gross_cashflow',
        groupBy: 'category',
      })
      expect(result.complete).toBe(true)
      const { container } = render(
        <ReportResultHero
          result={result}
          window={window}
          accounts={snapshot.accounts}
          categories={snapshot.categories}
        />
      )
      await waitFor(() => {
        const surface = container.querySelector('svg.recharts-surface')
        expect(surface).toHaveAttribute('width', '640')
        expect(surface).toHaveAttribute('height', '240')
        expect(container.querySelector('.recharts-bar')).toBeTruthy()
      })
      expect(
        screen.getByRole('table', { name: 'Complete groups for the active measure' })
      ).toHaveTextContent(formatMoney(25000, 'MXN'))
    } finally {
      size.mockRestore()
      height.mockRestore()
      warn.mockRestore()
      error.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
