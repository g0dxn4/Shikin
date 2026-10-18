import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { OverviewNetWorth, type NetWorthPeriod } from '@/components/dashboard/overview-net-worth'
import {
  summaryEndpointAmount,
  summaryRecordedValueDomain,
} from '@/components/dashboard/overview-summary-visual'
import enDashboard from '@/i18n/locales/en/dashboard.json'
import esDashboard from '@/i18n/locales/es/dashboard.json'
import { formatMoney } from '@/lib/money'
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

let chartPoints: Array<{ date: string; netWorth?: number }> = []

vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: ({ type }: { type?: string }) => <div data-testid="area" data-type={type ?? ''} />,
  LineChart: ({
    data,
    children,
  }: {
    data?: Array<{ date: string; netWorth?: number }>
    children?: React.ReactNode
  }) => {
    chartPoints = data ?? []
    return (
      <div data-testid="line-chart" data-points={data?.map((point) => point.date).join(',') ?? ''}>
        {children}
      </div>
    )
  },
  Line: ({
    type,
    connectNulls,
    isAnimationActive,
    dot,
  }: {
    type?: string
    connectNulls?: boolean
    isAnimationActive?: boolean
    dot?: (props: {
      cx?: number
      cy?: number
      index?: number
      payload?: { date?: string; netWorth?: number }
    }) => React.ReactNode
  }) => (
    <div
      data-testid="line"
      data-type={type ?? ''}
      data-connect-nulls={connectNulls === false ? 'false' : 'true'}
      data-animation={isAnimationActive === false ? 'off' : 'on'}
    >
      {typeof dot === 'function'
        ? chartPoints.map((point, index) => (
            <span key={`${point.date}-${index}`}>
              {dot({ cx: 8 + index, cy: 12, index, payload: point })}
            </span>
          ))
        : null}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: ({ dataKey, hide }: { dataKey?: string | number; hide?: boolean }) => (
    <div
      data-testid="x-axis"
      data-key={dataKey === undefined ? '' : String(dataKey)}
      data-hide={hide ? 'true' : 'false'}
    />
  ),
  YAxis: ({
    hide,
    domain,
    width,
    allowDataOverflow,
  }: {
    hide?: boolean
    domain?: readonly number[]
    width?: number
    allowDataOverflow?: boolean
  }) => (
    <div
      data-testid="y-axis"
      data-hide={hide ? 'true' : 'false'}
      data-width={width ?? ''}
      data-overflow={allowDataOverflow ? 'true' : 'false'}
      data-domain={Array.isArray(domain) ? domain.join('|') : ''}
    />
  ),
  Tooltip: ({
    labelFormatter,
    formatter,
  }: {
    labelFormatter?: (label: unknown) => unknown
    formatter?: (value: unknown) => unknown
  }) => {
    const label = labelFormatter?.('2026-06-15')
    const formatted = formatter?.(123_400)
    return (
      <div
        data-testid="tooltip-binding"
        data-sample-label={typeof label === 'string' ? label : ''}
        data-sample-amount={Array.isArray(formatted) ? String(formatted[0]) : ''}
      />
    )
  },
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
    expect(table.caption?.textContent).toContain('overview.summaryRange.names.6m')
    expect(summary.querySelector('[data-testid="overview-summary-range"]')).toHaveClass(
      'flex-wrap',
      'max-w-full'
    )
    expect(screen.getByRole('button', { name: 'overview.summaryRange.names.6m' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.queryByRole('button', { name: 'overview.period.6m' })).not.toBeInTheDocument()
    expect(summary.querySelector('[data-testid="line"]')).toHaveAttribute(
      'data-connect-nulls',
      'false'
    )
    expect(summary.querySelector('[data-testid="line"]')).toHaveAttribute('data-animation', 'off')
    const caption = document.getElementById('overview-summary-recorded-caption')
    expect(caption).toHaveClass('sr-only')
    expect(caption).toHaveTextContent('Jan 1, 2026')
    expect(caption).toHaveTextContent('Mar 1, 2026')
    const endpoints = summary.querySelector('[data-testid="overview-summary-endpoints"]')
    expect(endpoints).toHaveAttribute('aria-hidden', 'true')
    expect(endpoints?.querySelector('time[datetime="2026-01-01"]')).toHaveTextContent('Jan 1')
    expect(endpoints?.querySelector('time[datetime="2026-03-01"]')).toHaveTextContent('Mar 1')
    expect(endpoints).toHaveTextContent(summaryEndpointAmount(100_000, 115_000, 'USD'))
    expect(endpoints).toHaveTextContent(summaryEndpointAmount(115_000, 100_000, 'USD'))
    expect(endpoints).not.toHaveTextContent('overview.summaryRecorded')
  })

  it('binds summary tooltip dates to recorded snapshots without a visible axis', () => {
    render(
      <OverviewNetWorth
        {...baseProps}
        currentAmount={150_050}
        history={[
          { date: '2026-01-31', netWorth: 100_000 },
          { date: '2026-06-15', netWorth: 123_400 },
          { date: '2026-10-17', netWorth: 150_050 },
        ]}
      />
    )
    const summary = document.getElementById('overview-summary-panel')!
    const chart = summary.querySelector('[data-testid="line-chart"]')
    expect(chart).toHaveAttribute('data-points', '2026-01-31,2026-06-15,2026-10-17')
    expect(chart?.querySelector('[data-testid="line"]')).toHaveAttribute('data-type', 'linear')
    const axis = chart?.querySelector('[data-testid="x-axis"]')
    expect(axis).toHaveAttribute('data-key', 'date')
    expect(axis).toHaveAttribute('data-hide', 'true')
    expect(chart?.querySelectorAll('[data-testid="x-axis"]')).toHaveLength(1)
    const yAxis = chart?.querySelector('[data-testid="y-axis"]')
    const domain = summaryRecordedValueDomain([100_000, 123_400, 150_050])
    expect(yAxis).toHaveAttribute('data-hide', 'true')
    expect(yAxis).toHaveAttribute('data-width', '0')
    expect(yAxis).toHaveAttribute('data-overflow', 'true')
    expect(yAxis).toHaveAttribute('data-domain', domain?.join('|'))
    expect(Number(domain?.[0])).toBeGreaterThan(0)
    const tooltip = chart?.querySelector('[data-testid="tooltip-binding"]')
    expect(tooltip).toHaveAttribute('data-sample-label', 'Jun 15, 2026')
    expect(tooltip).toHaveAttribute('data-sample-amount', '$1,234.00')
    expect(summary.querySelector('[data-testid="x-axis"]')).toHaveAttribute('data-key', 'date')
    expect(summary.querySelector('[data-testid="x-axis"]')).toHaveAttribute('data-hide', 'true')
    expect(summary.querySelector('[data-testid="overview-summary-range"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'overview.period.all' })).not.toBeInTheDocument()
    expect(summary.querySelector('.h-28')).toBeTruthy()
  })

  it('does not draw a line for zero or one snapshot', () => {
    const { rerender } = render(<OverviewNetWorth {...baseProps} history={[]} />)
    const summary = document.getElementById('overview-summary-panel')!
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(document.getElementById('overview-summary-recorded-snapshots')).toBeNull()

    rerender(
      <OverviewNetWorth
        {...baseProps}
        history={[{ date: '2026-04-02', netWorth: 10_000 }]}
        totalAssets={null}
      />
    )
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(summary.querySelector('[data-testid="overview-summary-single-dot"]')).toBeTruthy()
    expect(document.getElementById('overview-summary-recorded-snapshots')).toHaveTextContent(
      '$100.00'
    )
    expect(summary.querySelector('strong')).toHaveTextContent('$750.00')
    expect(summary.querySelector('[data-testid="overview-summary-composition"]')).toBeNull()
    expect(screen.getByRole('group', { name: 'overview.summaryRange.label' })).toBeInTheDocument()

    rerender(
      <OverviewNetWorth
        {...baseProps}
        history={[{ date: 'not-a-date', netWorth: 75_000 }]}
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

  it('pads a flat and one-cent summary line without resizing history', () => {
    const { rerender } = render(
      <OverviewNetWorth
        {...baseProps}
        history={[
          { date: '2026-01-01', netWorth: 1_000_000 },
          { date: '2026-02-01', netWorth: 1_000_001 },
        ]}
      />
    )
    const summary = document.getElementById('overview-summary-panel')!
    const summaryAxis = summary.querySelector('[data-testid="y-axis"]')
    const oneCent = summaryRecordedValueDomain([1_000_000, 1_000_001])
    expect(summaryAxis).toHaveAttribute('data-hide', 'true')
    expect(summaryAxis).toHaveAttribute('data-domain', oneCent?.join('|'))
    expect(Number(oneCent?.[0])).toBeGreaterThan(0)
    expect(
      summary.querySelector('[data-testid="overview-summary-endpoint-end"]')
    ).toHaveTextContent('$10,000.01')

    rerender(
      <OverviewNetWorth
        {...baseProps}
        history={[
          { date: '2025-12-31', netWorth: 50_000 },
          { date: '2026-01-02', netWorth: 50_000 },
        ]}
      />
    )
    const flat = summaryRecordedValueDomain([50_000, 50_000])
    expect(summary.querySelector('[data-testid="y-axis"]')).toHaveAttribute(
      'data-domain',
      flat?.join('|')
    )
    expect(summary.querySelector('time[datetime="2025-12-31"]')).toHaveTextContent('2025')
    expect(summary.querySelector('time[datetime="2026-01-02"]')).toHaveTextContent('2026')

    const historyAxis = document
      .getElementById('overview-history-panel')
      ?.querySelector('[data-testid="y-axis"]')
    expect(historyAxis).toHaveAttribute('data-domain', '')
    expect(historyAxis).toHaveAttribute('data-hide', 'false')
  })

  it('keeps all three overview tabs readable in a three-column wrap grid', () => {
    renderOverview()
    const tablist = screen.getByRole('tablist', { name: 'overview.viewsLabel' })
    expect(tablist).toHaveClass('grid', 'grid-cols-3', 'w-full')
    expect(tablist.className).not.toContain('overflow-x-auto')
    for (const name of [
      'overview.views.summary',
      'overview.views.history',
      'overview.views.comparison',
    ]) {
      const tab = screen.getByRole('tab', { name })
      expect(tab).toHaveClass('min-h-11', 'break-words', 'whitespace-normal', 'min-w-0')
      expect(tab).not.toHaveClass('truncate', 'shrink-0', 'overflow-hidden', 'whitespace-nowrap')
      expect(tab).toHaveTextContent(name)
    }
  })
})

describe('Overview summary ranges and point inspection', () => {
  it('uses compact MTD/MAX labels with full names and 44px wrapping controls', () => {
    expect(enDashboard.overview.summaryRange.labels.month).toBe('MTD')
    expect(enDashboard.overview.summaryRange.names.month).toBe('This month')
    expect(enDashboard.overview.summaryRange.labels['1y']).toBe('1Y')
    expect(enDashboard.overview.summaryRange.names['1y']).toBe('1 year')
    expect(enDashboard.overview.summaryRange.labels.all).toBe('MAX')
    expect(enDashboard.overview.summaryRange.labels).not.toHaveProperty('1m')
    expect(esDashboard.overview.summaryRange.labels.month).toBe('MTD')
    expect(esDashboard.overview.summaryRange.names.month).toBe('Este mes')
    expect(esDashboard.overview.summaryRange.names['1y']).toBe('1 año')
    expect(JSON.stringify(enDashboard.overview.summaryRange)).not.toMatch(/rolling|1M|1 month/)

    renderOverview()
    const group = screen.getByRole('group', { name: 'overview.summaryRange.label' })
    expect(group).toHaveClass('flex-wrap', 'max-w-full', 'motion-reduce:transition-none')
    expect(group.className).not.toContain('overflow-x-auto')
    for (const item of ['month', '3m', '6m', '1y', 'all'] as const) {
      const button = screen.getByRole('button', { name: `overview.summaryRange.names.${item}` })
      expect(button).toHaveClass('min-h-11', 'min-w-11', 'motion-reduce:transition-none')
      expect(button).toHaveTextContent(`overview.summaryRange.labels.${item}`)
    }
    expect(
      screen.queryByRole('button', { name: 'overview.summaryRange.names.1m' })
    ).not.toBeInTheDocument()
  })

  it('requests month and all, keeps Compare independent, and leaves the current figure unchanged', async () => {
    const user = userEvent.setup()
    const periods: NetWorthPeriod[] = []
    function Harness() {
      const [period, setPeriod] = useState<NetWorthPeriod>('6m')
      return (
        <OverviewNetWorth
          {...baseProps}
          currentAmount={115_000}
          income="$10.00"
          spent="$4.00"
          saved="$6.00"
          history={[
            { date: '2026-01-01', netWorth: 100_000 },
            { date: '2026-03-01', netWorth: 115_000 },
          ]}
          period={period}
          onPeriodChange={(next) => {
            periods.push(next)
            setPeriod(next)
          }}
        />
      )
    }
    render(<Harness />)
    const summary = document.getElementById('overview-summary-panel')!
    const figure = summary.querySelector('strong')
    expect(figure).toHaveTextContent('$1,150.00')

    await user.click(screen.getByRole('button', { name: 'overview.summaryRange.names.month' }))
    expect(periods).toEqual(['month'])
    expect(periods).not.toContain('1m')
    expect(
      screen.getByRole('button', { name: 'overview.summaryRange.names.month' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(figure).toHaveTextContent('$1,150.00')
    expect(summary).toHaveTextContent('$10.00')
    expect(summary).toHaveTextContent('$4.00')
    expect(summary).toHaveTextContent('$6.00')

    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    await user.click(screen.getByRole('button', { name: 'overview.period.ytd' }))
    await user.click(screen.getByRole('tab', { name: 'overview.views.summary' }))
    await user.click(screen.getByRole('button', { name: 'overview.summaryRange.names.all' }))
    expect(periods).toEqual(['month', 'all'])
    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    expect(screen.getByRole('button', { name: 'overview.period.ytd' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    expect(screen.getByRole('button', { name: 'overview.period.all' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(figure).toHaveTextContent('$1,150.00')
  })

  it('inspects an actual dated point by pointer and visible previous/next without changing the current total', async () => {
    const user = userEvent.setup()
    render(
      <OverviewNetWorth
        {...baseProps}
        currentAmount={999_999}
        currentCurrency="USD"
        historyCurrency="MXN"
        history={[
          { date: '2026-01-15', netWorth: 100_000 },
          { date: '2026-01-15', netWorth: 250_050 },
          { date: '2026-04-02', netWorth: 300_000 },
        ]}
      />
    )
    const summary = document.getElementById('overview-summary-panel')!
    const figure = summary.querySelector('strong')
    expect(figure).toHaveTextContent(formatMoney(999_999, 'USD'))
    const inspection = summary.querySelector('[data-testid="overview-summary-inspection"]')!
    expect(inspection).toBeEmptyDOMElement()

    const dots = summary.querySelectorAll('[data-testid="overview-summary-chart-point"]')
    expect(dots).toHaveLength(3)
    expect(dots[1]).toHaveAttribute('data-date', '2026-01-15')
    expect(dots[1]).toHaveAttribute('data-index', '1')
    fireEvent.click(dots[1]!)
    expect(inspection).toHaveTextContent('Jan 15, 2026')
    expect(inspection).toHaveTextContent(formatMoney(250_050, 'MXN'))
    expect(inspection).not.toHaveTextContent(formatMoney(100_000, 'MXN'))
    expect(figure).toHaveTextContent(formatMoney(999_999, 'USD'))
    expect(summary).toHaveTextContent('$9.99')

    const recorded = document.getElementById('overview-summary-recorded-snapshots')!
    expect(recorded.parentElement).toHaveClass('sr-only')
    expect(recorded).not.toHaveClass('sr-only')
    expect(
      recorded.querySelectorAll('button, a, input, select, textarea, [tabindex]')
    ).toHaveLength(0)
    expect(recorded.querySelectorAll('time')).toHaveLength(3)
    expect(recorded).toHaveTextContent(formatMoney(100_000, 'MXN'))
    expect(recorded).toHaveTextContent(formatMoney(250_050, 'MXN'))
    expect(recorded).toHaveTextContent(formatMoney(300_000, 'MXN'))

    const previous = screen.getByRole('button', { name: 'overview.summaryInspect.previous' })
    previous.focus()
    await user.keyboard('{Enter}')
    expect(inspection).toHaveTextContent(formatMoney(100_000, 'MXN'))
    expect(inspection).not.toHaveTextContent(formatMoney(250_050, 'MXN'))

    const next = screen.getByRole('button', { name: 'overview.summaryInspect.next' })
    next.focus()
    await user.keyboard('{Enter}')
    expect(inspection).toHaveTextContent(formatMoney(250_050, 'MXN'))
    await user.keyboard('{ArrowRight}')
    expect(inspection).toHaveTextContent(formatMoney(300_000, 'MXN'))
    expect(figure).toHaveTextContent(formatMoney(999_999, 'USD'))

    await user.keyboard('{Escape}')
    expect(inspection).toBeEmptyDOMElement()
    expect(figure).toHaveTextContent(formatMoney(999_999, 'USD'))
  })

  it('keeps the range control recoverable for empty, single, unavailable, and loading states', async () => {
    const user = userEvent.setup()
    const onPeriodChange = vi.fn()
    const { rerender } = render(
      <OverviewNetWorth {...baseProps} history={[]} onPeriodChange={onPeriodChange} />
    )
    const summary = document.getElementById('overview-summary-panel')!
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(
      summary.querySelector('[data-testid="overview-summary-range-context"]')
    ).toHaveTextContent('overview.summaryRange.names.6m')
    expect(screen.getByRole('group', { name: 'overview.summaryRange.label' })).toBeInTheDocument()

    rerender(
      <OverviewNetWorth
        {...baseProps}
        history={[{ date: '2026-04-02', netWorth: 10_000 }]}
        totalAssets={null}
        onPeriodChange={onPeriodChange}
      />
    )
    expect(summary.querySelector('[data-testid="overview-summary-single-dot"]')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'overview.summaryRange.names.all' }))
    expect(onPeriodChange).toHaveBeenCalledWith('all')
    expect(onPeriodChange).not.toHaveBeenCalledWith('1m')

    rerender(
      <OverviewNetWorth
        {...baseProps}
        currentComplete={false}
        currentAmount={null}
        currentCurrency={null}
        historyComplete={false}
        historyCurrency={null}
        historyPending
        history={[
          { date: '2026-01-01', netWorth: 12_345 },
          { date: '2026-02-01', netWorth: 67_890 },
        ]}
        period="all"
        onPeriodChange={onPeriodChange}
        historyUnavailableMessage="currency.recalculating"
        totalAssets={null}
        totalLiabilities={null}
        totalInvestments={null}
      />
    )
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(summary.querySelector('[data-testid="overview-summary-plain"]')).toHaveAttribute(
      'data-reason',
      'history-loading'
    )
    expect(summary).not.toHaveTextContent('$123.45')
    expect(summary).not.toHaveTextContent('$678.90')
    expect(screen.getByRole('button', { name: 'overview.summaryRange.names.all' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    rerender(
      <OverviewNetWorth
        {...baseProps}
        currentComplete={false}
        currentAmount={null}
        currentCurrency={null}
        historyComplete={false}
        historyCurrency={null}
        historyPending={false}
        history={[]}
        period="all"
        onPeriodChange={onPeriodChange}
        historyUnavailableMessage="currency.mainRequired"
        totalAssets={null}
        totalLiabilities={null}
        totalInvestments={null}
      />
    )
    expect(summary.querySelector('[data-testid="overview-summary-plain"]')).toHaveAttribute(
      'data-reason',
      'history-unavailable'
    )
    expect(summary).toHaveTextContent('currency.mainRequired')
    expect(screen.getByRole('group', { name: 'overview.summaryRange.label' })).toBeInTheDocument()

    rerender(
      <OverviewNetWorth
        {...baseProps}
        currentComplete={false}
        currentAmount={null}
        currentCurrency={null}
        historyComplete={false}
        historyPending={false}
        history={[]}
        period="month"
        onPeriodChange={onPeriodChange}
        historyUnavailableMessage="currency.missingDatedRates: EUR"
        totalAssets={null}
        totalLiabilities={null}
        totalInvestments={null}
      />
    )
    expect(summary).toHaveTextContent('currency.missingDatedRates: EUR')
    expect(summary.querySelector('[data-testid="overview-summary-composition"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'overview.summaryRange.names.all' }))
    expect(onPeriodChange).toHaveBeenLastCalledWith('all')
  })

  it('clears an out-of-range selection when the requested range changes and restores a settled line', async () => {
    const user = userEvent.setup()
    const onPeriodChange = vi.fn()
    const { rerender } = render(
      <OverviewNetWorth
        {...baseProps}
        history={[
          { date: '2026-01-01', netWorth: 100_000 },
          { date: '2026-03-01', netWorth: 115_000 },
        ]}
        onPeriodChange={onPeriodChange}
      />
    )
    const summary = document.getElementById('overview-summary-panel')!
    fireEvent.click(summary.querySelectorAll('[data-testid="overview-summary-chart-point"]')[1]!)
    expect(summary.querySelector('[data-testid="overview-summary-inspection"]')).toHaveTextContent(
      '$1,150.00'
    )

    rerender(
      <OverviewNetWorth
        {...baseProps}
        period="all"
        historyPending
        history={[
          { date: '2026-01-01', netWorth: 100_000 },
          { date: '2026-03-01', netWorth: 115_000 },
        ]}
        onPeriodChange={onPeriodChange}
      />
    )
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(summary.querySelector('[data-testid="overview-summary-inspection"]')).toBeNull()
    expect(summary).not.toHaveTextContent('$1,150.00')
    expect(summary.querySelector('strong')).toHaveTextContent('$750.00')

    rerender(
      <OverviewNetWorth
        {...baseProps}
        period="all"
        historyPending={false}
        historyComplete
        history={[
          { date: '2024-01-01', netWorth: 40_000 },
          { date: '2026-03-01', netWorth: 115_000 },
        ]}
        onPeriodChange={onPeriodChange}
      />
    )
    expect(summary.querySelector('[data-testid="line-chart"]')).toHaveAttribute(
      'data-points',
      '2024-01-01,2026-03-01'
    )
    expect(
      summary.querySelector('[data-testid="overview-summary-inspection"]')
    ).toBeEmptyDOMElement()
    expect(document.getElementById('overview-summary-recorded-snapshots')).toHaveTextContent(
      'Jan 1, 2024'
    )
    await user.click(screen.getByRole('button', { name: 'overview.summaryRange.names.month' }))
    expect(onPeriodChange).toHaveBeenCalledWith('month')
  })

  it('keeps three overview tabs mounted and moves them from the keyboard', async () => {
    const user = userEvent.setup()
    renderOverview()
    const tabs = [
      screen.getByRole('tab', { name: 'overview.views.summary' }),
      screen.getByRole('tab', { name: 'overview.views.history' }),
      screen.getByRole('tab', { name: 'overview.views.comparison' }),
    ]
    expect(document.getElementById('overview-summary-panel')).toBeTruthy()
    expect(document.getElementById('overview-history-panel')).toBeTruthy()
    expect(document.getElementById('overview-comparison-panel')).toBeTruthy()
    tabs[0]!.focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('overview-summary-panel')).toHaveAttribute('inert')
    expect(document.getElementById('overview-history-panel')).not.toHaveAttribute('inert')
    await user.keyboard('{ArrowRight}')
    expect(tabs[2]).toHaveFocus()
    expect(document.getElementById('overview-comparison-panel')).not.toHaveAttribute('hidden')
    await user.keyboard('{Home}')
    expect(tabs[0]).toHaveFocus()
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('overview-history-panel')).toHaveAttribute('hidden')
    expect(document.getElementById('overview-comparison-panel')).toHaveAttribute('inert')
  })
})
