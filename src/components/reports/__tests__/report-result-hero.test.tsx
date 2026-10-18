import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  projectScopedRecurringEstimate,
  projectScopedReport,
  resolveReportWindow,
} from '@shikin/finance-core'
import '@/i18n'
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
    expect(screen.getByText(/No chart until this result is complete/)).toBeInTheDocument()
    expect(screen.queryByText('2026-02')).not.toBeInTheDocument()
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
    expect(screen.getAllByText(/Definition equivalents/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/No combined total/)).not.toBeInTheDocument()
  })
})
