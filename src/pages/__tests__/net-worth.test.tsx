import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordedNetWorthChart } from '@/components/net-worth/recorded-history-chart'
import { NetWorth } from '../net-worth'
import enAnalytics from '@/i18n/locales/en/analytics.json'
import esAnalytics from '@/i18n/locales/es/analytics.json'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'
import { formatMoney } from '@/lib/money'

const axisLabels: string[] = []
const lineProps: Array<{
  dataKey?: string
  strokeWidth?: number
  type?: string
  stroke?: string
  strokeOpacity?: number
  connectNulls?: boolean
  isAnimationActive?: boolean
}> = []
const areaProps: Array<Record<string, unknown>> = []
const barProps: Array<Record<string, unknown>> = []
const xAxisProps: Array<Record<string, unknown>> = []
const charts: Array<{ type: string; data?: unknown }> = []
const tooltipContents: Array<
  (props: {
    active?: boolean
    label?: unknown
    payload?: Array<{
      dataKey?: unknown
      name?: unknown
      value?: unknown
      payload?: { date?: string; netWorth?: number; assets?: number; liabilities?: number }
    }>
  }) => React.ReactNode
> = []

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const mockRefresh = vi.fn().mockResolvedValue(undefined)

let mockState = {
  totalAssets: 200000,
  totalLiabilities: 50000,
  totalInvestments: 0,
  netWorth: 150000,
  preferredCurrency: 'USD' as string | null,
  totalsComplete: true,
  missingCurrencies: [] as string[],
  unresolvedAccountIds: [] as string[],
  incompleteHoldingIds: [] as string[],
  assetBreakdown: [
    {
      id: 'acc-1',
      name: 'Checking',
      type: 'checking',
      currency: 'USD',
      balance: 200000,
      convertedBalance: 200000,
    },
  ],
  liabilityBreakdown: [] as Array<{
    id: string
    name: string
    type: string
    currency: string
    balance: number
    convertedBalance: number | null
  }>,
  history: [
    { date: '2024-01-01', netWorth: 100000, assets: 100000, liabilities: 0 },
    { date: '2024-06-01', netWorth: 150000, assets: 150000, liabilities: 0 },
  ],
  historyComplete: true,
  historyAuthorityKey: 'USD|',
  historyCurrency: 'USD' as string | null,
  historyRequestedPeriod: '1y',
  historyLoading: false,
  historyError: null as string | null,
  historyMissingCurrencies: [] as string[],
  historyNativeSnapshots: [] as Array<{
    id: string
    date: string
    currency: string
    amountCentavos: number
  }>,
  isLoading: false,
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { currencies?: string; amount?: string; count?: number }) =>
      options?.currencies
        ? `${key}: ${options.currencies}`
        : options?.amount
          ? `${key}: ${options.amount}`
          : typeof options?.count === 'number'
            ? `${key}: ${options.count}`
            : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/net-worth-store', () => ({
  useNetWorthStore: () => ({
    ...mockState,
    refresh: mockRefresh,
  }),
}))

