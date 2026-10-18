import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { OverviewNetWorth, type NetWorthPeriod } from '@/components/dashboard/overview-net-worth'
import { buildRecordedBalanceModel } from '@/components/charts/recorded-balance-model'
import { summaryDateTickBudget } from '@/components/dashboard/overview-summary-visual'
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

vi.mock('recharts', () => {
  function renderAxisTicks(
    tick:
      | {
          (tickProps: {
            x?: number
            y?: number
            index?: number
            visibleTicksCount?: number
            payload?: { value?: number }
          }): React.ReactNode
        }
      | { fill?: string; fontSize?: number }
      | undefined,
    ticks: readonly number[] | undefined
  ) {
    if (typeof tick !== 'function' || !Array.isArray(ticks)) return null
    return ticks.map((value, index) => (
      <span key={`${value}-${index}`}>
        {tick({
          x: index === 0 ? 0 : 40,
          y: 16,
          index,
          visibleTicksCount: ticks.length,
          payload: { value },
        })}
      </span>
    ))
  }
  return {
    AreaChart: ({
      data,
      children,
      accessibilityLayer,
    }: {
      data?: Array<{ date: string; utcTimestamp?: number; amountCentavos?: number }>
      children?: React.ReactNode
      accessibilityLayer?: boolean
    }) => {
      chartPoints = data ?? []
      return (
        <div
          data-testid="area-chart"
          data-points={data?.map((point) => point.date).join(',') ?? ''}
          data-count={String(data?.length ?? 0)}
          data-timestamps={data?.map((point) => point.utcTimestamp ?? '').join(',') ?? ''}
          data-cents={data?.map((point) => point.amountCentavos ?? '').join(',') ?? ''}
          data-accessibility={accessibilityLayer === false ? 'off' : 'on'}
        >
          {children}
        </div>
      )
    },
    Area: ({
      type,
      connectNulls,
      fill,
      fillOpacity,
      baseValue,
      strokeWidth,
      isAnimationActive,
      dot,
    }: {
      type?: string
      connectNulls?: boolean
      fill?: string
      fillOpacity?: number
      baseValue?: number
      strokeWidth?: number
      isAnimationActive?: boolean
      dot?: (props: {
        cx?: number
        cy?: number
        index?: number
        payload?: { date?: string; netWorth?: number; sourceIndex?: number; utcTimestamp?: number }
      }) => React.ReactNode
    }) => (
      <div
        data-testid="area"
        data-type={type ?? ''}
        data-connect-nulls={connectNulls === false ? 'false' : 'true'}
        data-fill={fill ?? ''}
        data-fill-opacity={fillOpacity ?? ''}
        data-base={baseValue ?? ''}
        data-stroke-width={strokeWidth ?? ''}
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
    LineChart: ({
      data,
      children,
      accessibilityLayer,
    }: {
      data?: Array<{
        date: string
        netWorth?: number
        utcTimestamp?: number
        amountCentavos?: number
      }>
      children?: React.ReactNode
      accessibilityLayer?: boolean
    }) => {
      chartPoints = data ?? []
      return (
        <div
          data-testid="line-chart"
          data-points={data?.map((point) => point.date).join(',') ?? ''}
          data-count={String(data?.length ?? 0)}
          data-timestamps={data?.map((point) => point.utcTimestamp ?? '').join(',') ?? ''}
          data-cents={data?.map((point) => point.amountCentavos ?? '').join(',') ?? ''}
          data-accessibility={accessibilityLayer === false ? 'off' : 'on'}
        >
          {children}
        </div>
      )
    },
    Line: ({
      type,
      connectNulls,
      isAnimationActive,
      strokeWidth,
      fill,
      dot,
    }: {
      type?: string
      connectNulls?: boolean
      isAnimationActive?: boolean
      strokeWidth?: number
      fill?: string
      dot?: (props: {
        cx?: number
        cy?: number
        index?: number
        payload?: {
          date?: string
          netWorth?: number
          sourceIndex?: number
          utcTimestamp?: number
          amountCentavos?: number
        }
      }) => React.ReactNode
    }) => (
      <div
        data-testid="line"
        data-type={type ?? ''}
        data-connect-nulls={connectNulls === false ? 'false' : 'true'}
        data-animation={isAnimationActive === false ? 'off' : 'on'}
        data-stroke-width={strokeWidth ?? ''}
        data-fill={fill ?? ''}
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
    CartesianGrid: ({ vertical }: { vertical?: boolean }) => (
      <div data-testid="cartesian-grid" data-vertical={vertical === false ? 'false' : 'true'} />
    ),
    XAxis: (props: {
      dataKey?: string | number
      hide?: boolean
      type?: string
      scale?: string
      domain?: readonly number[]
      ticks?: readonly number[]
      interval?: number | string
      height?: number
      tick?:
        | { fill?: string; fontSize?: number }
        | ((tickProps: {
            x?: number
            y?: number
            index?: number
            visibleTicksCount?: number
            payload?: { value?: number }
          }) => React.ReactNode)
    }) => (
      <div
        data-testid="x-axis"
        data-key={props.dataKey === undefined ? '' : String(props.dataKey)}
        data-hide={props.hide ? 'true' : 'false'}
        data-type={props.type ?? ''}
        data-scale={props.scale ?? ''}
        data-domain={Array.isArray(props.domain) ? props.domain.join('|') : ''}
        data-ticks={Array.isArray(props.ticks) ? props.ticks.join('|') : ''}
        data-interval={props.interval ?? ''}
        data-height={props.height ?? ''}
        data-tick-fill={
          props.tick && typeof props.tick === 'object' && 'fill' in props.tick
            ? String(props.tick.fill)
            : ''
        }
        data-tick-size={
          props.tick && typeof props.tick === 'object' && 'fontSize' in props.tick
            ? String(props.tick.fontSize)
            : ''
        }
      >
        {renderAxisTicks(props.tick, props.ticks)}
      </div>
    ),
    YAxis: (props: {
      hide?: boolean
      domain?: readonly number[]
      ticks?: readonly number[]
      width?: number
      allowDataOverflow?: boolean
      interval?: number | string
      tick?:
        | { fill?: string; fontSize?: number }
        | ((tickProps: { x?: number; y?: number; payload?: { value?: number } }) => React.ReactNode)
    }) => (
      <div
        data-testid="y-axis"
        data-hide={props.hide ? 'true' : 'false'}
        data-width={props.width ?? ''}
        data-overflow={props.allowDataOverflow ? 'true' : 'false'}
        data-domain={Array.isArray(props.domain) ? props.domain.join('|') : ''}
        data-ticks={Array.isArray(props.ticks) ? props.ticks.join('|') : ''}
        data-interval={props.interval ?? ''}
      >
        {renderAxisTicks(props.tick, props.ticks)}
      </div>
    ),
    Tooltip: (props: {
      labelFormatter?: (label: unknown) => unknown
      formatter?: (value: unknown) => unknown
      content?: (contentProps: {
        active?: boolean
        payload?: ReadonlyArray<{ payload?: unknown }>
      }) => React.ReactNode
    }) => {
      if (typeof props.content === 'function') {
        return (
          <div data-testid="tooltip-binding">
            {props.content({
              active: true,
              payload: [
                {
                  payload: {
                    date: '2026-06-15',
                    amountCentavos: 123_400,
                    utcTimestamp: Date.UTC(2026, 5, 15),
                    sourceIndex: 1,
                  },
                },
              ],
            })}
          </div>
        )
      }
      const label = props.labelFormatter?.('2026-06-15')
      const formatted = props.formatter?.(123_400)
      return (
        <div
          data-testid="tooltip-binding"
          data-sample-label={typeof label === 'string' ? label : ''}
          data-sample-amount={Array.isArray(formatted) ? String(formatted[0]) : ''}
        />
      )
    },
    Legend: () => null,
  }
})

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
    expect(metricGrid).toHaveClass('grid-cols-2', 'sm:grid-cols-4')
    expect(metricGrid).not.toHaveClass('lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]')
    expect(metricGrid?.children).toHaveLength(4)
    expect(summary.querySelectorAll('.rounded-xl.border')).toHaveLength(0)
    expect(summary).not.toHaveClass('lg:flex', 'lg:items-center', 'invisible')
    expect(metricGrid).toHaveClass('w-full')
    expect(metricGrid).not.toHaveClass('lg:items-center')
    expect(summary).not.toHaveClass('justify-center')
    expect(summary.querySelector('.h-28')).toBeNull()
    expect(summary.querySelector('[data-testid="overview-summary-plot-frame"]')).toHaveClass(
      'h-[292px]',
      'px-0',
      'sm:px-6'
    )
    const figure = summary.querySelector('strong')
    expect(figure).toHaveClass('text-xl', 'sm:text-2xl')
    expect(figure).not.toHaveClass('text-3xl', 'text-4xl', 'text-5xl', 'xl:text-5xl')
    expect(summary.querySelector('.lg\\:mt-auto')).toBeNull()
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
    const historyArea = document
      .getElementById('overview-history-panel')
      ?.querySelector('[data-testid="area"]')
    expect(historyArea).toHaveAttribute('data-type', 'linear')
    expect(historyArea).toHaveAttribute('data-base', '0')
    expect(historyArea).toHaveAttribute('data-connect-nulls', 'false')
    expect(historyArea).toHaveAttribute('data-animation', 'off')
    expect(historyArea?.getAttribute('data-fill') ?? '').not.toContain('url(')
    expect(
      document.getElementById('overview-history-panel')?.querySelector('linearGradient')
    ).toBeNull()

    const table = document.getElementById('overview-summary-recorded-snapshots') as HTMLTableElement
    expect(table.closest('.sr-only')).toBeNull()
    expect(table.closest('details')).toBeTruthy()
    expect(table.closest('[role="img"]')).toBeNull()
    expect(table).not.toHaveAttribute('hidden')
    expect(
      summary.querySelector('[aria-describedby="overview-summary-recorded-snapshots"]')
    ).toBeNull()
    expect(table.querySelector('time[datetime="2026-01-01"]')).toHaveTextContent('Jan 1, 2026')
    expect(table.querySelector('time[datetime="2026-03-01"]')).toHaveTextContent('Mar 1, 2026')
    expect(table).toHaveTextContent('$1,000.00')
    expect(table).toHaveTextContent('$1,150.00')
    expect(table.caption?.textContent).toContain('Jan 1, 2026')
    expect(table.caption?.textContent).toContain('Mar 1, 2026')
    expect(table.caption?.textContent).toContain('USD')
    expect(table.caption?.textContent).toContain('overview.summaryRange.names.6m')
    const range = summary.querySelector('[data-testid="overview-summary-range"]')!
    expect(range).toHaveClass('flex-wrap', 'max-w-full', 'justify-end')
    expect(range.className.split(/\s+/)).not.toContain('w-full')
    expect(range.className).not.toContain('bg-muted')
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
    expect(summary.querySelector('[data-testid="line"]')).toHaveAttribute('data-stroke-width', '2')
    expect(summary.querySelector('[data-testid="line"]')).toHaveAttribute('data-fill', 'none')
    const caption = document.getElementById('overview-summary-recorded-caption')
    expect(caption).not.toHaveClass('sr-only')
    expect(caption).toHaveTextContent('overview.summaryChartTitle')
    expect(caption).toHaveTextContent('Jan 1, 2026')
    expect(caption).toHaveTextContent('Mar 1, 2026')
    expect(caption).toHaveTextContent('USD')
    const latest = summary.querySelector('[data-testid="overview-summary-latest"]')
    expect(latest).toHaveTextContent('$1,150.00')
    expect(latest).not.toHaveTextContent('$1.2K')
    expect(summary.querySelector('[data-testid="overview-summary-endpoints"]')).toBeNull()
  })

  it('binds a visible UTC date axis and full-money tooltip to recorded centavos', () => {
    const history = [
      { date: '2026-01-31', netWorth: 100_000 },
      { date: '2026-06-15', netWorth: 123_400 },
      { date: '2026-10-17', netWorth: 150_050 },
    ]
    render(<OverviewNetWorth {...baseProps} currentAmount={150_050} history={history} />)
    const summary = document.getElementById('overview-summary-panel')!
    const chart = summary.querySelector('[data-testid="line-chart"]')
    const model = buildRecordedBalanceModel(
      history.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
      'USD',
      { maxDateTicks: summaryDateTickBudget(window.innerWidth), locale: 'en' }
    )
    expect(model.status).toBe('series')
    if (model.status !== 'series') return
    expect(chart).toHaveAttribute('data-points', '2026-01-31,2026-06-15,2026-10-17')
    expect(chart).toHaveAttribute('data-count', '3')
    expect(chart).toHaveAttribute(
      'data-timestamps',
      model.points.map((point) => point.utcTimestamp).join(',')
    )
    expect(chart).toHaveAttribute('data-cents', '100000,123400,150050')
    expect(chart).toHaveAttribute('data-accessibility', 'off')
    expect(chart?.querySelector('[data-testid="line"]')).toHaveAttribute('data-type', 'linear')
    const axis = chart?.querySelector('[data-testid="x-axis"]')
    expect(axis).toHaveAttribute('data-key', 'utcTimestamp')
    expect(axis).toHaveAttribute('data-type', 'number')
    expect(axis).toHaveAttribute('data-scale', 'utc')
    expect(axis).toHaveAttribute('data-hide', 'false')
    expect(axis).toHaveAttribute('data-interval', '0')
    expect(axis).toHaveAttribute('data-domain', model.xDomain.join('|'))
    expect(axis).toHaveAttribute('data-ticks', model.dateTicks.join('|'))
    expect(Number(model.xDomain[0])).toBeGreaterThan(Date.UTC(2020, 0, 1))
    expect(chart?.querySelectorAll('[data-testid="x-axis"]')).toHaveLength(1)
    const yAxis = chart?.querySelector('[data-testid="y-axis"]')
    expect(yAxis).toHaveAttribute('data-hide', 'false')
    expect(Number(yAxis?.getAttribute('data-width'))).toBeGreaterThanOrEqual(64)
    expect(yAxis).toHaveAttribute('data-overflow', 'true')
    expect(yAxis).toHaveAttribute('data-interval', '0')
    expect(yAxis).toHaveAttribute('data-domain', model.yDomain.join('|'))
    expect(yAxis).toHaveAttribute('data-ticks', model.yTicks.join('|'))
    const tickTitles = [...(yAxis?.querySelectorAll('text') ?? [])].map((node) =>
      node.getAttribute('data-full')
    )
    expect(tickTitles.length).toBeGreaterThan(1)
    expect(new Set(tickTitles).size).toBe(tickTitles.length)
    expect(tickTitles.some((title) => title?.includes('$'))).toBe(true)
    const dateTitles = [...(axis?.querySelectorAll('text') ?? [])].map((node) =>
      node.getAttribute('data-full')
    )
    expect(dateTitles[0]).toContain('2026')
    const anchors = [...(axis?.querySelectorAll('text') ?? [])].map((node) =>
      node.getAttribute('data-anchor')
    )
    expect(anchors[0]).toBe('start')
    expect(anchors[anchors.length - 1]).toBe('end')
    const tickText = axis?.querySelector('text')
    expect(tickText?.getAttribute('fill')).toBe('var(--color-foreground)')
    expect(tickText?.getAttribute('font-size') ?? tickText?.getAttribute('fontsize')).toBe('12')
    const tooltip = chart?.querySelector('[data-testid="tooltip-binding"]')
    expect(tooltip).toHaveTextContent('Jun 15, 2026')
    expect(tooltip).toHaveTextContent('$1,234.00')
    expect(tooltip).not.toHaveTextContent(String(Date.UTC(2026, 5, 15)))
    expect(tooltip?.textContent).not.toMatch(/\$1\.2K|\$1K/i)
    expect(summary.querySelector('[data-testid="overview-summary-range"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'overview.period.all' })).not.toBeInTheDocument()
    expect(summary.querySelector('.h-28')).toBeNull()
    expect(summary.querySelector('[data-chart-box="292"]')).toHaveAttribute(
      'data-plot-inner',
      '244'
    )
    expect(
      Number(summary.querySelector('[data-plot-inner]')?.getAttribute('data-plot-inner'))
    ).toBeGreaterThanOrEqual(220)
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

  it('keeps a one-cent series on the model scale and states a flat balance without a fake line', () => {
    const oneCentHistory = [
      { date: '2026-01-01', netWorth: 1_000_000 },
      { date: '2026-02-01', netWorth: 1_000_001 },
    ]
    const { rerender } = render(<OverviewNetWorth {...baseProps} history={oneCentHistory} />)
    const summary = document.getElementById('overview-summary-panel')!
    const model = buildRecordedBalanceModel(
      oneCentHistory.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
      'USD',
      { maxDateTicks: summaryDateTickBudget(window.innerWidth), locale: 'en' }
    )
    expect(model.status).toBe('series')
    if (model.status !== 'series') return
    const summaryAxis = summary.querySelector('[data-testid="y-axis"]')
    expect(summaryAxis).toHaveAttribute('data-hide', 'false')
    expect(summaryAxis).toHaveAttribute('data-domain', model.yDomain.join('|'))
    expect(Number(model.yDomain[0])).toBeGreaterThan(0)
    expect(model.yDomain[1] - model.yDomain[0]).toBeGreaterThan(1)
    expect(summary).toHaveTextContent('$10,000.01')
    expect(summary.querySelector('[data-testid="line-chart"]')).toHaveAttribute('data-count', '2')

    rerender(
      <OverviewNetWorth
        {...baseProps}
        history={[
          { date: '2025-12-31', netWorth: 50_000 },
          { date: '2026-01-02', netWorth: 50_000 },
        ]}
      />
    )
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(summary.querySelector('[data-testid="y-axis"]')).toBeNull()
    expect(summary.querySelector('[data-testid="overview-summary-flat"]')).toHaveTextContent(
      'overview.summaryUnchanged'
    )
    expect(summary.querySelector('time[datetime="2025-12-31"]')).toHaveTextContent('2025')
    expect(summary.querySelector('time[datetime="2026-01-02"]')).toHaveTextContent('2026')
    expect(summary).toHaveTextContent('$500.00')

    const historyPanel = document.getElementById('overview-history-panel')
    expect(historyPanel?.querySelector('[data-testid="y-axis"]')).toBeNull()
    expect(historyPanel?.querySelector('[data-testid="area-chart"]')).toBeNull()
    expect(historyPanel?.querySelector('[data-testid="overview-history-flat"]')).toHaveTextContent(
      'overview.summaryUnchanged'
    )
    expect(historyPanel?.querySelector('[data-testid="overview-history-plot"]')).toBeNull()
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
    expect(enDashboard.overview.summaryChartTitle).toBe('Recorded net worth')
    expect(esDashboard.overview.summaryChartTitle).toBe('Patrimonio neto registrado')
    expect(enDashboard.overview.summaryDisplay.line).toBe('Line')
    expect(enDashboard.overview.summaryDisplay.area).toBe('Area')
    expect(esDashboard.overview.summaryDisplay.area).toBe('Área')
    expect(enDashboard.overview.summaryRange.labels).not.toHaveProperty('1m')
    expect(esDashboard.overview.summaryRange.labels.month).toBe('MTD')
    expect(esDashboard.overview.summaryRange.names.month).toBe('Este mes')
    expect(esDashboard.overview.summaryRange.names['1y']).toBe('1 año')
    expect(JSON.stringify(enDashboard.overview.summaryRange)).not.toMatch(/rolling|1M|1 month/)

    renderOverview()
    const group = screen.getByRole('group', { name: 'overview.summaryRange.label' })
    expect(group).toHaveClass(
      'flex-wrap',
      'max-w-full',
      'justify-end',
      'motion-reduce:transition-none'
    )
    expect(group.className.split(/\s+/)).not.toContain('w-full')
    expect(group.className).not.toContain('bg-muted')
    expect(group.className).not.toContain('overflow-x-auto')
    const chart = document.querySelector('[data-testid="overview-summary-recorded-line"]')
    expect(chart).toBeTruthy()
    expect(
      chart && chart.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    for (const item of ['month', '3m', '6m', '1y', 'all'] as const) {
      const button = screen.getByRole('button', { name: `overview.summaryRange.names.${item}` })
      expect(button).toHaveClass(
        'min-h-11',
        'min-w-11',
        'sm:min-h-8',
        'sm:min-w-8',
        'motion-reduce:transition-none'
      )
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
    expect(recorded.closest('.sr-only')).toBeNull()
    expect(recorded.closest('details')).toBeTruthy()
    expect(recorded.closest('[role="img"]')).toBeNull()
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

  it('anchors two date ticks at 320, keeps area on zero, and does not invent a series', async () => {
    const user = userEvent.setup()
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    const history = [
      { date: '2026-01-31', netWorth: 1_888_150 },
      { date: '2026-04-30', netWorth: 2_744_850 },
      { date: '2026-07-31', netWorth: 3_520_770 },
      { date: '2026-10-18', netWorth: 4_265_840 },
    ]
    const { rerender } = render(
      <OverviewNetWorth {...baseProps} history={history} historyCurrency="USD" />
    )
    const summary = document.getElementById('overview-summary-panel')!
    const narrow = buildRecordedBalanceModel(
      history.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
      'USD',
      { maxDateTicks: 2, locale: 'en' }
    )
    expect(narrow.status).toBe('series')
    if (narrow.status !== 'series') return
    expect(summary.querySelector('[data-testid="x-axis"]')).toHaveAttribute(
      'data-ticks',
      narrow.dateTicks.join('|')
    )
    expect(narrow.dateTicks).toHaveLength(2)
    expect(summary.querySelector('[data-testid="overview-summary-plot-frame"]')).toHaveAttribute(
      'data-tick-budget',
      '2'
    )
    expect(summary.querySelector('linearGradient')).toBeNull()
    expect(summary.querySelector('[data-testid="line-chart"]')).toHaveAttribute('data-count', '4')

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    await user.click(screen.getByRole('button', { name: 'overview.summaryDisplay.label' }))
    await user.click(screen.getByRole('button', { name: 'overview.summaryDisplay.area' }))
    const areaModel = buildRecordedBalanceModel(
      history.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
      'USD',
      {
        maxDateTicks: summaryDateTickBudget(window.innerWidth),
        includeZero: true,
        locale: 'en',
      }
    )
    expect(areaModel.status).toBe('series')
    if (areaModel.status !== 'series') return
    const area = summary.querySelector('[data-testid="area"]')
    expect(summary.querySelector('[data-testid="line-chart"]')).toBeNull()
    expect(summary.querySelector('[data-testid="area-chart"]')).toHaveAttribute(
      'data-points',
      history.map((point) => point.date).join(',')
    )
    expect(area).toHaveAttribute('data-type', 'linear')
    expect(area).toHaveAttribute('data-connect-nulls', 'false')
    expect(area).toHaveAttribute('data-base', '0')
    expect(area).toHaveAttribute('data-fill', 'var(--color-chart-1)')
    expect(area).not.toHaveAttribute('data-fill', 'url(#overviewNetWorthFill)')
    expect(summary.querySelector('[data-testid="y-axis"]')).toHaveAttribute(
      'data-domain',
      areaModel.yDomain.join('|')
    )
    expect(Number(areaModel.yDomain[0])).toBeLessThanOrEqual(0)
    expect(summary.querySelector('[data-include-zero="true"]')).toBeTruthy()
    expect(summary.querySelector('linearGradient')).toBeNull()

    rerender(
      <OverviewNetWorth
        {...baseProps}
        historyCurrency="USD"
        history={[
          { date: '2026-01-01', netWorth: -200_000 },
          { date: '2026-03-01', netWorth: -100_000 },
        ]}
      />
    )
    const titles = [
      ...(summary.querySelector('[data-testid="y-axis"]')?.querySelectorAll('text') ?? []),
    ].map((node) => node.getAttribute('data-full') ?? '')
    expect(titles.length).toBeGreaterThan(0)
    expect(
      titles.some((title) => title.includes('-') || title.includes('−') || title.includes('('))
    ).toBe(true)
    expect(new Set(titles).size).toBe(titles.length)
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

describe('Overview history recorded chart', () => {
  const history = [
    { date: '2026-01-31', netWorth: 1_888_150 },
    { date: '2026-04-30', netWorth: 2_744_850 },
    { date: '2026-07-31', netWorth: 3_520_770 },
    { date: '2026-10-18', netWorth: -4_265_840 },
  ]

  function renderHistory(width: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    render(
      <OverviewNetWorth
        {...baseProps}
        history={history}
        historyCurrency="USD"
        onPeriodChange={() => {}}
      />
    )
    return document.getElementById('overview-history-panel')!
  }

  it('plots original centavos on a UTC currency axis without a gradient or invented rows', () => {
    const originalWidth = window.innerWidth
    const panel = renderHistory(1280)
    const model = buildRecordedBalanceModel(
      history.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
      'USD',
      { includeZero: true, maxDateTicks: 5, locale: 'en' }
    )
    expect(model.status).toBe('series')
    if (model.status !== 'series') return
    const chart = panel.querySelector('[data-testid="area-chart"]')
    expect(chart).toHaveAttribute('data-points', history.map((point) => point.date).join(','))
    expect(chart).toHaveAttribute('data-count', String(history.length))
    expect(chart).toHaveAttribute('data-cents', history.map((point) => point.netWorth).join(','))
    expect(chart).toHaveAttribute(
      'data-timestamps',
      model.points.map((point) => point.utcTimestamp).join(',')
    )
    expect(chart).toHaveAttribute('data-accessibility', 'off')
    const axis = chart?.querySelector('[data-testid="x-axis"]')
    expect(axis).toHaveAttribute('data-key', 'utcTimestamp')
    expect(axis).toHaveAttribute('data-type', 'number')
    expect(axis).toHaveAttribute('data-scale', 'utc')
    expect(axis).toHaveAttribute('data-domain', model.xDomain.join('|'))
    expect(axis).toHaveAttribute('data-ticks', model.dateTicks.join('|'))
    expect(axis).toHaveAttribute('data-interval', '0')
    expect(model.dateTicks[0]).toBe(model.xDomain[0])
    expect(model.dateTicks[model.dateTicks.length - 1]).toBe(model.xDomain[1])
    expect(new Set(model.dateTicks).size).toBe(model.dateTicks.length)
    const anchors = [...(axis?.querySelectorAll('text') ?? [])].map((node) =>
      node.getAttribute('data-anchor')
    )
    expect(anchors[0]).toBe('start')
    expect(anchors[anchors.length - 1]).toBe('end')
    const tickText = axis?.querySelector('text')
    expect(tickText?.getAttribute('fill')).toBe('var(--color-foreground)')
    expect(tickText?.getAttribute('font-size') ?? tickText?.getAttribute('fontsize')).toBe('12')
    const yAxis = chart?.querySelector('[data-testid="y-axis"]')
    expect(Number(yAxis?.getAttribute('data-width'))).toBeGreaterThanOrEqual(64)
    expect(yAxis).toHaveAttribute('data-domain', model.yDomain.join('|'))
    expect(yAxis).toHaveAttribute('data-ticks', model.yTicks.join('|'))
    expect(Number(model.yDomain[0])).toBeLessThan(0)
    expect(Number(model.yDomain[1])).toBeGreaterThan(0)
    const moneyTitles = [...(yAxis?.querySelectorAll('text') ?? [])].map((node) =>
      node.getAttribute('data-full')
    )
    expect(moneyTitles.length).toBeGreaterThan(1)
    expect(new Set(moneyTitles).size).toBe(moneyTitles.length)
    expect(
      moneyTitles.some(
        (title) => title?.includes('-') || title?.includes('−') || title?.includes('(')
      )
    ).toBe(true)
    expect(panel.querySelector('[data-testid="overview-history-plot"]')).toHaveAttribute(
      'data-chart-box',
      '300'
    )
    expect(
      Number(panel.querySelector('[data-plot-inner]')?.getAttribute('data-plot-inner'))
    ).toBeGreaterThanOrEqual(220)
    expect(panel.querySelector('linearGradient')).toBeNull()
    expect(document.getElementById('overviewNetWorthFill')).toBeNull()
    expect(document.querySelectorAll('#overview-summary-recorded-snapshots')).toHaveLength(1)
    expect(document.querySelectorAll('#overview-history-recorded-snapshots')).toHaveLength(1)
    const table = document.getElementById('overview-history-recorded-snapshots')
    expect(table?.closest('[role="img"]')).toBeNull()
    expect(table?.closest('details')).toBeTruthy()
    expect(table?.querySelector('time[datetime="2026-01-31"]')).toHaveTextContent('2026')
    expect(table).toHaveTextContent('-$42,658.40')
    expect(table).toHaveTextContent('$18,881.50')
    const tooltip = chart?.querySelector('[data-testid="tooltip-binding"]')
    expect(tooltip).toHaveTextContent('Jun 15, 2026')
    expect(tooltip).toHaveTextContent('$1,234.00')
    expect(tooltip?.textContent).not.toMatch(/\$1\.2K|\$1K/i)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  it('anchors two date ticks at 320 and three at 375, with the range under the plot', async () => {
    const user = userEvent.setup()
    const originalWidth = window.innerWidth
    const periods: string[] = []
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    const { unmount } = render(
      <OverviewNetWorth
        {...baseProps}
        history={history}
        historyCurrency="USD"
        onPeriodChange={(next) => periods.push(next)}
      />
    )
    const narrow = buildRecordedBalanceModel(
      history.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
      'USD',
      { includeZero: true, maxDateTicks: 2, locale: 'en' }
    )
    expect(narrow.status).toBe('series')
    if (narrow.status !== 'series') return
    const panel = document.getElementById('overview-history-panel')!
    expect(panel.querySelector('[data-testid="x-axis"]')).toHaveAttribute(
      'data-ticks',
      narrow.dateTicks.join('|')
    )
    expect(narrow.dateTicks).toHaveLength(2)
    expect(panel.querySelector('[data-testid="overview-history-plot"]')).toHaveAttribute(
      'data-tick-budget',
      '2'
    )
    unmount()

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    render(
      <OverviewNetWorth
        {...baseProps}
        history={history}
        historyCurrency="USD"
        onPeriodChange={(next) => periods.push(next)}
      />
    )
    const mid = buildRecordedBalanceModel(
      history.map((point) => ({ date: point.date, amountCentavos: point.netWorth })),
      'USD',
      { includeZero: true, maxDateTicks: 3, locale: 'en' }
    )
    expect(mid.status).toBe('series')
    if (mid.status !== 'series') return
    const phone = document.getElementById('overview-history-panel')!
    expect(phone.querySelector('[data-testid="x-axis"]')).toHaveAttribute(
      'data-ticks',
      mid.dateTicks.join('|')
    )
    expect(mid.dateTicks).toHaveLength(3)
    expect(new Set(mid.dateTicks).size).toBe(3)
    expect(phone.querySelector('[data-testid="overview-history-plot"]')).toHaveAttribute(
      'data-tick-budget',
      '3'
    )

    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    const plot = phone.querySelector('[data-testid="overview-history-plot"]')!
    const range = phone.querySelector('[data-testid="overview-history-range"]')!
    expect(plot.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(range).toHaveClass('flex-wrap', 'max-w-full', 'justify-end')
    expect(range.className.split(/\s+/)).not.toContain('w-full')
    expect(range.className).not.toContain('overflow-x-auto')
    expect(range.className).not.toContain('bg-muted')
    for (const item of ['month', '3m', '6m', 'ytd', '1y', 'all']) {
      const button = screen.getByRole('button', { name: `overview.period.${item}` })
      expect(button).toHaveClass('min-h-11', 'min-w-11', 'sm:min-h-8', 'sm:min-w-8')
    }
    await user.click(screen.getByRole('button', { name: 'overview.period.ytd' }))
    expect(periods).toEqual(['ytd'])
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  it('does not reserve a plot for one snapshot or invalid dates', () => {
    const { rerender } = render(
      <OverviewNetWorth
        {...baseProps}
        history={[{ date: '2026-04-02', netWorth: 10_000 }]}
        historyCurrency="USD"
      />
    )
    const panel = document.getElementById('overview-history-panel')!
    expect(panel.querySelector('[data-testid="overview-history-plot"]')).toBeNull()
    expect(panel.querySelector('[data-testid="area-chart"]')).toBeNull()
    expect(panel.querySelector('[data-testid="overview-history-single"]')).toHaveTextContent(
      'overview.summaryOneSnapshot'
    )
    expect(panel.querySelector('[data-testid="overview-history-single"]')).toHaveTextContent(
      '$100.00'
    )
    expect(panel.querySelector('[class*="h-48"]')).toBeNull()

    rerender(
      <OverviewNetWorth
        {...baseProps}
        history={[{ date: 'not-a-date', netWorth: 75_000 }]}
        historyCurrency="USD"
      />
    )
    expect(panel.querySelector('[data-testid="area-chart"]')).toBeNull()
    expect(panel.querySelector('[data-testid="overview-history-invalid"]')).toBeTruthy()
    expect(panel.querySelector('time[datetime="not-a-date"]')).toHaveTextContent('not-a-date')
    expect(panel).toHaveTextContent('$750.00')
  })
})
