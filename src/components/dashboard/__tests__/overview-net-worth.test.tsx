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
  AreaChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: ({ type }: { type?: string }) => <div data-testid="area" data-type={type ?? ''} />,
  LineChart: ({
    data,
    children,
  }: {
    data?: Array<{ date: string }>
    children?: React.ReactNode
  }) => (
    <div data-testid="line-chart" data-points={data?.map((point) => point.date).join(',') ?? ''}>
      {children}
    </div>
  ),
  Line: ({ type }: { type?: string }) => <div data-testid="line" data-type={type ?? ''} />,
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
    expect(document.getElementById('overview-comparison-panel')).toHaveAttribute('hidden')
    expect(document.getElementById('overview-history-panel')).toHaveAttribute('aria-hidden', 'true')
    expect(document.getElementById('overview-history-panel')).toHaveClass('hidden')
    expect(document.getElementById('overview-summary-panel')).not.toHaveAttribute('inert')
    expect(document.getElementById('overview-summary-panel')).not.toHaveAttribute('hidden')

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
    expect(panels[0]).toHaveAttribute('hidden')
    expect(panels[0]).not.toHaveClass('invisible')
    expect(panels[2]).toHaveAttribute('inert')
    expect(panels[2]).toHaveClass('hidden')
  })

  it('keeps the four summary metrics and source details without a cash-flow comparison', () => {
    const { rerender } = renderOverview()
    const summary = document.getElementById('overview-summary-panel')!
    const metricGrid = summary.querySelector('[aria-label="overview.views.summary"]')!
    expect(metricGrid).not.toHaveClass('grid-cols-2')
    expect(metricGrid?.children).toHaveLength(2)
    expect(summary.querySelectorAll('.rounded-xl.border')).toHaveLength(0)
    expect(summary).not.toHaveClass('lg:flex', 'lg:items-center', 'invisible')
    expect(metricGrid).toHaveClass('w-full', 'items-stretch')
    expect(metricGrid).not.toHaveClass('lg:items-center')
    expect(summary).not.toHaveClass('justify-center')
    expect(summary.querySelector('.h-28')).toBeTruthy()
    const figure = summary.querySelector('strong')
    expect(figure).toHaveClass('text-3xl', 'sm:text-4xl')
    expect(figure).not.toHaveClass('text-5xl', 'xl:text-5xl')
    expect(summary.querySelector('.lg\\:mt-auto')).toBeTruthy()
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

const baseProps = {
  currentComplete: true,
  currentAmount: 75_000,
  currentCurrency: 'USD',
  income: '$9.99',
  spent: '$1.11',
  saved: '$8.88',
  savedTone: 'positive' as const,
  monthlySummaryLabel: 'April 2026 · dated manual rates',
  currentAsOfLabel: 'Current value · April 18, 2026',
  historyAsOfLabel: '',
  history: [] as Array<{ date: string; netWorth: number }>,
  historyComplete: true,
  period: '6m' as const,
  onPeriodChange: () => {},
  historyCurrency: 'USD',
  emptyHistoryMessage: 'No history',
  accounts,
  preferredCurrency: 'USD',
  totalAssets: 100_000,
  totalLiabilities: 25_000,
  totalInvestments: 20_000,
  accountAssets: [
    { id: 'checking', name: 'Checking', currency: 'USD', convertedBalance: 80_000 },
    { id: 'idle', name: 'Idle', currency: 'EUR', convertedBalance: 0 },
  ],
  accountLiabilities: [{ id: 'card', name: 'Card', currency: 'MXN', convertedBalance: 25_000 }],
}

describe('Overview summary visual', () => {
  it('charts exactly two recorded snapshots with full amounts and no area fill', () => {
    render(
      <OverviewNetWorth
        {...baseProps}
        currentAmount={115_000}
        history={[
          { date: '2026-01-01', netWorth: 100_000 },
          { date: '2026-03-01', netWorth: 115_000 },
        ]}
      />
    )
    const summary = document.getElementById('overview-summary-panel')!
    const chart = summary.querySelector('[data-testid="line-chart"]')
    expect(chart).toHaveAttribute('data-points', '2026-01-01,2026-03-01')
    expect(summary.querySelector('[data-testid="line"]')).toHaveAttribute('data-type', 'linear')
    expect(summary.querySelector('[data-testid="area-chart"]')).not.toBeInTheDocument()
    expect(summary.querySelector('[data-testid="overview-summary-composition"]')).toBeNull()
    expect(
      document.getElementById('overview-history-panel')?.querySelector('[data-testid="area"]')
    ).toHaveAttribute('data-type', 'monotone')

    const table = document.getElementById('overview-summary-recorded-snapshots') as HTMLTableElement
    expect(table.parentElement).toHaveClass('sr-only')
    expect(table).not.toHaveClass('sr-only')
    expect(table).not.toHaveAttribute('hidden')
    expect(
      summary.querySelector('[aria-describedby="overview-summary-recorded-snapshots"]')
    ).toHaveAttribute('aria-labelledby', 'overview-summary-recorded-caption')
    expect(table.querySelector('time[datetime="2026-01-01"]')).toHaveTextContent('Jan 1, 2026')
    expect(table.querySelector('time[datetime="2026-03-01"]')).toHaveTextContent('Mar 1, 2026')
    expect(table).toHaveTextContent('$1,000.00')
    expect(table).toHaveTextContent('$1,150.00')
    expect(table.caption?.textContent).toContain('Jan 1, 2026')
    expect(table.caption?.textContent).toContain('Mar 1, 2026')
    expect(table.caption?.textContent).toContain('overview.period.6m')
    expect(summary.querySelector('[role="group"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'overview.period.6m' })).not.toBeInTheDocument()
  })

  it('does not draw a line for zero or one snapshot', () => {
    const { rerender } = render(<OverviewNetWorth {...baseProps} history={[]} />)
    const summary = document.getElementById('overview-summary-panel')!
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(document.getElementById('overview-summary-recorded-snapshots')).toBeNull()

    rerender(
      <OverviewNetWorth
        {...baseProps}
        history={[{ date: '2026-04-02', netWorth: 75_000 }]}
        totalAssets={null}
      />
    )
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(summary.querySelector('[data-testid="overview-summary-plain"]')).toHaveAttribute(
      'data-reason',
      'one-snapshot'
    )
    expect(summary.querySelector('[data-testid="overview-summary-composition"]')).toBeNull()
  })

  it('does not chart stale or incomplete history amounts', () => {
    render(
      <OverviewNetWorth
        {...baseProps}
        currentComplete={false}
        currentAmount={null}
        currentCurrency={null}
        historyComplete={false}
        historyCurrency={null}
        history={[
          { date: '2026-01-01', netWorth: 12_345 },
          { date: '2026-02-01', netWorth: 67_890 },
        ]}
        totalAssets={null}
        totalLiabilities={null}
        totalInvestments={null}
      />
    )
    const summary = document.getElementById('overview-summary-panel')!
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(summary.querySelector('[data-testid="overview-summary-composition"]')).toBeNull()
    expect(document.getElementById('overview-summary-recorded-snapshots')).toBeNull()
    expect(summary).not.toHaveTextContent('$123.45')
    expect(summary).not.toHaveTextContent('$678.90')
    expect(summary.querySelector('[data-testid="overview-summary-plain"]')).toHaveAttribute(
      'data-reason',
      'history-unavailable'
    )
  })

  it('shows holdings separately when composition reconciles and refuses an inexact bar', () => {
    const { rerender } = render(<OverviewNetWorth {...baseProps} history={[]} />)
    const summary = document.getElementById('overview-summary-panel')!
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    const segments = summary.querySelectorAll('[data-testid="composition-segment"]')
    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveAttribute('data-segment', 'checking')
    expect(segments[0]).toHaveAttribute('data-kind', 'account')
    expect(segments[1]).toHaveAttribute('data-segment', 'holdings')
    expect(segments[1]).toHaveAttribute('data-kind', 'holdings')
    expect((segments[0] as HTMLElement).style.minWidth).toBe('')
    expect((segments[0] as HTMLElement).style.flexBasis).toBe('0px')
    expect((segments[1] as HTMLElement).style.flexGrow).toBe('20000')

    const table = document.getElementById('overview-summary-composition') as HTMLTableElement
    expect(table.parentElement).toHaveClass('sr-only')
    expect(table).not.toHaveClass('sr-only')
    expect(summary.querySelector('[aria-describedby="overview-summary-composition"]')).toBeTruthy()
    expect(table).toHaveTextContent('Checking')
    expect(table).toHaveTextContent('overview.summaryHoldings')
    expect(table).toHaveTextContent('$800.00')
    expect(table).toHaveTextContent('$200.00')
    expect(table).toHaveTextContent('$250.00')
    expect(table).toHaveTextContent('$750.00')
    expect(table).toHaveTextContent('$1,000.00')
    expect(table).not.toHaveTextContent('$9.99')
    expect(table).not.toHaveTextContent('$1.11')
    expect(summary).not.toHaveTextContent('Idle')

    rerender(<OverviewNetWorth {...baseProps} history={[]} totalAssets={100_001} />)
    expect(summary.querySelector('[data-testid="overview-summary-composition"]')).toBeNull()
    expect(summary.querySelector('[data-testid="composition-segment"]')).toBeNull()
    expect(document.getElementById('overview-summary-composition')).toBeNull()
    expect(summary).not.toHaveTextContent('$800.00')
    expect(summary.querySelector('[data-testid="overview-summary-plain"]')).toHaveAttribute(
      'data-reason',
      'composition-unproven'
    )
  })
})
