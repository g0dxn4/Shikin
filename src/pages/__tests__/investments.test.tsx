import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Investments } from '../investments'
import { fetchAllCurrentPrices, savePricesToDB, type PriceQuote } from '@/lib/price-service'
import { toast } from 'sonner'

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
const mockSetRefreshFailures = vi.fn()
const mockSetLastPriceFetch = vi.fn()
const mockFetchPriceHistory = vi.fn().mockResolvedValue([])
let mockLiveFetch = mockFetch
let mockInvestments: Array<Record<string, unknown>> = []
let mockPriceHistory = new Map<string, Array<{ date: string; unitPriceDecimal: string }>>()
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
  useInvestmentStore: Object.assign(
    () => ({
      investments: mockInvestments,
      isLoading: mockIsLoading,
      fetchError: mockFetchError,
      error: mockError,
      fetch: mockFetch,
      remove: mockRemove,
      priceHistory: mockPriceHistory,
      portfolioSummary: mockPortfolioSummary,
      lastPriceFetch: null,
      fetchPriceHistory: mockFetchPriceHistory,
      setRefreshFailures: mockSetRefreshFailures,
      setLastPriceFetch: mockSetLastPriceFetch,
    }),
    {
      getState: () => ({
        fetch: mockLiveFetch,
        setRefreshFailures: mockSetRefreshFailures,
        setLastPriceFetch: mockSetLastPriceFetch,
      }),
    }
  ),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    fetchError: null,
    fetch: mockFetchAccounts,
  }),
}))

