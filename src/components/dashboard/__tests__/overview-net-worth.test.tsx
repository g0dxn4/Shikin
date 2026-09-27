import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { OverviewNetWorth } from '@/components/dashboard/overview-net-worth'
import type { Account } from '@/types/database'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}))

vi.mock('@/components/dashboard/use-overview-account-comparison', () => ({
  useOverviewAccountComparison: () => ({
    firstHistory: [
      { date: '2026-01-01', balance: 10_000 },
      { date: '2026-03-01', balance: 12_000 },
    ],
    secondHistory: [
      { date: '2026-02-01', balance: 20_000 },
      { date: '2026-03-01', balance: 22_000 },
    ],
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('recharts', () => ({
  AreaChart: () => null,
  Area: () => null,
  LineChart: () => null,
  Line: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}))

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
})

const accounts = [
  { id: 'nu', name: 'Nu Card', type: 'credit_card', currency: 'USD', balance: -5_000 },
  { id: 'bbva', name: 'BBVA', type: 'checking', currency: 'USD', balance: 80_000 },
  { id: 'savings', name: 'Savings', type: 'savings', currency: 'USD', balance: 40_000 },
] as Account[]

function renderOverview() {
  return render(
    <OverviewNetWorth
      currentComplete
      currentAmount={115_000}
      currentCurrency="USD"
      income="$10.00"
      spent="$4.00"
      saved="$6.00"
      savedTone="positive"
      monthlySummaryLabel="April 2026 · dated manual rates"
      currentAsOfLabel="Current value · April 18, 2026"
      historyAsOfLabel="History through March 1, 2026"
      history={[
        { date: '2026-01-01', netWorth: 100_000 },
        { date: '2026-03-01', netWorth: 115_000 },
      ]}
      historyComplete
      period="6m"
      onPeriodChange={() => {}}
      historyCurrency="USD"
      emptyHistoryMessage="No history"
      accounts={accounts}
      preferredCurrency="USD"
    />
  )
}

describe('OverviewNetWorth comparison controls', () => {
  it('keeps comparison accounts, range, and mode across Summary and History', async () => {
    const user = userEvent.setup()
    renderOverview()

    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    expect(screen.getByLabelText('overview.comparison.firstAccount')).toHaveTextContent('Nu Card')
    expect(screen.getByLabelText('overview.comparison.secondAccount')).toHaveTextContent('BBVA')

    await user.click(screen.getByLabelText('overview.comparison.secondAccount'))
    await user.click(await screen.findByRole('option', { name: 'Savings' }))
    await user.click(screen.getByRole('button', { name: 'overview.period.ytd' }))
    await user.click(screen.getByRole('button', { name: 'overview.comparison.change' }))

    expect(screen.getByLabelText('overview.comparison.secondAccount')).toHaveTextContent('Savings')
    expect(screen.getByRole('button', { name: 'overview.period.ytd' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'overview.comparison.change' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(screen.getByRole('tab', { name: 'overview.views.summary' }))
    expect(
      screen.queryByRole('combobox', { name: 'overview.comparison.firstAccount' })
    ).not.toBeInTheDocument()
    expect(document.getElementById('overview-comparison-panel')).toHaveAttribute('inert')
    expect(document.getElementById('overview-history-panel')).toHaveAttribute('aria-hidden', 'true')
    expect(document.getElementById('overview-summary-panel')).not.toHaveAttribute('inert')

    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    expect(screen.getByText('overview.netWorthHistory')).toBeInTheDocument()
    expect(document.getElementById('overview-history-panel')).not.toHaveAttribute('inert')

    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    expect(screen.getByLabelText('overview.comparison.firstAccount')).toHaveTextContent('Nu Card')
    expect(screen.getByLabelText('overview.comparison.secondAccount')).toHaveTextContent('Savings')
    expect(screen.getByRole('button', { name: 'overview.period.ytd' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'overview.comparison.change' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'overview.period.6m' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'overview.comparison.balance' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(document.getElementById('overview-comparison-panel')).not.toHaveAttribute('inert')
    await user.click(screen.getByRole('button', { name: 'overview.period.1y' }))
    expect(screen.getByRole('button', { name: 'overview.period.1y' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    expect(screen.getByRole('button', { name: 'overview.period.1y' })).toBeVisible()
  })
})

describe('OverviewNetWorth shared panel geometry and evidence', () => {
  it('keeps all three panels in the same grid cell without exposing inactive controls', async () => {
    const user = userEvent.setup()
    renderOverview()
    const panels = ['summary', 'history', 'comparison'].map(
      (name) => document.getElementById(`overview-${name}-panel`)!
    )
    expect(new Set(panels.map((panel) => panel.parentElement))).toHaveProperty('size', 1)
    expect(panels[0].parentElement).toHaveClass('grid')
    for (const panel of panels) expect(panel).toHaveClass('col-start-1', 'row-start-1')
    expect(screen.queryByRole('button', { name: 'overview.period.ytd' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    expect(screen.getByRole('button', { name: 'overview.period.ytd' })).toBeInTheDocument()
    expect(panels[0]).toHaveAttribute('inert')
    expect(panels[2]).toHaveAttribute('inert')
  })

  it('keeps the four summary metrics and source details without a cash-flow comparison', () => {
    const { rerender } = renderOverview()
    const summary = document.getElementById('overview-summary-panel')!
    const metricGrid = summary.querySelector('[aria-label="overview.views.summary"]')!
    expect(metricGrid).not.toHaveClass('grid-cols-2')
    expect(metricGrid?.children).toHaveLength(2)
    expect(summary.querySelectorAll('.rounded-xl.border')).toHaveLength(0)
    expect(summary).toHaveClass('lg:flex', 'lg:items-center')
    expect(metricGrid).toHaveClass('w-full')
    expect(summary).not.toHaveClass('justify-center')
    expect(summary).toHaveTextContent('$1,150.00')
    expect(summary).toHaveTextContent('$10.00')
    expect(summary).toHaveTextContent('$4.00')
    expect(screen.getByText('$6.00')).toHaveClass('text-accent')
    expect(summary).toHaveTextContent('Current value · April 18, 2026')
    expect(summary).toHaveTextContent('April 2026 · dated manual rates')
    expect(
      screen.queryByRole('img', { name: /overview.cashFlowComparison/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('overview.cashFlow')).not.toBeInTheDocument()

    rerender(
      <OverviewNetWorth
        currentComplete={false}
        currentAmount={null}
        currentCurrency={null}
        unavailableMessage="Missing rate evidence"
        income="$10.00"
        incomeDetail="vs last month"
        spent="$4.00"
        spentDetail="vs last month"
        saved="$6.00"
        savingsRate="60%"
        savedTone="positive"
        monthlySummaryLabel="April 2026 · dated manual rates"
        currentAsOfLabel=""
        historyAsOfLabel=""
        history={[]}
        historyComplete={false}
        period="6m"
        onPeriodChange={() => {}}
        historyCurrency={null}
        emptyHistoryMessage="No history"
        accounts={accounts}
        preferredCurrency="USD"
      />
    )
    expect(summary).toHaveTextContent('Missing rate evidence')
    expect(summary).toHaveTextContent('vs last month')
    expect(summary).toHaveTextContent('60%')
    expect(summary).toHaveTextContent('—')
    expect(
      screen.queryByRole('img', { name: /overview.cashFlowComparison/ })
    ).not.toBeInTheDocument()
  })

  it('does not render an income/spending cash-flow visual in Summary', () => {
    const { rerender } = renderOverview()
    expect(
      screen.queryByRole('img', { name: /overview.cashFlowComparison/ })
    ).not.toBeInTheDocument()
    const props = {
      currentComplete: false,
      currentAmount: null,
      currentCurrency: null,
      income: '—',
      spent: '—',
      saved: '—',
      savedTone: 'muted' as const,
      monthlySummaryLabel: 'This month',
      currentAsOfLabel: '',
      historyAsOfLabel: '',
      history: [],
      historyComplete: false,
      period: 'month' as const,
      onPeriodChange: () => {},
      historyCurrency: null,
      emptyHistoryMessage: 'No history',
      accounts: [] as Account[],
      preferredCurrency: null,
    }
    rerender(<OverviewNetWorth {...props} />)
    expect(
      screen.queryByRole('img', { name: /overview.cashFlowComparison/ })
    ).not.toBeInTheDocument()
    const summary = document.getElementById('overview-summary-panel')!
    expect(summary).toHaveTextContent('—')
    expect(summary).toHaveTextContent('This month')
    rerender(
      <OverviewNetWorth
        {...props}
        income="$1.00"
        spent="$0.50"
        saved="-$0.50"
        savedTone="negative"
      />
    )
    expect(
      screen.queryByRole('img', { name: /overview.cashFlowComparison/ })
    ).not.toBeInTheDocument()
    expect(summary).toHaveTextContent('$1.00')
    expect(summary).toHaveTextContent('$0.50')
    expect(screen.getByText('-$0.50')).toHaveClass('text-destructive')
    expect(document.getElementById('overview-comparison-panel')).toHaveAttribute('inert')
  })
})
