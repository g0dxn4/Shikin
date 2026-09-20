import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NetWorth } from '../net-worth'
import enAnalytics from '@/i18n/locales/en/analytics.json'
import esAnalytics from '@/i18n/locales/es/analytics.json'
import enCommon from '@/i18n/locales/en/common.json'
import esCommon from '@/i18n/locales/es/common.json'

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

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: (props: { children: React.ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('recharts', () => ({
  AreaChart: () => null,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: () => null,
}))

describe('NetWorth page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    expect(enCommon.netWorth.incompleteHoldings_one).toBe(
      enAnalytics.netWorth.incompleteHoldings_one
    )
    expect(enCommon.netWorth.unresolvedOwnership_other).toBe(
      enAnalytics.netWorth.unresolvedOwnership_other
    )
    expect(enCommon.netWorth.unavailable).toBe(enAnalytics.netWorth.unavailable)
    expect(esCommon.netWorth.incompleteHoldings_one).toBe(
      esAnalytics.netWorth.incompleteHoldings_one
    )
    expect(esCommon.netWorth.unresolvedOwnership_other).toBe(
      esAnalytics.netWorth.unresolvedOwnership_other
    )
    expect(esCommon.netWorth.unavailable).toBe(esAnalytics.netWorth.unavailable)
  })
})
