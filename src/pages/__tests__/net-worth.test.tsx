import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NetWorth } from '../net-worth'

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
    t: (key: string, options?: { currencies?: string; amount?: string }) =>
      options?.currencies
        ? `${key}: ${options.currencies}`
        : options?.amount
          ? `${key}: ${options.amount}`
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
})