let mockCurrency: { mainCurrency: string | null; manualRates: Array<{ id: string }> } = {
  mainCurrency: 'USD',
  manualRates: [],
}

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => mockCurrency,
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: (props: { children: React.ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('recharts', () => ({
  AreaChart: (props: { data?: unknown; children?: React.ReactNode }) => {
    charts.push({ type: 'area', data: props.data })
    return <div data-recharts="area">{props.children}</div>
  },
  Area: (props: Record<string, unknown>) => {
    areaProps.push(props)
    return null
  },
  BarChart: (props: { data?: unknown; children?: React.ReactNode }) => {
    charts.push({ type: 'bar', data: props.data })
    return <div data-recharts="bar">{props.children}</div>
  },
  Bar: (props: Record<string, unknown>) => {
    barProps.push(props)
    return null
  },
  LineChart: (props: { data?: unknown; children?: React.ReactNode }) => {
    charts.push({ type: 'line', data: props.data })
    return <div data-recharts="line">{props.children}</div>
  },
  Line: (props: {
    dataKey?: string
    strokeWidth?: number
    type?: string
    stroke?: string
    strokeOpacity?: number
    connectNulls?: boolean
    isAnimationActive?: boolean
  }) => {
    lineProps.push(props)
    return null
  },
  XAxis: (props: Record<string, unknown>) => {
    xAxisProps.push(props)
    return null
  },
  YAxis: (props: { tickFormatter?: (value: number) => string }) => {
    if (props.tickFormatter) axisLabels.push(props.tickFormatter(150000))
    return null
  },
  Tooltip: (props: {
    content?: (tooltipProps: {
      active?: boolean
      label?: unknown
      payload?: Array<{
        dataKey?: unknown
        name?: unknown
        value?: unknown
        payload?: { date?: string; netWorth?: number; assets?: number; liabilities?: number }
      }>
    }) => React.ReactNode
  }) => {
    if (props.content) tooltipContents.push(props.content)
    return null
  },
  CartesianGrid: () => null,
  ResponsiveContainer: () => null,
}))

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}

describe('NetWorth page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    axisLabels.length = 0
    lineProps.length = 0
    areaProps.length = 0
    barProps.length = 0
    xAxisProps.length = 0
    charts.length = 0
    tooltipContents.length = 0
    mockCurrency = { mainCurrency: 'USD', manualRates: [] }
    mockState = {
      ...mockState,
      totalsComplete: true,
      missingCurrencies: [],
      unresolvedAccountIds: [],
      incompleteHoldingIds: [],
      isLoading: false,
      netWorth: 150000,
      preferredCurrency: 'USD',
      totalAssets: 200000,
      totalLiabilities: 50000,
      historyComplete: true,
      historyAuthorityKey: 'USD|',
      historyCurrency: 'USD',
      historyRequestedPeriod: '1y',
      historyLoading: false,
      historyError: null,
      historyMissingCurrencies: [],
      historyNativeSnapshots: [],
      history: [
        { date: '2024-01-01', netWorth: 100000, assets: 100000, liabilities: 0 },
        { date: '2024-06-01', netWorth: 150000, assets: 150000, liabilities: 0 },
      ],
    }
  })

  it('keeps period controls and real asset/liability totals', async () => {
    const user = userEvent.setup()
    render(<NetWorth />)

    expect(screen.getAllByText('$1,500.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$2,000.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0)
    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalledWith('1y')
    expect(screen.getByRole('button', { name: 'netWorth.periods.1y' })).toHaveClass('min-h-11')
    expect(screen.getByRole('img', { name: 'netWorth.chartTitle' })).toBeInTheDocument()
    const historyTable = screen.getByRole('table', { name: 'netWorth.chartTableCaption' })
    expect(historyTable).toHaveTextContent('$1,000.00')
    expect(historyTable).toHaveTextContent('$1,500.00')
    expect(historyTable.parentElement).toHaveClass('sr-only')
    expect(screen.getAllByText('netWorth.currentNetWorth')).toHaveLength(1)
    expect(screen.queryByText('netWorth.description')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'netWorth.viewChartData' }))
    expect(
      screen.getByRole('table', { name: 'netWorth.chartTableCaption' }).parentElement
    ).not.toHaveClass('sr-only')
    const axisLabel = axisLabels[axisLabels.length - 1]
    expect(axisLabel).toBe(formatCompactChartMoney(150000, 'USD'))
    expect(axisLabel).not.toBe(formatMoney(150000, 'USD'))
    expect(lineProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dataKey: 'netWorth',
          type: 'linear',
          strokeWidth: 2,
          stroke: 'var(--color-chart-1)',
        }),
      ])
    )
    expect(document.querySelector('linearGradient')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'netWorth.periods.3m' }))
    expect(mockRefresh).toHaveBeenCalledWith('3m')
  })

  it('omits scalar totals when rates are missing', () => {
    mockState = {
      ...mockState,
      totalsComplete: false,
      missingCurrencies: ['EUR'],
      netWorth: 0,
      totalAssets: 0,
      totalLiabilities: 0,
    }

    render(<NetWorth />)

    expect(screen.getByText('netWorth.incompleteTotals: EUR')).toBeInTheDocument()
    const metricValues = screen.getAllByText('—')
    expect(metricValues.length).toBeGreaterThanOrEqual(3)
  })

  it('names unvalued holdings when currencies are empty', () => {
    mockState = {
      ...mockState,
      totalsComplete: false,
      missingCurrencies: [],
      incompleteHoldingIds: ['hold-unvalued-1', 'hold-unvalued-2'],
      netWorth: 0,
      totalAssets: 0,
      totalLiabilities: 0,
    }

    render(<NetWorth />)

    const banner = screen.getByText('netWorth.incompleteHoldings: 2')
    expect(banner).toBeInTheDocument()
    expect(banner).not.toHaveTextContent('netWorth.incompleteTotals')
    expect(screen.queryByText(/hold-unvalued-1/)).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('names unresolved ownership without dumping account IDs', () => {
    mockState = {
      ...mockState,
      totalsComplete: false,
      missingCurrencies: [],
      unresolvedAccountIds: ['acct-unresolved-ownership'],
      netWorth: 0,
    }

    render(<NetWorth />)

    expect(screen.getByText('netWorth.unresolvedOwnership: 1')).toBeInTheDocument()
    expect(screen.queryByText('netWorth.incompleteTotals:')).not.toBeInTheDocument()
    expect(screen.queryByText(/acct-unresolved-ownership/)).not.toBeInTheDocument()
  })

  it('combines FX currency names with holding and ownership counts', () => {
    mockState = {
      ...mockState,
      totalsComplete: false,
      missingCurrencies: ['EUR', 'MXN'],
      incompleteHoldingIds: ['hold-a'],
      unresolvedAccountIds: ['acct-a', 'acct-b'],
    }

    render(<NetWorth />)

    expect(screen.getByText(/netWorth.incompleteTotals: EUR, MXN/)).toBeInTheDocument()
    expect(screen.getByText(/netWorth.incompleteHoldings: 1/)).toBeInTheDocument()
    expect(screen.getByText(/netWorth.unresolvedOwnership: 2/)).toBeInTheDocument()
    expect(screen.queryByText(/hold-a/)).not.toBeInTheDocument()
    expect(screen.queryByText(/acct-a/)).not.toBeInTheDocument()
  })

  it('shows incomplete history as dated native snapshots without adding stock values', () => {
    mockState = {
      ...mockState,
      history: [],
      historyComplete: false,
      historyMissingCurrencies: ['USD'],
      historyNativeSnapshots: [
        { id: 'first', date: '2024-01-01', currency: 'USD', amountCentavos: 10_000 },
        { id: 'second', date: '2024-02-01', currency: 'USD', amountCentavos: 10_000 },
      ],
    }

    render(<NetWorth />)

    expect(screen.getByText(/Jan 1, 2024: \$100\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Feb 1, 2024: \$100\.00/)).toBeInTheDocument()
    expect(screen.queryByText('$200.00')).not.toBeInTheDocument()
  })

  it('does not throw when native snapshot evidence has an unsupported currency', () => {
    mockState = {
      ...mockState,
      history: [],
      historyComplete: false,
      historyMissingCurrencies: ['UNKNOWN'],
      historyNativeSnapshots: [
        { id: 'legacy', date: '2024-01-01', currency: 'UNKNOWN', amountCentavos: 10_000 },
        { id: 'blank', date: '2024-03-15', currency: '   ', amountCentavos: 25_000 },
        { id: 'unsupported', date: '2024-04-02', currency: 'CHF', amountCentavos: 10_000 },
      ],
    }

    expect(() => render(<NetWorth />)).not.toThrow()

    const evidence = screen.getByRole('alert')
    expect(evidence).toHaveTextContent('netWorth.unavailable')
    expect(evidence).toHaveTextContent('UNKNOWN')
    expect(evidence).toHaveTextContent('Jan 1, 2024: —')
    expect(evidence).toHaveTextContent('Mar 15, 2024: —')
    expect(evidence).toHaveTextContent('Apr 2, 2024: —')
    expect(evidence).not.toHaveTextContent('$100.00')
    expect(evidence).not.toHaveTextContent('$250.00')
    expect(evidence).not.toHaveTextContent('CHF')
    expect(screen.queryByText('$100.00')).not.toBeInTheDocument()
    expect(screen.queryByText('$250.00')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
  })

  it('withholds chart, table, and period delta for stale history authority', () => {
    mockState = {
      ...mockState,
      historyAuthorityKey: 'USD|obsolete-rate',
      historyCurrency: 'USD',
    }

    render(<NetWorth />)

    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('netWorth.unavailable').length).toBeGreaterThan(0)
  })

  it('withholds chart, table, and period delta for a stale requested period', () => {
    mockState = {
      ...mockState,
      historyRequestedPeriod: '3m',
    }

    render(<NetWorth />)

    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('netWorth.unavailable').length).toBeGreaterThan(0)
  })

  it('falls back to generic unavailable copy when incomplete lists are empty', () => {
    mockState = {
      ...mockState,
      totalsComplete: false,
      missingCurrencies: [],
      incompleteHoldingIds: [],
      unresolvedAccountIds: [],
    }

    render(<NetWorth />)

    expect(screen.getByText('netWorth.unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/netWorth.incompleteTotals/)).not.toBeInTheDocument()
  })

  it('keeps period controls mounted while the page is refreshing', () => {
    mockState = { ...mockState, isLoading: true }
    render(<NetWorth />)
    expect(screen.getByRole('button', { name: 'netWorth.periods.1y' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'netWorth.periods.month' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'netWorth.historyPeriod' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'netWorth.styles.line' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'netWorth.compareRecorded' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
  })

  it('does not chart a single snapshot or invent another date', () => {
    mockState = {
      ...mockState,
      history: [{ date: '2024-01-01', netWorth: 100000, assets: 100000, liabilities: 0 }],
    }

    render(<NetWorth />)

    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.getByText('netWorth.firstSnapshot')).toBeInTheDocument()
    expect(screen.queryByText('2024-01-02')).not.toBeInTheDocument()
    expect(screen.queryByText('2024-06-01')).not.toBeInTheDocument()
  })

  it('captions an empty recorded history instead of drawing a zero line', () => {
    mockState = { ...mockState, history: [] }

    render(<NetWorth />)

    expect(screen.getByText('netWorth.noHistory')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('switches line, area, and bars without inventing points or changing live totals', async () => {
    const user = userEvent.setup()
    const history = [
      { date: '2024-01-01', netWorth: -5000, assets: 10000, liabilities: 15000 },
      { date: '2024-06-01', netWorth: 150000, assets: 180000, liabilities: 30000 },
    ]
    mockState = { ...mockState, history }
    render(<NetWorth />)

    const live = document.querySelector('p.text-3xl')
    expect(live).toHaveTextContent('$1,500.00')
    expect(live).toHaveClass('overflow-x-auto', 'text-3xl')
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledWith('1y')
    expect(screen.getByRole('tab', { name: 'netWorth.styles.line' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'netWorth.styles.line' })).toHaveClass('min-h-11')
    expect(screen.getByRole('tab', { name: 'netWorth.styles.area' })).toHaveAttribute(
      'tabindex',
      '-1'
    )
    expect(last(charts)).toEqual({ type: 'line', data: history })
    expect(last(xAxisProps)).toEqual(expect.objectContaining({ dataKey: 'date' }))
    expect(lineProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dataKey: 'assets',
          stroke: 'var(--color-chart-3)',
          strokeOpacity: 0.45,
          type: 'linear',
          connectNulls: false,
          isAnimationActive: false,
        }),
        expect.objectContaining({
          dataKey: 'liabilities',
          stroke: 'var(--color-chart-3)',
          strokeDasharray: '3 3',
          connectNulls: false,
        }),
      ])
    )

    await user.click(screen.getByRole('tab', { name: 'netWorth.styles.area' }))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(document.querySelector('p.text-3xl')).toHaveTextContent('$1,500.00')
    expect(last(charts)).toEqual({ type: 'area', data: history })
    expect(last(areaProps)).toEqual(
      expect.objectContaining({
        dataKey: 'netWorth',
        type: 'linear',
        fill: 'var(--color-chart-1)',
        fillOpacity: 0.16,
        connectNulls: false,
        isAnimationActive: false,
      })
    )
    expect(String(last(areaProps)?.fill)).not.toMatch(/url\(|gradient|violet|accent|primary/i)
    expect(document.querySelector('linearGradient')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'netWorth.chartTableCaption' })).toHaveTextContent(
      '-$50.00'
    )
    expect(screen.getByRole('table', { name: 'netWorth.chartTableCaption' })).toHaveTextContent(
      '$300.00'
    )

    const lineTab = screen.getByRole('tab', { name: 'netWorth.styles.line' })
    lineTab.focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'netWorth.styles.bars' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'netWorth.styles.bars' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(last(charts)).toEqual({ type: 'bar', data: history })
    expect(barProps.map((bar) => bar.dataKey).sort()).toEqual(['assets', 'liabilities', 'netWorth'])
    expect(barProps.every((bar) => bar.stackId === undefined)).toBe(true)
    expect(last(charts)?.data).toEqual([
      expect.objectContaining({ date: '2024-01-01', liabilities: 15000, netWorth: -5000 }),
      expect.objectContaining({ date: '2024-06-01', liabilities: 30000 }),
    ])
    expect(JSON.stringify(last(charts)?.data)).not.toMatch(/delta|cashflow|return|magnitude/i)
    const scroller = screen.getByTestId('net-worth-bar-scroll')
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(scroller).toHaveClass('overflow-x-auto', 'max-w-full', 'min-w-0')
    expect(screen.getByTestId('net-worth-bar-canvas')).toHaveStyle({ minWidth: '128px' })

    const tooltip = last(tooltipContents)
    const tooltipView = render(
      <>
        {tooltip?.({
          active: true,
          label: 1,
          payload: [
            {
              dataKey: 'netWorth',
              name: 'netWorth',
              value: 150000,
              payload: {
                date: '2024-06-01',
                netWorth: 150000,
                assets: 180000,
                liabilities: 30000,
              },
            },
            {
              dataKey: 'liabilities',
              name: 'liabilities',
              value: 30000,
              payload: {
                date: '2024-06-01',
                netWorth: 150000,
                assets: 180000,
                liabilities: 30000,
              },
            },
          ],
        })}
      </>
    )
    expect(tooltipView.getByText(/Jun 1, 2024 · USD/)).toBeInTheDocument()
    expect(tooltipView.getByText(/netWorth.recordedNetWorth: \$1,500.00/)).toBeInTheDocument()
    expect(tooltipView.getByText(/netWorth.recordedLiabilities: \$300.00/)).toBeInTheDocument()
    expect(tooltipView.queryByText(/1970/)).not.toBeInTheDocument()
    expect(tooltipView.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('distinguishes recorded assets and liabilities without changing money totals', async () => {
    const user = userEvent.setup()
    render(<NetWorth />)
    const before = document.querySelector('p.text-3xl')?.textContent
    const calls = mockRefresh.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'netWorth.compareRecorded' }))

    expect(screen.getByRole('button', { name: 'netWorth.compareRecorded' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'netWorth.compareRecorded' })).toHaveClass('min-h-11')
    expect(document.querySelector('p.text-3xl')?.textContent).toBe(before)
    expect(mockRefresh).toHaveBeenCalledTimes(calls)
    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.getAllByText('$2,000.00').length).toBeGreaterThan(0)
    expect(last(lineProps)).toEqual(expect.objectContaining({ dataKey: 'netWorth' }))
    expect(lineProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataKey: 'assets', stroke: 'var(--color-chart-2)' }),
        expect.objectContaining({
          dataKey: 'liabilities',
          stroke: 'var(--color-chart-5)',
          strokeDasharray: '3 3',
        }),
      ])
    )
    expect(last(charts)?.data).toBe(mockState.history)
  })

  it('requests month-to-date, year-to-date, and all through the existing refresh handler', async () => {
    const user = userEvent.setup()
    render(<NetWorth />)
    const live = document.querySelector('p.text-3xl')?.textContent

    await user.click(screen.getByRole('button', { name: 'netWorth.periods.month' }))
    expect(mockRefresh).toHaveBeenCalledWith('month')
    expect(mockRefresh).not.toHaveBeenCalledWith('1m')
    expect(screen.getByRole('button', { name: 'netWorth.periods.month' })).toHaveClass('min-h-11')
    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
    expect(document.querySelector('p.text-3xl')?.textContent).toBe(live)
    expect(screen.getByRole('tab', { name: 'netWorth.styles.line' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'netWorth.periods.ytd' }))
    expect(mockRefresh).toHaveBeenCalledWith('ytd')
    await user.click(screen.getByRole('button', { name: 'netWorth.periods.all' }))
    expect(mockRefresh).toHaveBeenCalledWith('all')
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('draws a later range only from the newly recorded points', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<NetWorth />)
    await user.click(screen.getByRole('tab', { name: 'netWorth.styles.area' }))
    await user.click(screen.getByRole('button', { name: 'netWorth.periods.month' }))
    expect(screen.queryByTestId('net-worth-recorded-plot')).not.toBeInTheDocument()

    const monthHistory = [
      { date: '2026-03-02', netWorth: 10, assets: 40, liabilities: 30 },
      { date: '2026-03-18', netWorth: 20, assets: 50, liabilities: 30 },
    ]
    mockState = {
      ...mockState,
      history: monthHistory,
      historyRequestedPeriod: 'month',
    }
    rerender(<NetWorth />)

    expect(screen.getByTestId('net-worth-recorded-plot')).toHaveAttribute(
      'data-chart-style',
      'area'
    )
    expect(last(charts)).toEqual({ type: 'area', data: monthHistory })
    expect(JSON.stringify(last(charts)?.data)).not.toContain('2024-01-01')
    expect(screen.queryByText('2024-06-01')).not.toBeInTheDocument()
  })

  it('scrolls every recorded bar date instead of aggregating them', async () => {
    const user = userEvent.setup()
    const history = Array.from({ length: 40 }, (_, index) => {
      const month = String(Math.floor(index / 28) + 1).padStart(2, '0')
      const day = String((index % 28) + 1).padStart(2, '0')
      return {
        date: `2024-${month}-${day}`,
        netWorth: (index + 1) * 1000,
        assets: (index + 1) * 1500,
        liabilities: (index + 1) * 200,
      }
    })
    mockState = { ...mockState, history }
    render(<NetWorth />)
    await user.click(screen.getByRole('tab', { name: 'netWorth.styles.bars' }))

    expect(last(charts)).toEqual({ type: 'bar', data: history })
    expect(last(charts)?.data).toHaveLength(40)
    expect(screen.getByTestId('net-worth-bar-canvas')).toHaveStyle({ minWidth: '2560px' })
    expect(screen.getByTestId('net-worth-bar-scroll').parentElement).toHaveClass('min-w-0')
    expect(
      screen.getByRole('table', { name: 'netWorth.chartTableCaption' }).querySelectorAll('tbody tr')
    ).toHaveLength(40)
  })

  it('does not format an unsupported chart currency', () => {
    const points = [
      { date: '2024-01-01', netWorth: 100, assets: 100, liabilities: 0 },
      { date: '2024-02-01', netWorth: 200, assets: 200, liabilities: 0 },
    ]
    expect(() =>
      render(
        <RecordedNetWorthChart
          points={points}
          currency="UNKNOWN"
          chartStyle="line"
          compare={false}
          title="chart"
          describedBy="table"
        />
      )
    ).not.toThrow()
    const tooltip = last(tooltipContents)
    const view = render(
      <>
        {tooltip?.({
          active: true,
          label: '2024-02-01',
          payload: [
            {
              dataKey: 'netWorth',
              name: 'netWorth',
              value: 200,
              payload: { date: '2024-02-01', netWorth: 200, assets: 200, liabilities: 0 },
            },
          ],
        })}
      </>
    )
    expect(view.container).not.toHaveTextContent('$2.00')
    expect(view.getByText(/—/)).toBeInTheDocument()
    expect(last(axisLabels)).toBe('')
  })

  it('withholds unsafe recorded points and does not borrow a loading series', () => {
    mockState = {
      ...mockState,
      history: [
        {
          date: '2024-01-01',
          netWorth: Number.MAX_SAFE_INTEGER + 2,
          assets: 1,
          liabilities: 1,
        },
        { date: '2024-02-01', netWorth: 2, assets: 1, liabilities: 1 },
      ],
    }
    const unsafe = render(<NetWorth />)
    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('netWorth.noHistory')).not.toBeInTheDocument()
    expect(screen.queryByText('netWorth.firstSnapshot')).not.toBeInTheDocument()
    expect(screen.getAllByText('netWorth.unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    unsafe.unmount()

    mockState = {
      ...mockState,
      historyLoading: true,
      historyComplete: true,
      history: [
        { date: '2024-01-01', netWorth: 100000, assets: 100000, liabilities: 0 },
        { date: '2024-06-01', netWorth: 150000, assets: 150000, liabilities: 0 },
      ],
    }
    render(<NetWorth />)
    expect(screen.getByText('netWorth.historyLoading')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'netWorth.chartStyle' })).toBeInTheDocument()
  })

  it('keeps style controls when history is empty or currency is unconfigured', () => {
    mockCurrency = { mainCurrency: null, manualRates: [] }
    mockState = { ...mockState, history: [], historyCurrency: null, historyAuthorityKey: '|' }
    render(<NetWorth />)
    expect(screen.getByRole('tab', { name: 'netWorth.styles.bars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'netWorth.periods.all' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'netWorth.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('keeps the same recorded centavos and history currency across styles', async () => {
    const user = userEvent.setup()
    const history = [
      { date: '2024-01-01', netWorth: 100000, assets: 120000, liabilities: 20000 },
      { date: '2024-06-01', netWorth: 150000, assets: 180000, liabilities: 30000 },
    ]
    mockCurrency = { mainCurrency: 'EUR', manualRates: [] }
    mockState = {
      ...mockState,
      preferredCurrency: 'EUR',
      historyAuthorityKey: 'EUR|',
      historyCurrency: 'EUR',
      history,
    }
    render(<NetWorth />)

    expect(screen.getByTestId('net-worth-recorded-plot')).toHaveAttribute('data-currency', 'EUR')
    expect(last(charts)).toEqual({ type: 'line', data: history })
    expect(screen.getByRole('table', { name: 'netWorth.chartTableCaption' })).toHaveTextContent(
      '€1,000.00'
    )
    expect(screen.getByRole('table', { name: 'netWorth.chartTableCaption' })).not.toHaveTextContent(
      '$1,000.00'
    )
    expect(document.querySelector('p.text-3xl')).toHaveTextContent('€1,500.00')

    await user.click(screen.getByRole('tab', { name: 'netWorth.styles.bars' }))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(last(charts)).toEqual({ type: 'bar', data: history })
    expect(screen.getByTestId('net-worth-recorded-plot')).toHaveAttribute('data-currency', 'EUR')
    expect(last(axisLabels)).toBe(formatCompactChartMoney(150000, 'EUR'))
    expect(last(axisLabels)).not.toBe(formatCompactChartMoney(150000, 'USD'))
    expect(document.querySelector('p.text-3xl')).toHaveTextContent('€1,500.00')
    const tooltip = last(tooltipContents)
    const tooltipView = render(
      <>
        {tooltip?.({
          active: true,
          label: '2024-06-01',
          payload: [
            {
              dataKey: 'assets',
              name: 'assets',
              value: 180000,
              payload: history[1],
            },
          ],
        })}
      </>
    )
    expect(tooltipView.container).toHaveTextContent('Jun 1, 2024 · EUR')
    expect(tooltipView.container).toHaveTextContent('€1,800.00')
    expect(tooltipView.container).not.toHaveTextContent('$1,800.00')
  })

  it('keeps count-based EN and ES copy generic and ID-free', () => {
    expect(enAnalytics.netWorth.incompleteHoldings_one).toContain('{{count}}')
    expect(enAnalytics.netWorth.incompleteHoldings_other).toContain('{{count}}')
    expect(enAnalytics.netWorth.unresolvedOwnership_one).toContain('{{count}}')
    expect(enAnalytics.netWorth.unresolvedOwnership_other).toContain('{{count}}')
    expect(enAnalytics.netWorth.unavailable.length).toBeGreaterThan(0)
    expect(enAnalytics.netWorth.live).toBe('Live')
    expect(esAnalytics.netWorth.live).toBe('En vivo')
    expect(esAnalytics.netWorth.recorded.length).toBeGreaterThan(0)
    expect(enAnalytics.netWorth.incompleteHoldings_one.toLowerCase()).not.toMatch(/quote/)
    expect(enAnalytics.netWorth.incompleteHoldings_other.toLowerCase()).not.toMatch(/quote/)

    expect(esAnalytics.netWorth.incompleteHoldings_one).toContain('{{count}}')
    expect(esAnalytics.netWorth.incompleteHoldings_other).toContain('{{count}}')
    expect(esAnalytics.netWorth.unresolvedOwnership_one).toContain('{{count}}')
    expect(esAnalytics.netWorth.unresolvedOwnership_other).toContain('{{count}}')
    expect(esAnalytics.netWorth.unavailable.length).toBeGreaterThan(0)
    expect(esAnalytics.netWorth.incompleteHoldings_one.toLowerCase()).not.toMatch(/cotizaci/)
    expect(enAnalytics.netWorth.periods.month).toBe('MTD')
    expect(enAnalytics.netWorth.periods.ytd).toBe('YTD')
    expect(enAnalytics.netWorth.periods.month).not.toMatch(/1M|rolling/i)
    expect(enAnalytics.netWorth.periodTitle.month).toBe('Month to date')
    expect(enAnalytics.netWorth.periodTitle.month.toLowerCase()).not.toMatch(/rolling|1m/)
    expect(esAnalytics.netWorth.periods.month).toBe('MTD')
    expect(esAnalytics.netWorth.periods.ytd).toBe('YTD')
    expect(esAnalytics.netWorth.periodTitle.month.toLowerCase()).toContain('mes')
    expect(esAnalytics.netWorth.periodTitle.month.toLowerCase()).not.toMatch(/1m|móvil/)
    expect(enAnalytics.netWorth.compareRecorded.toLowerCase()).toContain('recorded')
    expect(esAnalytics.netWorth.compareRecorded.toLowerCase()).toContain('registrad')
    expect(enAnalytics.netWorth.styles).toEqual({ line: 'Line', area: 'Area', bars: 'Bars' })
    expect(esAnalytics.netWorth.styles.area.length).toBeGreaterThan(0)
    expect(esAnalytics.netWorth.recordedNetWorth.length).toBeGreaterThan(0)
  })
})
