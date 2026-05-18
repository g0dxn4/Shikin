import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Investments } from '../investments'

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
let mockInvestments: Array<Record<string, unknown>> = []
let mockFetchError: string | null = null
let mockError: string | null = null
let mockIsLoading = false

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
    portfolioSummary: {
      totalMarketValue: 0,
      totalCostBasis: 0,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
      byType: {},
    },
    lastPriceFetch: null,
    fetchPriceHistory: vi.fn().mockResolvedValue([]),
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
  })

  it('renders title', () => {
    render(<Investments />)

    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('renders empty state text', () => {
    render(<Investments />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
  })

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

  it('renders title', () => {
    render(<Investments />)

    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('renders empty state text', () => {
    render(<Investments />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
  })

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

    expect(screen.queryByText('Couldn’t load investments')).not.toBeInTheDocument()
    expect(screen.queryByText('Price history unavailable')).not.toBeInTheDocument()
    expect(screen.getByText('title')).toBeInTheDocument()
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
})
