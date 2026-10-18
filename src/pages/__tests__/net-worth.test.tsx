import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NetWorth } from '../net-worth'
import enAnalytics from '@/i18n/locales/en/analytics.json'
import esAnalytics from '@/i18n/locales/es/analytics.json'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'
import { formatMoney } from '@/lib/money'

const axisLabels: string[] = []
const lineProps: Array<{ dataKey?: string; strokeWidth?: number; type?: string; stroke?: string }> =
  []

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

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
    mainCurrency: 'USD',
    manualRates: [],
  }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: (props: { children: React.ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('recharts', () => ({
  AreaChart: () => null,
  Area: () => null,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: (props: { dataKey?: string; strokeWidth?: number; type?: string; stroke?: string }) => {
    lineProps.push(props)
    return null
  },
  XAxis: () => null,
  YAxis: (props: { tickFormatter?: (value: number) => string }) => {
    if (props.tickFormatter) axisLabels.push(props.tickFormatter(150000))
    return null
  },
  Tooltip: () => null,
  CartesianGrid: () => null,
  ResponsiveContainer: () => null,
}))

describe('NetWorth page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    axisLabels.length = 0
    lineProps.length = 0
    mockState = {
      ...mockState,
      totalsComplete: true,
      missingCurrencies: [],
      unresolvedAccountIds: [],
      incompleteHoldingIds: [],
      isLoading: false,
      netWorth: 150000,
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
    expect(screen.getByRole('table', { name: 'netWorth.chartTableCaption' })).toHaveTextContent(
      '$1,000.00'
    )
    expect(screen.getByRole('table', { name: 'netWorth.chartTableCaption' })).toHaveTextContent(
      '$1,500.00'
    )
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
    expect(screen.getByRole('group', { name: 'netWorth.historyPeriod' })).toBeInTheDocument()
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

  it('keeps count-based EN and ES copy generic and ID-free', () => {
    expect(enAnalytics.netWorth.incompleteHoldings_one).toContain('{{count}}')
    expect(enAnalytics.netWorth.incompleteHoldings_other).toContain('{{count}}')
    expect(enAnalytics.netWorth.unresolvedOwnership_one).toContain('{{count}}')
    expect(enAnalytics.netWorth.unresolvedOwnership_other).toContain('{{count}}')
    expect(enAnalytics.netWorth.unavailable.length).toBeGreaterThan(0)
    expect(enAnalytics.netWorth.incompleteHoldings_one.toLowerCase()).not.toMatch(/quote/)
    expect(enAnalytics.netWorth.incompleteHoldings_other.toLowerCase()).not.toMatch(/quote/)

    expect(esAnalytics.netWorth.incompleteHoldings_one).toContain('{{count}}')
    expect(esAnalytics.netWorth.incompleteHoldings_other).toContain('{{count}}')
    expect(esAnalytics.netWorth.unresolvedOwnership_one).toContain('{{count}}')
    expect(esAnalytics.netWorth.unresolvedOwnership_other).toContain('{{count}}')
    expect(esAnalytics.netWorth.unavailable.length).toBeGreaterThan(0)
    expect(esAnalytics.netWorth.incompleteHoldings_one.toLowerCase()).not.toMatch(/cotizaci/)
  })
})
