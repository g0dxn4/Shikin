import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Investments } from '../investments'

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
let mockInvestments: Array<Record<string, unknown>> = []
let mockFetchError: string | null = null
let mockError: string | null = null
let mockIsLoading = false
let mockPortfolioSummary: Record<string, unknown> = {
  totalMarketValue: 0,
  totalCostBasis: 0,
  totalGainLoss: 0,
  totalGainLossPercent: 0,
  byType: {},
  byCurrency: {},
  currencies: [],
  isMixedCurrency: false,
  totalsComplete: true,
}

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openInvestmentDialog: vi.fn(),
  }),
}))

vi.mock('@/stores/investment-store', () => ({
  useInvestmentStore: () => ({
    investments: mockInvestments,
    isLoading: mockIsLoading,
    fetchError: mockFetchError,
    error: mockError,
    fetch: mockFetch,
    remove: mockRemove,
    priceHistory: new Map(),
    portfolioSummary: mockPortfolioSummary,
    lastPriceFetch: null,
    fetchPriceHistory: vi.fn().mockResolvedValue([]),
    setLastPriceFetch: vi.fn(),
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/lib/price-service', () => ({
  fetchAllCurrentPrices: vi.fn().mockResolvedValue(new Map()),
  savePricesToDB: vi.fn(),
}))

vi.mock('@/lib/price-scheduler', () => ({
  isInvestmentPriceStale: vi.fn((lastDate: string | null) => !lastDate),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    title,
  }: {
    open: boolean
    onConfirm: () => void
    title: string
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}))

vi.mock('@/components/investments/investment-dialog', () => ({
  InvestmentDialog: () => null,
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: (props: { children: ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('recharts', () => ({
  AreaChart: () => null,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
}))

vi.mock('dayjs/plugin/relativeTime', () => ({ default: () => {} }))

describe('Investments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRemove.mockReset()
    mockInvestments = []
    mockFetchError = null
    mockError = null
    mockIsLoading = false
    mockPortfolioSummary = {
      totalMarketValue: 0,
      totalCostBasis: 0,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
      byType: {},
      byCurrency: {},
      currencies: [],
      isMixedCurrency: false,
      totalsComplete: true,
    }
  })

  it('renders title', () => {
    render(<Investments />)

    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('renders empty state text', () => {
    render(<Investments />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
  })

  it('does not render the old page guidance card', () => {
    render(<Investments />)

    expect(screen.queryByText('guidance.accountTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('guidance.examplesTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('guidance.pricesTitle')).not.toBeInTheDocument()
  })

  it('renders long holding lists in pages', () => {
    mockInvestments = Array.from({ length: 25 }, (_, index) => {
      const suffix = String(index).padStart(2, '0')
      return {
        id: `inv-${suffix}`,
        account_id: null,
        symbol: `HLD${suffix}`,
        name: `Holding ${suffix}`,
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 100000 - index,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      }
    })

    render(<Investments />)

    expect(screen.getAllByText('HLD00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('HLD23').length).toBeGreaterThan(0)
    expect(screen.queryByText('HLD24')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /pagination\.showMore/i }))

    expect(screen.getAllByText('HLD24').length).toBeGreaterThan(0)
  }, 10_000)

  it('does not show page-level load banner for price history failures', () => {
    mockInvestments = [
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
    ]
    mockError = 'Price history unavailable'

    render(<Investments />)

    expect(screen.queryByText('Couldn\u2019t load investments')).not.toBeInTheDocument()
    expect(screen.queryByText('Price history unavailable')).not.toBeInTheDocument()
    expect(screen.getByText('title')).toBeInTheDocument()
  })

  describe('failure/retry boundary behavior', () => {
    it('shows ErrorState (not empty CTA) when initial fetch fails with empty dataset', () => {
      mockFetchError = 'Database connection failed'
      mockInvestments = []

      render(<Investments />)

      // Should show error state, not empty state
      expect(screen.getByText('Couldn\u2019t load your investments')).toBeInTheDocument()
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()

      // Should NOT show empty state CTA
      expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
    })

    it('shows empty state CTA (not ErrorState) when fetch succeeds with no investments', () => {
      mockFetchError = null
      mockInvestments = []

      render(<Investments />)

      // Should show empty state
      expect(screen.getByText('empty.title')).toBeInTheDocument()
      expect(screen.getByText('empty.description')).toBeInTheDocument()

      // Should NOT show error state
      expect(screen.queryByText('Couldn\u2019t load your investments')).not.toBeInTheDocument()
    })

    it('calls fetch when retry button is clicked', async () => {
      const user = userEvent.setup()
      mockFetchError = 'Network error'
      mockInvestments = []

      render(<Investments />)

      const retryButton = screen.getByRole('button', { name: /Try again/i })
      await user.click(retryButton)

      expect(mockFetch).toHaveBeenCalledTimes(2) // Once on mount, once on retry
    })

    it('shows ErrorBanner (not ErrorState) when fetch fails but has cached investments', () => {
      mockFetchError = 'Refresh failed'
      mockInvestments = [
        {
          id: 'inv-1',
          account_id: null,
          symbol: 'AAPL',
          name: 'Apple',
          type: 'stock',
          shares: 1,
          avg_cost_basis: 10000,
          currency: 'USD',
          notes: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          currentPrice: 12000,
          marketValue: 12000,
          gainLoss: 2000,
          gainLossPercent: 20,
          lastPriceDate: '2024-01-10',
        },
      ]

      render(<Investments />)

      // Should show error banner, not full error state
      expect(screen.getByText('Couldn\u2019t load investments')).toBeInTheDocument()

      // Should NOT show error state (full page error)
      expect(screen.queryByText('Couldn\u2019t load your investments')).not.toBeInTheDocument()
    })
  })

  it('shows a specific error toast when deleting an investment fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockRemove.mockRejectedValueOnce(new Error('Investment delete DB error'))
    mockInvestments = [
      {
        id: 'inv-delete-fail',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
    ]

    render(<Investments />)

    await user.click(screen.getAllByLabelText('Delete AAPL')[0])
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('inv-delete-fail')
      expect(toast.error).toHaveBeenCalledWith('Investment delete DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows a specific error toast when refreshing prices fails', async () => {
    const { toast } = await import('sonner')
    const { fetchAllCurrentPrices } = await import('@/lib/price-service')
    const user = userEvent.setup()
    vi.mocked(fetchAllCurrentPrices).mockRejectedValueOnce(new Error('Price refresh DB error'))
    mockInvestments = [
      {
        id: 'inv-refresh-fail',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
    ]

    render(<Investments />)

    await user.click(screen.getByRole('button', { name: /summary.refresh/i }))

    await waitFor(() => {
      expect(fetchAllCurrentPrices).toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('Price refresh DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('filters holdings by asset type', async () => {
    const user = userEvent.setup()
    mockInvestments = [
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
      {
        id: 'inv-2',
        account_id: null,
        symbol: 'BTC',
        name: 'Bitcoin',
        type: 'crypto',
        shares: 1,
        avg_cost_basis: 5000000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 6000000,
        marketValue: 6000000,
        gainLoss: 1000000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
    ]

    render(<Investments />)

    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0)

    // Click crypto filter
    const cryptoChip = screen.getByRole('button', { name: /types.crypto/i })
    await user.click(cryptoChip)

    expect(screen.queryByText('AAPL')).not.toBeInTheDocument()
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0)
  })

  it('filters holdings by search query', async () => {
    const user = userEvent.setup()
    mockInvestments = [
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
      {
        id: 'inv-2',
        account_id: null,
        symbol: 'GOOGL',
        name: 'Google',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 20000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 22000,
        marketValue: 22000,
        gainLoss: 2000,
        gainLossPercent: 10,
        lastPriceDate: '2024-01-10',
      },
    ]

    render(<Investments />)

    const searchInput = screen.getByPlaceholderText('search.placeholder')
    await user.type(searchInput, 'AAPL')

    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
    expect(screen.queryByText('GOOGL')).not.toBeInTheDocument()
  })

  it('shows empty filter state and allows clearing filters', async () => {
    const user = userEvent.setup()
    mockInvestments = [
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
    ]

    render(<Investments />)

    const searchInput = screen.getByPlaceholderText('search.placeholder')
    await user.type(searchInput, 'XYZ')

    expect(screen.getByText('empty.filter')).toBeInTheDocument()

    await user.click(screen.getByText('empty.clearFilters'))

    expect(screen.queryByText('empty.filter')).not.toBeInTheDocument()
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
  })

  it('shows mixed-currency warning and per-currency subtotals', () => {
    mockPortfolioSummary = {
      totalMarketValue: 63000,
      totalCostBasis: 52000,
      totalGainLoss: 11000,
      totalGainLossPercent: 21.15,
      byType: { stock: { marketValue: 63000, gainLoss: 11000, count: 2 } },
      byCurrency: {
        USD: { marketValue: 12000, costBasis: 10000, gainLoss: 2000, count: 1 },
        MXN: { marketValue: 51000, costBasis: 42000, gainLoss: 9000, count: 1 },
      },
      currencies: ['MXN', 'USD'],
      isMixedCurrency: true,
      totalsComplete: false,
    }

    mockInvestments = [
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
      {
        id: 'inv-2',
        account_id: null,
        symbol: 'WALMEX.MX',
        name: 'Walmart de México',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 42000,
        currency: 'MXN',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 51000,
        marketValue: 51000,
        gainLoss: 9000,
        gainLossPercent: 21.43,
        lastPriceDate: '2024-01-10',
      },
    ]

    render(<Investments />)

    expect(screen.getByText('currencyWarning.title')).toBeInTheDocument()
    expect(screen.getByText('currencyWarning.body')).toBeInTheDocument()
    expect(screen.getByText('MXN')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
  })

  it('shows price source label', () => {
    mockInvestments = [
      {
        id: 'inv-1',
        account_id: null,
        symbol: 'AAPL',
        name: 'Apple',
        type: 'stock',
        shares: 1,
        avg_cost_basis: 10000,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPrice: 12000,
        marketValue: 12000,
        gainLoss: 2000,
        gainLossPercent: 20,
        lastPriceDate: '2024-01-10',
      },
    ]

    render(<Investments />)

    expect(screen.getByText('priceSource.label')).toBeInTheDocument()
  })
})