vi.mock('@/lib/price-service', () => ({
  fetchAllCurrentPrices: vi.fn().mockResolvedValue({ quotes: new Map(), failures: [] }),
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

function refreshHolding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i',
    account_id: null,
    symbol: 'S',
    name: 'Publication fixture',
    type: 'stock',
    shares: 1,
    quantityDecimal: '1',
    avg_cost_basis: 100,
    currency: 'USD',
    notes: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    instrument_key: 'owned',
    priceProvider: 'finnhub',
    priceInstrumentId: 'S',
    priceExchange: null,
    currentPriceCurrency: 'USD',
    marketValue: 100,
    gainLoss: 0,
    gainLossPercent: 0,
    lastPriceDate: '2024-01-01',
    ...overrides,
  }
}

const publicationQuote: PriceQuote = {
  instrumentKey: 'owned',
  assetType: 'stock',
  provider: 'finnhub',
  instrumentId: 'S',
  exchange: '',
  quoteCurrency: 'USD',
  unitPriceDecimal: '1',
  quoteDate: '2026-11-06',
}

describe('Investments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRemove.mockReset()
    mockFetch.mockReset().mockResolvedValue(undefined)
    mockLiveFetch = mockFetch
    mockSetRefreshFailures.mockReset()
    mockSetLastPriceFetch.mockReset()
    mockFetchPriceHistory.mockReset().mockResolvedValue([])
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.info).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(fetchAllCurrentPrices)
      .mockReset()
      .mockResolvedValue({ quotes: new Map(), failures: [] })
    vi.mocked(savePricesToDB).mockReset().mockResolvedValue(undefined)
    mockInvestments = []
    mockPriceHistory = new Map()
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders add action without a promotional page title', () => {
    render(<Investments />)

    expect(screen.getAllByText('addInvestment').length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('renders empty state text', () => {
    render(<Investments />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
  })

  it('keeps desktop financial columns aligned with a separate accessible action track', () => {
    mockInvestments = [
      {
        id: 'inv-layout',
        account_id: null,
        symbol: 'LAYOUT',
        name: 'Desktop layout regression holding',
        type: 'stock',
        shares: 10,
        quantityDecimal: '10',
        avg_cost_basis: 774800,
        avgCostBasisDecimal: '774.80',
        costBasisKnown: true,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPriceDecimal: '881.238',
        currentPriceCurrency: 'USD',
        marketValue: 881238,
        convertedMarketValue: 881238,
        gainLoss: 106438,
        gainLossPercent: 13.74,
        lastPriceDate: '2024-01-10',
      },
    ]
    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      preferredCurrency: 'USD',
      totalMarketValue: 881238,
      totalCostBasis: 774800,
      totalGainLoss: 106438,
      totalGainLossPercent: 13.74,
    }

    render(<Investments />)

    const header = screen.getByTestId('desktop-holdings-header')
    const row = screen.getByTestId('desktop-holding-row')
    const actions = screen.getByTestId('desktop-holding-actions')
    const gridTemplateClass = [...header.classList].find((name) => name.startsWith('grid-cols-'))

    expect(gridTemplateClass).toBeDefined()
    expect(row).toHaveClass(gridTemplateClass!)
    expect(header.children).toHaveLength(8)
    expect(header.lastElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(row.children).toHaveLength(8)
    expect(row.lastElementChild).toBe(actions)
    expect(row).toHaveTextContent('$8,812.38')
    expect(row).toHaveTextContent('+$1,064.38')

    const edit = actions.querySelector('button[aria-label="Edit LAYOUT"]')
    const remove = actions.querySelector('button[aria-label="Delete LAYOUT"]')
    expect(edit).toBeInTheDocument()
    expect(remove).toBeInTheDocument()
    expect(edit).toHaveAccessibleName('Edit LAYOUT')
    expect(remove).toHaveAccessibleName('Delete LAYOUT')
    expect((edit as HTMLButtonElement).tabIndex).toBe(0)
    expect((remove as HTMLButtonElement).tabIndex).toBe(0)
  })

  it('wraps long desktop financial figures without truncating their text', () => {
    mockInvestments = [
      {
        id: 'inv-long-figures',
        account_id: null,
        symbol: 'UNBROKEN-LONG-SYMBOL-1234567890',
        name: 'UnbrokenLongHoldingName12345678901234567890',
        type: 'stock',
        shares: 1,
        quantityDecimal: '1234567890.123456789',
        avg_cost_basis: 1,
        avgCostBasisDecimal: '123456789012.34567890',
        costBasisKnown: true,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPriceDecimal: '987654321098.76543210',
        currentPriceCurrency: 'USD',
        marketValue: 123456789012345,
        convertedMarketValue: 123456789012345,
        gainLoss: 98765432109876,
        gainLossPercent: 123456.78,
        lastPriceDate: '2024-01-10',
      },
    ]
    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      preferredCurrency: 'USD',
      totalMarketValue: 123456789012345,
      totalGainLoss: 98765432109876,
      totalGainLossPercent: 123456.78,
    }

    render(<Investments />)

    const row = screen.getByTestId('desktop-holding-row')
    const financialCells = Array.from(row.children).slice(2, 7)

    expect(row).toHaveTextContent('UNBROKEN-LONG-SYMBOL-1234567890')
    expect(row).toHaveTextContent('UnbrokenLongHoldingName12345678901234567890')
    expect(row).toHaveTextContent('1234567890.123456789')
    expect(row).toHaveTextContent('USD 123456789012.34567890')
    expect(row).toHaveTextContent('USD 987654321098.76543210')
    expect(row).toHaveTextContent('$1,234,567,890,123.45')
    expect(row).toHaveTextContent('+$987,654,321,098.76')
    expect(row.firstElementChild?.firstElementChild).toHaveClass(
      'min-w-0',
      'wrap-anywhere',
      'whitespace-normal'
    )
    for (const cell of financialCells) {
      expect(cell).toHaveClass('min-w-0', 'wrap-anywhere', 'whitespace-normal')
      expect(cell).not.toHaveClass('whitespace-nowrap')
    }
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
    expect(screen.getByText('holdings.title')).toBeInTheDocument()
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

  describe('manual quote publication', () => {
    it.each(['success', 'zero', 'save-error', 'fetch-error', 'replace-fetch'])(
      'preserves the literal publication trace for %s',
      async (scenario) => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'))
        const trace: unknown[] = []
        mockInvestments = [refreshHolding()]
        const quotes = new Map(scenario === 'zero' ? [] : [['i', publicationQuote]])
        vi.mocked(fetchAllCurrentPrices).mockImplementation(async () => {
          trace.push('prices')
          return {
            quotes,
            failures: [{ investmentId: 'failed', symbol: 'F', reason: 'missing' }],
          }
        })
        mockSetRefreshFailures.mockImplementation((failures) => {
          trace.push(['failures', failures])
        })
        mockSetLastPriceFetch.mockImplementation((timestamp) => {
          trace.push(['timestamp', timestamp])
        })
        vi.mocked(savePricesToDB).mockImplementation(async (saved) => {
          trace.push(['save', [...saved.keys()]])
          if (scenario === 'save-error') throw new Error('save-failed')
          if (scenario === 'replace-fetch') {
            mockLiveFetch = vi.fn(async () => {
              trace.push('fetch:replacement')
            })
          }
        })
        render(<Investments />)
        mockFetch.mockImplementation(async () => {
          trace.push('fetch:captured')
          if (scenario === 'fetch-error') throw new Error('refresh-failed')
        })
        vi.mocked(toast.success).mockImplementation(() => {
          trace.push('toast:success')
          return 'toast'
        })
        vi.mocked(toast.info).mockImplementation(() => {
          trace.push('toast:info')
          return 'toast'
        })
        vi.mocked(toast.error).mockImplementation((message) => {
          trace.push(['toast:error', message])
          return 'toast'
        })

        fireEvent.click(screen.getByRole('button', { name: /summary.refresh/i }))

        await waitFor(() => {
          expect(screen.getByRole('button', { name: /summary.refresh/i })).toBeEnabled()
        })
        const common: unknown[] = ['prices', ['failures', { failed: 'missing' }]]
        if (scenario !== 'zero') common.push(['save', ['i']])
        if (scenario !== 'zero' && scenario !== 'save-error') {
          common.push(['timestamp', '2026-11-08T12:00:00.000Z'], 'fetch:captured')
        }
        expect(trace).toEqual([
          ...common,
          scenario === 'zero'
            ? 'toast:info'
            : scenario === 'save-error'
              ? ['toast:error', 'save-failed']
              : scenario === 'fetch-error'
                ? ['toast:error', 'refresh-failed']
                : 'toast:success',
        ])
        expect(fetchAllCurrentPrices).toHaveBeenCalledTimes(1)
        expect(fetchAllCurrentPrices).toHaveBeenCalledWith(
          mockInvestments,
          new Map([
            ['i', { provider: 'finnhub', instrumentId: 'S', exchange: '', quoteCurrency: 'USD' }],
          ])
        )
        if (scenario === 'zero') {
          expect(savePricesToDB).not.toHaveBeenCalled()
          expect(toast.info).toHaveBeenCalledWith('toast.noPrices')
        } else {
          expect(savePricesToDB).toHaveBeenCalledWith(quotes)
        }
        if (scenario === 'success' || scenario === 'replace-fetch') {
          expect(toast.success).toHaveBeenCalledWith('toast.pricesUpdated')
        }
      }
    )

    it('keeps partial quotes in provider order and uses camelCase selections and last failure', async () => {
      mockInvestments = [
        refreshHolding({ id: 'second', priceExchange: 'XNAS', price_provider: 'manual' }),
        refreshHolding({ id: 'first' }),
        refreshHolding({ id: 'manual', priceProvider: 'manual' }),
        refreshHolding({ id: 'missing-id', priceInstrumentId: null }),
        refreshHolding({ id: 'missing-currency', currentPriceCurrency: null }),
      ]
      const quotes = new Map([
        ['second', publicationQuote],
        ['first', publicationQuote],
      ])
      vi.mocked(fetchAllCurrentPrices).mockResolvedValue({
        quotes,
        failures: [
          { investmentId: 'failed', symbol: 'F', reason: 'first reason' },
          { investmentId: 'other', symbol: 'O', reason: 'other reason' },
          { investmentId: 'failed', symbol: 'F', reason: 'last reason' },
        ],
      })
      render(<Investments />)

      fireEvent.click(screen.getByRole('button', { name: /summary.refresh/i }))

      await waitFor(() => expect(savePricesToDB).toHaveBeenCalledWith(quotes))
      expect([...vi.mocked(savePricesToDB).mock.calls[0][0].keys()]).toEqual(['second', 'first'])
      expect(fetchAllCurrentPrices).toHaveBeenCalledExactlyOnceWith(
        mockInvestments,
        new Map([
          [
            'second',
            { provider: 'finnhub', instrumentId: 'S', exchange: 'XNAS', quoteCurrency: 'USD' },
          ],
          ['first', { provider: 'finnhub', instrumentId: 'S', exchange: '', quoteCurrency: 'USD' }],
        ])
      )
      expect(mockSetRefreshFailures).toHaveBeenCalledExactlyOnceWith({
        failed: 'last reason',
        other: 'other reason',
      })
    })

    it('keeps refresh busy until the captured holdings read finishes', async () => {
      mockInvestments = [refreshHolding()]
      vi.mocked(fetchAllCurrentPrices).mockResolvedValue({
        quotes: new Map([['i', publicationQuote]]),
        failures: [],
      })
      render(<Investments />)
      // The project's ES2023 library does not expose Promise.withResolvers.
      let finish!: () => void
      const promise = new Promise<void>((resolve) => {
        finish = resolve
      })
      mockFetch.mockReturnValue(promise)
      fireEvent.click(screen.getByRole('button', { name: /summary.refresh/i }))

      await waitFor(() => expect(mockSetLastPriceFetch).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('button', { name: /summary.refresh/i })).toBeDisabled()
      finish()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /summary.refresh/i })).toBeEnabled()
      })
    })

    it('retains B-04: replacing a quote identity at the same holdings count does not reload history', () => {
      mockInvestments = [refreshHolding({ instrument_key: 'before' })]
      const { rerender } = render(<Investments />)
      expect(mockFetchPriceHistory).toHaveBeenCalledExactlyOnceWith('before', 365)

      mockInvestments = [refreshHolding({ instrument_key: 'after' })]
      rerender(<Investments />)

      expect(mockFetchPriceHistory).toHaveBeenCalledTimes(1)
    })
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

  it('does not fabricate gain metrics for unknown or known-zero cost basis', () => {
    mockInvestments = [
      {
        id: 'inv-gain',
        account_id: null,
        symbol: 'GAIN',
        name: 'Gain fixture',
        type: 'stock',
        shares: 1,
        quantityDecimal: '1',
        avg_cost_basis: 0,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPriceDecimal: '10',
        currentPriceCurrency: 'USD',
        marketValue: 1000,
        convertedMarketValue: 1000,
        gainLoss: null,
        gainLossPercent: null,
        lastPriceDate: '2024-01-10',
      },
    ]
    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      preferredCurrency: 'USD',
      totalMarketValue: 1000,
      totalCostBasis: null,
      totalGainLoss: null,
      totalGainLossPercent: null,
      totalsComplete: true,
      gainsComplete: false,
    }

    const { rerender } = render(<Investments />)
    const gainMetric = screen.getByText('summary.totalGainLoss').closest('.metric-item')
    expect(gainMetric?.querySelector('strong')).toHaveTextContent('—')
    expect(gainMetric).not.toHaveTextContent('+0')
    expect(gainMetric).not.toHaveTextContent('0.00%')

    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      totalCostBasis: 0,
      totalGainLoss: 1000,
      totalGainLossPercent: null,
      gainsComplete: true,
    }
    rerender(<Investments />)

    const knownZeroMetric = screen.getByText('summary.totalGainLoss').closest('.metric-item')
    expect(knownZeroMetric?.querySelector('strong')).not.toHaveTextContent('—')
    expect(knownZeroMetric).not.toHaveTextContent('%')
  })

  it('reflows gain money and percentage so MetricStrip can keep overflow hidden', () => {
    mockInvestments = [
      {
        id: 'inv-gain-wrap',
        account_id: null,
        symbol: 'WRAP',
        name: 'Wrap fixture',
        type: 'stock',
        shares: 1,
        quantityDecimal: '1',
        avg_cost_basis: 1782150,
        currency: 'USD',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        currentPriceDecimal: '224.11',
        currentPriceCurrency: 'USD',
        marketValue: 2241100,
        convertedMarketValue: 2241100,
        gainLoss: 458950,
        gainLossPercent: 25.75,
        lastPriceDate: '2024-01-10',
      },
    ]
    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      preferredCurrency: 'USD',
      totalMarketValue: 2241100,
      totalCostBasis: 1782150,
      totalGainLoss: 458950,
      totalGainLossPercent: 25.75,
      totalsComplete: true,
      gainsComplete: true,
    }

    const { rerender } = render(<Investments />)
    const gainMetric = screen.getByText('summary.totalGainLoss').closest('.metric-item')
    expect(gainMetric).toHaveTextContent('+$4,589.50')
    expect(gainMetric).toHaveTextContent('(+25.75%)')
    const value = gainMetric?.querySelector('strong span')
    expect(value?.className).toMatch(/flex-wrap/)
    expect(value?.className).toMatch(/max-w-full/)
    expect(gainMetric?.querySelector('.metric-strip')).toBeNull()

    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      totalGainLoss: 987654321,
      totalGainLossPercent: 125.75,
    }
    rerender(<Investments />)
    const largeMetric = screen.getByText('summary.totalGainLoss').closest('.metric-item')
    expect(largeMetric).toHaveTextContent('+$9,876,543.21')
    expect(largeMetric).toHaveTextContent('(+125.75%)')
    expect(largeMetric?.querySelector('strong span')?.className).toMatch(/flex-wrap/)
  })

  it('sorts mixed-currency values by converted value and puts unavailable values last', () => {
    const base = {
      account_id: null,
      name: 'Sort fixture',
      type: 'stock',
      shares: 1,
      quantityDecimal: '1',
      avg_cost_basis: 0,
      currency: 'USD',
      notes: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      currentPriceDecimal: '1',
      currentPriceCurrency: 'USD',
      gainLoss: null,
      gainLossPercent: null,
      lastPriceDate: '2024-01-10',
    }
    mockInvestments = [
      {
        ...base,
        id: 'native-high',
        symbol: 'NATIVE-HIGH',
        marketValue: 100000,
        convertedMarketValue: 5000,
      },
      {
        ...base,
        id: 'target-high',
        symbol: 'TARGET-HIGH',
        marketValue: 10000,
        convertedMarketValue: 10000,
      },
      {
        ...base,
        id: 'unavailable',
        symbol: 'UNAVAILABLE',
        marketValue: 999999,
        convertedMarketValue: null,
      },
    ]

    render(<Investments />)

    const target = screen.getAllByText('TARGET-HIGH')[0]
    const native = screen.getAllByText('NATIVE-HIGH')[0]
    const unavailable = screen.getAllByText('UNAVAILABLE')[0]
    expect(target.compareDocumentPosition(native) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      native.compareDocumentPosition(unavailable) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
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
    expect(screen.getByText('currencyWarning.more')).toBeInTheDocument()
    expect(screen.getByText('currencyWarning.body')).toBeInTheDocument()
    expect(screen.getByText('MXN')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('$630.00')).not.toBeInTheDocument()
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

  it('leads with a complete allocation ring and full report-currency legend, not a USD tooltip', () => {
    mockInvestments = [
      {
        id: 'inv-stock',
        symbol: 'QA-NWEQ',
        name: 'QA Northwind Equity',
        type: 'stock',
        shares: 12,
        quantityDecimal: '12',
        currency: 'USD',
        marketValue: 101400,
        convertedMarketValue: 101400,
        currentPriceCurrency: 'USD',
        gainLoss: 5400,
        gainLossPercent: 5.63,
      },
      {
        id: 'inv-etf',
        symbol: 'QA-HBRF',
        name: 'QA Harbor Index ETF',
        type: 'etf',
        shares: 5,
        quantityDecimal: '5',
        currency: 'USD',
        marketValue: 62800,
        convertedMarketValue: 62800,
        currentPriceCurrency: 'USD',
        gainLoss: 2800,
        gainLossPercent: 4.67,
      },
    ]
    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      preferredCurrency: 'USD',
      totalsComplete: true,
      gainsComplete: true,
      totalMarketValue: 164200,
      totalCostBasis: 156000,
      totalGainLoss: 8200,
      totalGainLossPercent: 5.26,
      byType: {
        stock: { marketValue: 101400, gainLoss: 5400, count: 1 },
        etf: { marketValue: 62800, gainLoss: 2800, count: 1 },
      },
    }

    render(<Investments />)

    const ring = screen.getByTestId('allocation-ring')
    const valueLabel = screen.getByText('summary.portfolioValue')
    expect(ring.compareDocumentPosition(valueLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const allocationTable = screen.getByRole('table', { name: 'chart.allocation USD' })
    expect(allocationTable).toHaveAttribute('id', 'investment-allocation-table')
    expect(allocationTable).not.toHaveClass('sr-only')
    expect(allocationTable).not.toHaveAttribute('aria-hidden')
    expect(allocationTable.parentElement?.tagName).toBe('DIV')
    expect(allocationTable.parentElement).toHaveClass('sr-only')
    expect(allocationTable.parentElement).not.toHaveAttribute('aria-hidden')
    expect(allocationTable).toHaveTextContent('$1,014.00')
    expect(allocationTable).toHaveTextContent('$628.00')
    expect(ring).toHaveAttribute('role', 'img')
    expect(ring).toHaveAttribute('aria-describedby', 'investment-allocation-table')
    expect(screen.getByTestId('allocation-legend')).toHaveTextContent('$1,014.00')
    expect(screen.getByTestId('allocation-legend')).toHaveTextContent('$628.00')
    expect(screen.getByTestId('allocation-swatch-stock')).toHaveStyle({
      width: '8px',
      height: '8px',
    })
    expect(screen.queryByText('chart.portfolioValue')).not.toBeInTheDocument()
    expect(document.querySelector('.h-\\[240px\\]')).toBeNull()
    expect(document.body.innerHTML).not.toContain('var(--color-accent)')
  })

  it('plots only a proven same-currency quote series and withholds a mixed-currency curve', () => {
    const key = 'v1|stock|manual|QA-NORTHWIND|QA-MANUAL|USD'
    mockInvestments = [
      {
        id: 'inv-stock',
        symbol: 'QA-NWEQ',
        name: 'QA Northwind Equity',
        type: 'stock',
        shares: 12,
        quantityDecimal: '12',
        currency: 'USD',
        instrument_key: key,
        priceProvider: 'manual',
        priceInstrumentId: 'QA-NORTHWIND',
        priceExchange: 'QA-MANUAL',
        currentPriceCurrency: 'USD',
        marketValue: 101400,
        convertedMarketValue: 101400,
        gainLoss: 5400,
        gainLossPercent: 5.63,
      },
    ]
    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      preferredCurrency: 'USD',
      totalsComplete: true,
      totalMarketValue: 101400,
      byType: { stock: { marketValue: 101400, gainLoss: 5400, count: 1 } },
    }
    mockPriceHistory = new Map([
      [
        key,
        [
          { date: '2026-08-15', unitPriceDecimal: '76.5' },
          { date: '2026-10-17', unitPriceDecimal: '84.5' },
        ],
      ],
    ])

    const { rerender } = render(<Investments />)
    const table = screen.getByTestId('quote-history-table')
    expect(table).toHaveAttribute('id', 'investment-quote-history-table')
    expect(table).not.toHaveClass('sr-only')
    expect(table).not.toHaveAttribute('aria-hidden')
    expect(table).not.toHaveAttribute('hidden')
    expect(table.parentElement?.tagName).toBe('DIV')
    expect(table.parentElement).toHaveClass('sr-only')
    expect(table.parentElement).not.toHaveAttribute('aria-hidden')
    expect(table.parentElement).not.toHaveAttribute('hidden')
    expect(table.querySelector('caption')).toHaveTextContent('chart.currentQuantities')
    expect(table).toHaveTextContent('2026-08-15')
    expect(table).toHaveTextContent('2026-10-17')
    expect(table).toHaveTextContent('$918.00')
    expect(table).toHaveTextContent('$1,014.00')
    const quoteChart = screen.getByRole('img', { name: 'chart.currentQuantities' })
    expect(quoteChart).toHaveAttribute('aria-describedby', 'investment-quote-history-table')
    expect(quoteChart.closest('[data-testid="quote-history-plot"]')).toBe(
      screen.getByTestId('quote-history-plot')
    )
    expect(screen.getAllByText('chart.currentQuantities').length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: 'chart.range' }).querySelector('button')).toHaveClass(
      'min-h-11'
    )
    expect(document.querySelector('.h-\\[240px\\]')).toBeNull()

    mockInvestments = [
      {
        ...(mockInvestments[0] as object),
        currentPriceCurrency: 'MXN',
        instrument_key: 'v1|stock|manual|QA-NORTHWIND|QA-MANUAL|MXN',
      },
    ]
    mockPortfolioSummary = {
      ...mockPortfolioSummary,
      preferredCurrency: 'USD',
      totalsComplete: false,
      totalMarketValue: null,
      byType: {},
    }
    rerender(<Investments />)
    expect(screen.queryByTestId('quote-history-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quote-history-plot')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'chart.currentQuantities' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('allocation-ring')).not.toBeInTheDocument()
    expect(document.querySelector('.h-\\[240px\\]')).toBeNull()
  })
})
