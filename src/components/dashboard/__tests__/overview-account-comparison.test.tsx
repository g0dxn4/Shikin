import { useState, type ComponentProps } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewAccountComparison } from '@/components/dashboard/overview-account-comparison'
import type {
  ComparisonDisplayMode,
  NetWorthPeriod,
} from '@/components/dashboard/overview-account-comparison-helpers'
import { buildRecordedBalanceModel } from '@/components/charts/recorded-balance-model'
import enDashboard from '@/i18n/locales/en/dashboard.json'
import esDashboard from '@/i18n/locales/es/dashboard.json'
import type { Account } from '@/types/database'
import { useCurrencyStore } from '@/stores/currency-store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}))

const defaultFirstHistory = [
  { date: '2026-01-01', balance: -20_000 },
  { date: '2026-03-01', balance: -5_000 },
]
const defaultSecondHistory = [
  { date: '2026-02-01', balance: 100_000 },
  { date: '2026-03-01', balance: 120_000 },
]

const history = vi.hoisted(() => ({
  firstHistory: [
    { date: '2026-01-01', balance: -20_000 },
    { date: '2026-03-01', balance: -5_000 },
  ],
  secondHistory: [
    { date: '2026-02-01', balance: 100_000 },
    { date: '2026-03-01', balance: 120_000 },
  ],
  isLoading: false,
  error: null as string | null,
}))

vi.mock('@/components/dashboard/use-overview-account-comparison', () => ({
  useOverviewAccountComparison: () => history,
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

let comparisonChartRows: Array<{
  date: string
  first: number | null
  second: number | null
  utcTimestamp?: number
}> = []

vi.mock('recharts', () => {
  function renderAxisTicks(
    tick:
      | ((tickProps: {
          x?: number
          y?: number
          index?: number
          visibleTicksCount?: number
          payload?: { value?: number }
        }) => React.ReactNode)
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
    LineChart: ({
      data,
      children,
      accessibilityLayer,
    }: {
      data?: Array<{
        date: string
        first: number | null
        second: number | null
        utcTimestamp?: number
      }>
      children?: React.ReactNode
      accessibilityLayer?: boolean
    }) => {
      comparisonChartRows = data ?? []
      return (
        <div
          data-testid="line-chart"
          data-points={data?.map((point) => point.date).join(',') ?? ''}
          data-count={String(data?.length ?? 0)}
          data-first={
            data
              ?.map((point) =>
                point.first === null || point.first === undefined ? 'null' : String(point.first)
              )
              .join(',') ?? ''
          }
          data-second={
            data
              ?.map((point) =>
                point.second === null || point.second === undefined ? 'null' : String(point.second)
              )
              .join(',') ?? ''
          }
          data-timestamps={data?.map((point) => point.utcTimestamp ?? '').join(',') ?? ''}
          data-accessibility={accessibilityLayer === false ? 'off' : 'on'}
        >
          {children}
        </div>
      )
    },
    Line: ({
      type,
      dataKey,
      connectNulls,
      isAnimationActive,
      strokeWidth,
    }: {
      type?: string
      dataKey?: string
      connectNulls?: boolean
      isAnimationActive?: boolean
      strokeWidth?: number
    }) => (
      <div
        data-testid="line"
        data-key={dataKey ?? ''}
        data-type={type ?? ''}
        data-connect-nulls={connectNulls ? 'true' : 'false'}
        data-animation={isAnimationActive === false ? 'off' : 'on'}
        data-stroke-width={strokeWidth ?? ''}
      />
    ),
    CartesianGrid: ({ vertical }: { vertical?: boolean }) => (
      <div data-testid="cartesian-grid" data-vertical={vertical === false ? 'false' : 'true'} />
    ),
    XAxis: (props: {
      dataKey?: string
      type?: string
      scale?: string
      domain?: readonly number[]
      ticks?: readonly number[]
      interval?: number | string
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
        data-key={props.dataKey ?? ''}
        data-type={props.type ?? ''}
        data-scale={props.scale ?? ''}
        data-domain={Array.isArray(props.domain) ? props.domain.join('|') : ''}
        data-ticks={Array.isArray(props.ticks) ? props.ticks.join('|') : ''}
        data-interval={props.interval ?? ''}
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
      domain?: readonly number[]
      ticks?: readonly number[]
      width?: number
      interval?: number | string
      tick?:
        | { fill?: string; fontSize?: number }
        | ((tickProps: { x?: number; y?: number; payload?: { value?: number } }) => React.ReactNode)
    }) => (
      <div
        data-testid="y-axis"
        data-width={props.width ?? ''}
        data-domain={Array.isArray(props.domain) ? props.domain.join('|') : ''}
        data-ticks={Array.isArray(props.ticks) ? props.ticks.join('|') : ''}
        data-interval={props.interval ?? ''}
      >
        {renderAxisTicks(props.tick, props.ticks)}
      </div>
    ),
    Tooltip: (props: {
      content?: (contentProps: {
        active?: boolean
        payload?: ReadonlyArray<{ payload?: unknown }>
      }) => React.ReactNode
    }) => {
      if (typeof props.content !== 'function') return null
      const point = comparisonChartRows[0]
      return (
        <div data-testid="tooltip-binding">
          {props.content({
            active: true,
            payload: point ? [{ payload: point }] : [],
          })}
        </div>
      )
    },
    Legend: () => null,
  }
})

const accounts = [
  {
    id: 'card',
    name: 'Nu Card',
    type: 'credit_card',
    currency: 'USD',
    balance: -5_000,
  },
  {
    id: 'checking',
    name: 'BBVA',
    type: 'checking',
    currency: 'EUR',
    balance: 120_000,
  },
] as Account[]

function rate(fromCurrency: string, toCurrency: string, rateDecimal: string) {
  return {
    id: `${fromCurrency}-${toCurrency}-${rateDecimal}`,
    fromCurrency,
    toCurrency,
    rateDecimal,
    effectiveFrom: '2000-01-01',
    supersedesRateId: null,
    createdAt: '',
    sourceNote: null,
  }
}

function ComparisonHarness(
  props: Omit<
    ComponentProps<typeof OverviewAccountComparison>,
    'selection' | 'onSelectionChange' | 'period' | 'onPeriodChange' | 'mode' | 'onModeChange'
  >
) {
  const [selection, setSelection] = useState<[string, string]>(['', ''])
  const [period, setPeriod] = useState<NetWorthPeriod>('6m')
  const [mode, setMode] = useState<ComparisonDisplayMode>('balance')
  return (
    <OverviewAccountComparison
      {...props}
      selection={selection}
      onSelectionChange={setSelection}
      period={period}
      onPeriodChange={setPeriod}
      mode={mode}
      onModeChange={setMode}
    />
  )
}

function metricCard(name: string) {
  const term = screen.getAllByText(name).find((element) => element.tagName === 'DT')
  expect(term).toBeTruthy()
  return term!.closest('div')!
}

describe('OverviewAccountComparison', () => {
  beforeEach(() => {
    history.firstHistory = defaultFirstHistory
    history.secondHistory = defaultSecondHistory
    history.isLoading = false
    history.error = null
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [rate('EUR', 'USD', '2')],
    })
  })

  it('shows negative card debt, missing dates as dashes, and account-specific change baselines', async () => {
    const user = userEvent.setup()
    render(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={undefined}
      />
    )

    expect(screen.getByText('overview.comparison.debtBalance')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('—')).toBeInTheDocument()
    expect(within(rows[2]).getByText('—')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'overview.comparison.change' }))
    expect(screen.getAllByText(/Jan 1, 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Feb 1, 2026/).length).toBeGreaterThan(0)
    expect(within(screen.getAllByRole('row')[3]).getByText('$150.00')).toBeInTheDocument()
    expect(within(screen.getAllByRole('row')[3]).getByText('$400.00')).toBeInTheDocument()
  })

  it('recomputes when configured main currency changes', () => {
    render(<ComparisonHarness accounts={accounts} preferredCurrency="USD" />)
    expect(screen.getAllByText('$2,400.00').length).toBeGreaterThan(0)

    act(() =>
      useCurrencyStore.setState({
        mainCurrency: 'EUR',
        preferredCurrency: 'EUR',
        manualRates: [rate('USD', 'EUR', '0.5')],
      })
    )
    expect(screen.getAllByText('€1,200.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-€25.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('€2,400.00')).not.toBeInTheDocument()
  })

  it('recomputes historical conversion when dated manual authority changes', () => {
    render(<ComparisonHarness accounts={accounts} preferredCurrency="USD" />)
    expect(screen.getAllByText('$2,400.00').length).toBeGreaterThan(0)

    act(() => useCurrencyStore.setState({ manualRates: [rate('EUR', 'USD', '3')] }))
    expect(screen.getAllByText('$3,600.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('$2,400.00')).not.toBeInTheDocument()

    act(() => useCurrencyStore.setState({ manualRates: [] }))
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.missingRates EUR')
    expect(screen.queryByText('$3,600.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()

    act(() => useCurrencyStore.setState({ manualRates: [rate('EUR', 'USD', '0')] }))
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.invalidConversion')
  })

  it('labels each account with its own latest non-null snapshot date, not the shared series end', async () => {
    history.firstHistory = [
      { date: '2026-01-01', balance: -20_000 },
      { date: '2026-03-01', balance: -5_000 },
    ]
    history.secondHistory = [
      { date: '2026-02-01', balance: 100_000 },
      { date: '2026-04-15', balance: 150_000 },
    ]
    const user = userEvent.setup()
    render(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={undefined}
      />
    )

    expect(
      within(metricCard('Nu Card')).getByText(/overview.comparison.lastRecorded Mar 1, 2026/)
    ).toBeInTheDocument()
    expect(within(metricCard('Nu Card')).queryByText(/Apr 15, 2026/)).not.toBeInTheDocument()
    expect(
      within(metricCard('BBVA')).getByText(/overview.comparison.lastRecorded Apr 15, 2026/)
    ).toBeInTheDocument()
    expect(within(metricCard('BBVA')).queryByText(/Mar 1, 2026/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'overview.comparison.change' }))
    expect(
      within(metricCard('Nu Card')).getByText(/overview.comparison.lastRecorded Mar 1, 2026/)
    ).toBeInTheDocument()
    expect(
      within(metricCard('BBVA')).getByText(/overview.comparison.lastRecorded Apr 15, 2026/)
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Jan 1, 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Feb 1, 2026/).length).toBeGreaterThan(0)
  })

  it('does not invent last-recorded dates while loading, on error, or without history', () => {
    history.isLoading = true
    const { rerender } = render(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={undefined}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('overview.comparison.loading')
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overview-comparison-plot')).not.toBeInTheDocument()

    history.isLoading = false
    history.error = 'history unavailable'
    rerender(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={undefined}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.loadError')
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()

    history.error = null
    history.firstHistory = []
    history.secondHistory = []
    rerender(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={undefined}
      />
    )
    expect(screen.getByText(/overview.comparison.noHistory/)).toBeInTheDocument()
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(document.querySelector('[class*="h-48"]')).toBeNull()
    expect(document.querySelector('[class*="h-[300px]"]')).toBeNull()
  })

  it('plots each account on a shared UTC currency axis without filling gaps as zero', () => {
    expect(enDashboard.overview.comparison.join).toMatch(/not zero|gap/i)
    expect(esDashboard.overview.comparison.join).not.toBe(enDashboard.overview.comparison.join)
    expect(esDashboard.overview.comparison.noLine).toMatch(/dos registros/)

    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    render(<ComparisonHarness accounts={accounts} preferredCurrency="USD" />)
    const chart = screen.getByTestId('line-chart')
    const axisRows = [
      { date: '2026-01-01', amountCentavos: -20_000 },
      { date: '2026-02-01', amountCentavos: 200_000 },
      { date: '2026-03-01', amountCentavos: -5_000 },
      { date: '2026-03-01', amountCentavos: 240_000 },
    ]
    const model = buildRecordedBalanceModel(axisRows, 'USD', {
      includeZero: false,
      maxDateTicks: 5,
      locale: 'en',
    })
    expect(model.status).toBe('series')
    if (model.status !== 'series') return
    expect(chart).toHaveAttribute('data-count', '3')
    expect(chart).toHaveAttribute('data-points', '2026-01-01,2026-02-01,2026-03-01')
    expect(chart).toHaveAttribute('data-first', '-20000,null,-5000')
    expect(chart).toHaveAttribute('data-second', 'null,200000,240000')
    expect(chart).toHaveAttribute(
      'data-timestamps',
      ['2026-01-01', '2026-02-01', '2026-03-01']
        .map((date) => model.points.find((point) => point.date === date)?.utcTimestamp)
        .join(',')
    )
    const timestamps = chart.getAttribute('data-timestamps')?.split(',') ?? []
    expect(timestamps).toHaveLength(3)
    expect(Number(timestamps[0])).toBeLessThan(Number(timestamps[1]))
    expect(Number(timestamps[1])).toBeLessThan(Number(timestamps[2]))
    expect(chart).toHaveAttribute('data-accessibility', 'off')
    expect(chart.querySelectorAll('[data-testid="line"]')).toHaveLength(2)
    for (const line of chart.querySelectorAll('[data-testid="line"]')) {
      expect(line).toHaveAttribute('data-type', 'linear')
      expect(line).toHaveAttribute('data-connect-nulls', 'true')
      expect(line).toHaveAttribute('data-animation', 'off')
      expect(line).not.toHaveAttribute('data-key', 'amountCentavos')
    }
    expect(chart.querySelector('[data-testid="line"]')).toHaveAttribute('data-key', 'first')
    const axis = chart.querySelector('[data-testid="x-axis"]')
    expect(axis).toHaveAttribute('data-key', 'utcTimestamp')
    expect(axis).toHaveAttribute('data-type', 'number')
    expect(axis).toHaveAttribute('data-scale', 'utc')
    expect(axis).toHaveAttribute('data-domain', model.xDomain.join('|'))
    expect(axis).toHaveAttribute('data-ticks', model.dateTicks.join('|'))
    expect(axis?.querySelector('text')?.getAttribute('fill')).toBe('var(--color-foreground)')
    expect(axis?.querySelector('text')?.getAttribute('font-size')).toBe('12')
    const yAxis = chart.querySelector('[data-testid="y-axis"]')
    expect(Number(yAxis?.getAttribute('data-width'))).toBeGreaterThanOrEqual(64)
    expect(yAxis).toHaveAttribute('data-domain', model.yDomain.join('|'))
    expect(yAxis).toHaveAttribute('data-ticks', model.yTicks.join('|'))
    expect(Number(model.yDomain[0])).toBeLessThan(0)
    expect(model.yDomain[1]).toBeGreaterThan(0)
    const moneyNodes = [...(yAxis?.querySelectorAll('text') ?? [])]
    expect(moneyNodes.map((node) => node.textContent)).toEqual(model.yTickLabels)
    const moneyTitles = moneyNodes.map((node) => node.getAttribute('data-full'))
    expect(new Set(moneyTitles).size).toBe(moneyTitles.length)
    expect(moneyTitles.every((title) => title?.includes('$'))).toBe(true)
    const negativeTicks = model.yTicks.filter((tick) => tick < 0)
    if (negativeTicks.length > 0) {
      expect(
        moneyTitles.some(
          (title) => title?.includes('-') || title?.includes('−') || title?.includes('(')
        )
      ).toBe(true)
    }
    expect(screen.getByTestId('overview-comparison-plot')).toHaveAttribute('data-chart-box', '300')
    expect(
      Number(screen.getByTestId('overview-comparison-plot').getAttribute('data-plot-inner'))
    ).toBeGreaterThanOrEqual(220)
    expect(screen.getByTestId('overview-comparison-plot')).toHaveAttribute(
      'data-include-zero',
      'false'
    )
    expect(screen.getByTestId('overview-comparison-plot')).toHaveAttribute('data-point-count', '3')
    const tooltip = screen.getByTestId('tooltip-binding')
    expect(tooltip).toHaveTextContent('Jan 1, 2026')
    expect(tooltip).toHaveTextContent('-$200.00')
    expect(tooltip).not.toHaveTextContent('$0.00')
    expect(tooltip).not.toHaveTextContent('BBVA')
    expect(screen.getByText('overview.comparison.join')).toBeInTheDocument()
    const plot = screen.getByTestId('overview-comparison-plot')
    const controls = screen.getByTestId('overview-comparison-controls')
    expect(plot.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(controls).toHaveClass('justify-end', 'flex-wrap')
    expect(controls.className.split(/\s+/)).not.toContain('w-full')
    expect(screen.getByRole('button', { name: 'overview.comparison.change' })).toHaveClass(
      'min-h-11',
      'sm:min-h-8'
    )
    expect(screen.getByLabelText('overview.comparison.firstAccount')).toBeInTheDocument()
    const table = document.getElementById('overview-comparison-recorded-snapshots')
    expect(table?.closest('[role="img"]')).toBeNull()
    expect(within(table as HTMLElement).getAllByRole('row')[1]).toHaveTextContent('—')
    expect(table).toHaveTextContent('-$200.00')
    expect(table).toHaveTextContent('$2,400.00')
    expect(table).not.toHaveTextContent('$0.00')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  it('does not draw a line for a single snapshot per account', () => {
    history.firstHistory = [{ date: '2026-03-01', balance: -5_000 }]
    history.secondHistory = [{ date: '2026-04-15', balance: 100_000 }]
    render(<ComparisonHarness accounts={accounts} preferredCurrency="USD" />)
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overview-comparison-plot')).not.toBeInTheDocument()
    expect(screen.getByTestId('overview-comparison-no-line')).toHaveTextContent(
      'overview.comparison.noLine'
    )
    expect(screen.getByText(/overview.comparison.lastRecorded Mar 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/overview.comparison.lastRecorded Apr 15, 2026/)).toBeInTheDocument()
    expect(document.getElementById('overview-comparison-recorded-snapshots')).toHaveTextContent(
      '-$50.00'
    )
    expect(document.getElementById('overview-comparison-recorded-snapshots')).toHaveTextContent(
      '$2,000.00'
    )
  })
})
