import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'
import { Dashboard } from '../dashboard'

// ResizeObserver polyfill for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { currencies?: string; details?: string; message?: string; count?: number }
    ) =>
      options?.currencies
        ? `${key}: ${options.currencies}`
        : options?.details
          ? `${key}: ${options.details}`
          : options?.message
            ? `${key}: ${options.message}`
            : typeof options?.count === 'number'
              ? `${key}: ${options.count}`
              : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
const mockFetchTransactions = vi.fn().mockResolvedValue(undefined)
const mockOpenTransactionDialog = vi.fn()
const mockFetchGoals = vi.fn().mockResolvedValue(undefined)
const mockLoadRates = vi.fn().mockResolvedValue(undefined)
const mockRetrySplits = vi.fn()
const mockLoadHistory = vi.fn().mockResolvedValue(undefined)
const mockCalculateCurrent = vi.fn().mockResolvedValue(undefined)
const mockDashboardQuery = vi.fn().mockResolvedValue([])

vi.mock('@/lib/database', () => ({
  query: (...args: unknown[]) => mockDashboardQuery(...args),
}))

let mockNetWorthHistory: Array<{
  date: string
  netWorth: number
  assets: number
  liabilities: number
}> = []
let mockNetWorth = 0
let mockNetWorthComplete = true
let mockNetWorthCurrency = 'USD'
let mockNetWorthMissingCurrencies: string[] = []
let mockNetWorthUnresolvedAccountIds: string[] = []
let mockNetWorthIncompleteHoldingIds: string[] = []
let mockNetWorthLoading = false
let mockNetWorthHistoryComplete = true
let mockNetWorthHistoryAuthorityKey = 'USD|'
let mockNetWorthHistoryCurrency: string | null = 'USD'
let mockNetWorthHistoryRequestedPeriod = '6m'
let mockNetWorthHistoryLoading = false
let mockNetWorthHistoryError: string | null = null
let mockMainCurrency: string | null = 'USD'
let mockManualRates: DatedExchangeRate[] = []

function makeRate(fromCurrency: string, toCurrency: string, rateDecimal: string) {
  return {
    id: `${fromCurrency}-${toCurrency}-${rateDecimal}`,
    fromCurrency,
    toCurrency,
    rateDecimal,
    effectiveFrom: '2000-01-01',
    supersedesRateId: null,
    createdAt: '2000-01-01T00:00:00.000Z',
    sourceNote: null,
  } satisfies DatedExchangeRate
}

const mockConvertHistoricalToPreferred = vi.fn((amount: number, currency: string) => {
  if (!mockMainCurrency) {
    return {
      complete: false as const,
      preferredCurrency: 'USD',
      missingCurrencies: [] as string[],
      reason: 'main_currency_unconfigured' as const,
    }
  }
  if (currency === mockMainCurrency) {
    return {
      complete: true as const,
      preferredCurrency: mockMainCurrency,
      amountCentavos: amount,
      missingCurrencies: [] as const,
    }
  }
  const rate = mockManualRates.find(
    (item) => item.fromCurrency === currency && item.toCurrency === mockMainCurrency
  )
  return rate
    ? {
        complete: true as const,
        preferredCurrency: mockMainCurrency,
        amountCentavos: Math.round(amount * Number(rate.rateDecimal)),
        missingCurrencies: [] as const,
      }
    : {
        complete: false as const,
        preferredCurrency: mockMainCurrency,
        missingCurrencies: [currency],
        reason: 'missing_exchange_rates' as const,
      }
})

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openTransactionDialog: mockOpenTransactionDialog,
  }),
}))

let mockAccounts: unknown[] = []
let mockInvestments: unknown[] = []
let mockTransactions: unknown[] = []
let mockGoals: unknown[] = []
let mockAccountError: string | null = null
let mockTransactionError: string | null = null
let mockGoalError: string | null = null
let mockCurrencyError: string | null = null
let mockSplitsError: string | null = null

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: mockAccounts,
    isLoading: false,
    fetchError: mockAccountError,
    error: mockAccountError,
    fetch: mockFetchAccounts,
  }),
}))

vi.mock('@/stores/investment-store', () => ({
  useInvestmentStore: () => ({
    investments: mockInvestments,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    transactions: mockTransactions,
    isLoading: false,
    fetchError: mockTransactionError,
    error: mockTransactionError,
    fetch: mockFetchTransactions,
  }),
}))

vi.mock('@/stores/goal-store', () => ({
  useGoalStore: () => ({
    goals: mockGoals,
    fetchError: mockGoalError,
    fetch: mockFetchGoals,
  }),
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      mainCurrency: mockMainCurrency,
      preferredCurrency: mockMainCurrency ?? 'USD',
      manualRates: mockManualRates,
      error: mockCurrencyError,
      loadRates: mockLoadRates,
      convertHistoricalToPreferred: mockConvertHistoricalToPreferred,
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/stores/achievement-store', () => ({
  useAchievementStore: () => ({
    currentStreak: 0,
    longestStreak: 0,
    newlyUnlocked: [],
    checkForNew: vi.fn(),
    dismissNew: vi.fn(),
  }),
}))

vi.mock('@/stores/spending-insights-store', () => ({
  useSpendingInsightsStore: () => ({
    insights: [],
    momComparisons: [],
    isLoading: false,
    loadComparisons: vi.fn(),
  }),
}))

vi.mock('@/stores/net-worth-store', () => ({
  useNetWorthStore: () => ({
    history: mockNetWorthHistory,
    historyComplete: mockNetWorthHistoryComplete,
    historyAuthorityKey: mockNetWorthHistoryAuthorityKey,
    historyCurrency: mockNetWorthHistoryCurrency,
    historyRequestedPeriod: mockNetWorthHistoryRequestedPeriod,
    historyLoading: mockNetWorthHistoryLoading,
    historyError: mockNetWorthHistoryError,
    historyMissingCurrencies: [],
    isLoading: mockNetWorthLoading,
    loadHistory: mockLoadHistory,
    calculateCurrent: mockCalculateCurrent,
    totalsComplete: mockNetWorthComplete,
    netWorth: mockNetWorth,
    preferredCurrency: mockNetWorthCurrency,
    totalAssets: 0,
    totalLiabilities: 0,
    missingCurrencies: mockNetWorthMissingCurrencies,
    unresolvedAccountIds: mockNetWorthUnresolvedAccountIds,
    incompleteHoldingIds: mockNetWorthIncompleteHoldingIds,
  }),
}))

vi.mock('@/components/dashboard/use-dashboard-splits', () => ({
  useDashboardSplits: () => ({
    splits: [],
    isLoading: false,
    error: mockSplitsError,
    retry: mockRetrySplits,
  }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: (props: { children: React.ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('recharts', () => ({
  LineChart: () => null,
  Line: () => null,
  BarChart: () => null,
  Bar: () => null,
  ComposedChart: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
  AreaChart: () => null,
  Area: () => null,
}))

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockAccounts = []
    mockInvestments = []
    mockTransactions = []
    mockGoals = []
    mockAccountError = null
    mockTransactionError = null
    mockGoalError = null
    mockCurrencyError = null
    mockSplitsError = null
    mockNetWorthHistory = []
    mockNetWorth = 0
    mockNetWorthComplete = true
    mockNetWorthCurrency = 'USD'
    mockNetWorthMissingCurrencies = []
    mockNetWorthUnresolvedAccountIds = []
    mockNetWorthIncompleteHoldingIds = []
    mockNetWorthLoading = false
    mockNetWorthHistoryComplete = true
    mockNetWorthHistoryAuthorityKey = 'USD|'
    mockNetWorthHistoryCurrency = 'USD'
    mockNetWorthHistoryRequestedPeriod = '6m'
    mockNetWorthHistoryLoading = false
    mockNetWorthHistoryError = null
    mockMainCurrency = 'USD'
    mockManualRates = []
    mockDashboardQuery.mockReset()
    mockDashboardQuery.mockResolvedValue([])
    mockCalculateCurrent.mockReset()
    mockCalculateCurrent.mockImplementation(() => new Promise<void>(() => {}))
  })

  it('fails category analytics closed when split allocations cannot be loaded', async () => {
    const user = userEvent.setup()
    mockSplitsError = 'Split query failed'

    render(<Dashboard />)
    await user.click(screen.getByText('analytics.categories'))

    expect(screen.getAllByText(/analytics.categoriesUnavailable/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Split query failed/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('analytics.categoriesChartLabel')).not.toBeInTheDocument()
  })

  it('calls fetchAccounts and fetchTransactions on mount', () => {
    render(<Dashboard />)

    expect(mockFetchAccounts).toHaveBeenCalled()
    expect(mockFetchTransactions).toHaveBeenCalled()
  })

  it('defaults to a numbers-only summary and switches to full-width history and comparison views', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'nu', name: 'Nu Card', type: 'credit_card', currency: 'USD', balance: -12000 },
      { id: 'bbva', name: 'BBVA', type: 'checking', currency: 'USD', balance: 85000 },
    ]
    mockNetWorthHistory = [
      { date: '2026-01-01', netWorth: 60000, assets: 80000, liabilities: 20000 },
      { date: '2026-02-01', netWorth: 73000, assets: 85000, liabilities: 12000 },
    ]
    mockDashboardQuery.mockImplementation((_sql: string, params: unknown[]) =>
      Promise.resolve(
        params[0] === 'nu'
          ? [{ date: '2026-02-01', balance: -12000 }]
          : [{ date: '2026-02-01', balance: 85000 }]
      )
    )

    render(<Dashboard />)

    expect(screen.getByRole('tab', { name: 'overview.views.summary' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.queryByRole('img', { name: 'overview.chartTitle' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    expect(screen.getByLabelText('overview.chartTitle')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    expect(screen.getByLabelText('overview.comparison.firstAccount')).toBeInTheDocument()
    expect(screen.getByLabelText('overview.comparison.secondAccount')).toBeInTheDocument()
    await waitFor(() => expect(mockDashboardQuery).toHaveBeenCalledTimes(2))
  })

  it('withholds the history chart, table, and delta when its authority is stale', async () => {
    mockNetWorthHistory = [
      { date: '2026-01-01', netWorth: 12_345, assets: 12_345, liabilities: 0 },
      { date: '2026-02-01', netWorth: 67_890, assets: 67_890, liabilities: 0 },
    ]
    mockNetWorthHistoryAuthorityKey = 'USD|obsolete-rate'

    render(<Dashboard />)
    await userEvent.setup().click(screen.getByRole('tab', { name: 'overview.views.history' }))

    expect(screen.getByRole('alert')).toHaveTextContent('overview.historyUnavailable')
    expect(screen.queryByRole('img', { name: 'overview.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$123.45')).not.toBeInTheDocument()
    expect(screen.queryByText('$678.90')).not.toBeInTheDocument()
  })

  it('withholds the history chart, table, and delta when its requested period is stale', async () => {
    mockNetWorthHistory = [
      { date: '2026-01-01', netWorth: 12_345, assets: 12_345, liabilities: 0 },
      { date: '2026-02-01', netWorth: 67_890, assets: 67_890, liabilities: 0 },
    ]
    mockNetWorthHistoryRequestedPeriod = '1y'

    render(<Dashboard />)
    await userEvent.setup().click(screen.getByRole('tab', { name: 'overview.views.history' }))

    expect(screen.getByRole('alert')).toHaveTextContent('overview.historyUnavailable')
    expect(screen.queryByRole('img', { name: 'overview.chartTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('$123.45')).not.toBeInTheDocument()
    expect(screen.queryByText('$678.90')).not.toBeInTheDocument()
  })

  it('removes only the Overview toolbar add action', () => {
    const { container } = render(<Dashboard />)

    expect(container.querySelector('.page-toolbar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'addTransaction' })).toBeInTheDocument()
  })

  describe('without accounts', () => {
    it('keeps dashboard intelligence visible', () => {
      render(<Dashboard />)

      expect(screen.getAllByText('analytics.spendingAndCashFlow').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('recentActivity')).toBeInTheDocument()
      expect(screen.queryByText('empty.addAccount')).not.toBeInTheDocument()
    })
  })

  it('does not render removed dashboard intelligence sections', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
    ]
    mockTransactions = [
      {
        id: 'tx-1',
        description: 'Coffee',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      },
    ]

    render(<Dashboard />)

    expect(screen.queryByText('alerts.title')).not.toBeInTheDocument()
    expect(screen.queryByText('forecast.title')).not.toBeInTheDocument()
    expect(screen.queryByText('healthScore.title')).not.toBeInTheDocument()
    expect(screen.queryByText('recap.title')).not.toBeInTheDocument()
  })

  it('shows a visible error banner when core dashboard data fails', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 1000 },
    ]
    mockTransactions = [
      {
        id: 'tx-1',
        description: 'Coffee',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      },
    ]
    mockAccountError = 'Accounts unavailable'
    mockTransactionError = 'Transactions unavailable'

    render(<Dashboard />)

    expect(screen.getByText('errors.title')).toBeInTheDocument()
    expect(screen.getByText('errors.accounts: Accounts unavailable')).toBeInTheDocument()
    expect(screen.getByText('errors.transactions: Transactions unavailable')).toBeInTheDocument()
  })

  it('keeps goal and exchange rate partial failures visible', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 1000 },
    ]
    mockGoalError = 'Goals unavailable'
    mockCurrencyError = 'Rates unavailable'

    render(<Dashboard />)

    expect(screen.getByText('errors.title')).toBeInTheDocument()
    expect(screen.getByText('errors.goals: Goals unavailable')).toBeInTheDocument()
    expect(screen.getByText('errors.rates: Rates unavailable')).toBeInTheDocument()
  })

  it('shows account load failures in the dashboard error banner', () => {
    mockAccountError = 'Accounts unavailable'

    render(<Dashboard />)

    expect(screen.getByText('errors.title')).toBeInTheDocument()
    expect(screen.getByText('errors.accounts: Accounts unavailable')).toBeInTheDocument()
    expect(screen.queryByText('empty.addAccount')).not.toBeInTheDocument()
  })

  describe('with accounts', () => {
    beforeEach(() => {
      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 150000 },
        { id: 'acc-2', name: 'Savings', type: 'savings', currency: 'USD', balance: 50000 },
        { id: 'acc-3', name: 'Credit', type: 'credit_card', currency: 'USD', balance: -10000 },
        { id: 'acc-4', name: 'Extra', type: 'cash', currency: 'USD', balance: 5000 },
      ]
    })

    it('shows the complete net-worth-store calculation in the hero card', async () => {
      mockNetWorth = 195000
      mockCalculateCurrent.mockResolvedValue(undefined)

      render(<Dashboard />)

      expect(await screen.findByText('$1,950.00')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('withholds a previously complete current value while corrected manual-rate authority recalculates', async () => {
      mockNetWorth = 195000
      mockCalculateCurrent.mockResolvedValue(undefined)
      const { rerender } = render(<Dashboard />)
      expect(await screen.findByText('$1,950.00')).toBeInTheDocument()

      mockCalculateCurrent.mockImplementationOnce(() => new Promise<void>(() => {}))
      mockManualRates = [makeRate('EUR', 'USD', '1.25')]
      rerender(<Dashboard />)

      expect(screen.getByRole('alert')).toHaveTextContent('currency.totalUnavailable')
      expect(screen.queryByText('$1,950.00')).not.toBeInTheDocument()
    })

    it('withholds an incomplete current net worth and identifies missing rates', async () => {
      mockNetWorthComplete = false
      mockCalculateCurrent.mockResolvedValue(undefined)
      mockNetWorthMissingCurrencies = ['EUR']

      render(<Dashboard />)

      const warning = await screen.findByRole('alert')
      expect(warning).toHaveTextContent('currency.totalUnavailable')
      expect(warning).toHaveTextContent('currency.missingRates: EUR')
      expect(screen.queryByText('$1,950.00')).not.toBeInTheDocument()
    })

    it('names unvalued holdings instead of an empty FX sentence', async () => {
      mockNetWorthComplete = false
      mockNetWorthMissingCurrencies = []
      mockNetWorthIncompleteHoldingIds = ['hold-unvalued-1', 'hold-unvalued-2']

      render(<Dashboard />)

      const warning = await screen.findByRole('alert')
      expect(warning).toHaveTextContent('currency.totalUnavailable')
      expect(warning).toHaveTextContent('netWorth.incompleteHoldings: 2')
      expect(warning).not.toHaveTextContent('currency.missingRates')
      expect(warning).not.toHaveTextContent('hold-unvalued-1')
      expect(warning).not.toHaveTextContent('quote')
    })

    it('names unresolved ownership instead of an empty FX sentence', async () => {
      mockNetWorthComplete = false
      mockNetWorthMissingCurrencies = []
      mockNetWorthUnresolvedAccountIds = ['acct-unresolved-ownership']

      render(<Dashboard />)

      const warning = await screen.findByRole('alert')
      expect(warning).toHaveTextContent('netWorth.unresolvedOwnership: 1')
      expect(warning).not.toHaveTextContent('currency.missingRates')
      expect(warning).not.toHaveTextContent('acct-unresolved-ownership')
    })

    it('combines real FX names with holding and ownership counts', async () => {
      mockNetWorthComplete = false
      mockNetWorthMissingCurrencies = ['EUR', 'MXN']
      mockNetWorthIncompleteHoldingIds = ['hold-a']
      mockNetWorthUnresolvedAccountIds = ['acct-a', 'acct-b']

      render(<Dashboard />)

      const warning = await screen.findByRole('alert')
      expect(warning).toHaveTextContent('currency.missingRates: EUR, MXN')
      expect(warning).toHaveTextContent('netWorth.incompleteHoldings: 1')
      expect(warning).toHaveTextContent('netWorth.unresolvedOwnership: 2')
      expect(warning).not.toHaveTextContent('hold-a')
      expect(warning).not.toHaveTextContent('acct-a')
    })

    it('falls back to a generic unavailable reason when incomplete lists are empty', async () => {
      mockNetWorthComplete = false
      mockNetWorthMissingCurrencies = []
      mockNetWorthIncompleteHoldingIds = []
      mockNetWorthUnresolvedAccountIds = []

      render(<Dashboard />)

      const warning = await screen.findByRole('alert')
      expect(warning).toHaveTextContent('netWorth.unavailable')
      expect(warning).not.toHaveTextContent('currency.missingRates')
    })

    it('does not render account preview cards', async () => {
      render(<Dashboard />)
      await waitFor(() =>
        expect(
          within(document.getElementById('overview-comparison-panel')!).queryByText(
            'overview.comparison.loading'
          )
        ).not.toBeInTheDocument()
      )

      expect(screen.queryByRole('heading', { name: 'Checking' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Savings' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Credit' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Extra' })).not.toBeInTheDocument()
    })

    it('renders zero and negative complete net worth without inventing a mixed total', async () => {
      mockCalculateCurrent.mockResolvedValue(undefined)
      const { unmount } = render(<Dashboard />)
      expect(await screen.findAllByText('$0.00')).not.toHaveLength(0)
      unmount()

      mockNetWorth = -1250
      render(<Dashboard />)
      expect(await screen.findByText('-$12.50')).toBeInTheDocument()
    })
  })

  describe('with transactions', () => {
    beforeEach(() => {
      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      ]
    })

    it('renders recent transactions (up to 8)', () => {
      mockTransactions = Array.from({ length: 10 }, (_, i) => ({
        id: `tx-${i}`,
        description: `Transaction ${i}`,
        type: 'expense',
        amount: 1000,
        currency: 'USD',
        date: '2024-01-15',
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      }))

      render(<Dashboard />)

      // Only first 8 shown
      expect(screen.getByText('Transaction 0')).toBeInTheDocument()
      expect(screen.getByText('Transaction 7')).toBeInTheDocument()
      expect(screen.queryByText('Transaction 8')).not.toBeInTheDocument()
    })

    it('income shown in success color, expense in destructive', () => {
      mockTransactions = [
        {
          id: 'tx-inc',
          description: 'Salary',
          type: 'income',
          amount: 500000,
          currency: 'USD',
          date: '2024-01-15',
          category_color: null,
          category_name: null,
          account_name: 'Checking',
        },
        {
          id: 'tx-exp',
          description: 'Rent',
          type: 'expense',
          amount: 200000,
          currency: 'USD',
          date: '2024-01-15',
          category_color: null,
          category_name: null,
          account_name: 'Checking',
        },
      ]

      const { container } = render(<Dashboard />)

      // Find the transaction amount spans (font-heading text-sm font-semibold)
      const amountSpans = container.querySelectorAll('span.font-heading.text-sm.font-semibold')
      const successSpan = Array.from(amountSpans).find((el) =>
        el.classList.contains('text-success')
      )
      const destructiveSpan = Array.from(amountSpans).find((el) =>
        el.classList.contains('text-destructive')
      )

      expect(successSpan).toBeInTheDocument()
      expect(successSpan!.textContent).toContain('+')
      expect(destructiveSpan).toBeInTheDocument()
      expect(destructiveSpan!.textContent).toContain('-')
    })

    it('"Add Transaction" button calls openTransactionDialog', async () => {
      const user = userEvent.setup()
      mockTransactions = []

      render(<Dashboard />)

      // Empty transaction state shows add button
      const addBtn = screen.getByText('addTransaction')
      await user.click(addBtn)

      expect(mockOpenTransactionDialog).toHaveBeenCalled()
    })
  })

  describe('metrics', () => {
    it('computes monthly income/expenses and savings rate', () => {
      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      ]
      const today = dayjs().format('YYYY-MM-DD')
      mockTransactions = [
        {
          id: 'tx-1',
          description: 'Salary',
          type: 'income',
          amount: 500000,
          currency: 'USD',
          date: today,
          category_color: null,
          category_name: null,
          account_name: 'Checking',
        },
        {
          id: 'tx-2',
          description: 'Rent',
          type: 'expense',
          amount: 200000,
          currency: 'USD',
          date: today,
          category_color: null,
          category_name: null,
          account_name: 'Checking',
        },
      ]

      render(<Dashboard />)

      // Monthly income: $5,000.00 (may appear in multiple places)
      expect(screen.getAllByText('$5,000.00').length).toBeGreaterThanOrEqual(1)
      // Monthly expenses: $2,000.00
      expect(screen.getAllByText('$2,000.00').length).toBeGreaterThanOrEqual(1)
      // Savings rate: (5000-2000)/5000*100 = 60%
      expect(screen.getByText('60%')).toBeInTheDocument()
    })

    it('recomputes dashboard cash flow after deferred rates and a preferred-currency switch', () => {
      mockTransactions = [
        {
          id: 'tx-usd-income',
          description: 'USD income',
          type: 'income',
          amount: 10000,
          currency: 'USD',
          date: dayjs().format('YYYY-MM-DD'),
          status: 'posted',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
          is_archived: 0,
          category_color: null,
          category_name: null,
          account_name: 'Dollar account',
        },
        {
          id: 'tx-eur-income',
          description: 'EUR income',
          type: 'income',
          amount: 10000,
          currency: 'EUR',
          date: dayjs().format('YYYY-MM-DD'),
          status: 'posted',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
          is_archived: 0,
          category_color: null,
          category_name: null,
          account_name: 'Euro account',
        },
      ]

      const { rerender } = render(<Dashboard />)
      expect(screen.getAllByText(/currency\.missingDatedRates: EUR/).length).toBeGreaterThan(0)

      mockManualRates = [makeRate('EUR', 'USD', '2')]
      rerender(<Dashboard />)
      expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)

      mockMainCurrency = 'EUR'
      mockManualRates = [makeRate('USD', 'EUR', '0.5')]
      rerender(<Dashboard />)
      expect(screen.getAllByText('€150.00').length).toBeGreaterThan(0)
      expect(screen.queryByText('€300.00')).not.toBeInTheDocument()
    })

    it('applies migration-019 cash-flow eligibility to every aggregate', async () => {
      const user = userEvent.setup()
      const today = dayjs().format('YYYY-MM-DD')
      const previousMonth = dayjs().subtract(1, 'month').format('YYYY-MM-DD')
      const transaction = (
        id: string,
        type: string,
        amount: number,
        date = today,
        overrides: Record<string, unknown> = {}
      ) => ({
        id,
        description: id,
        type,
        amount,
        currency: 'USD',
        date,
        status: 'posted',
        reporting_treatment: 'normal',
        transaction_kind: 'standard',
        is_archived: 0,
        category_id: type === 'expense' ? 'cat-food' : null,
        category_color: '#f97316',
        category_name: type === 'expense' ? 'Food' : null,
        account_name: 'Checking',
        ...overrides,
      })

      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      ]
      mockTransactions = [
        transaction('posted-income', 'income', 100_000),
        transaction('cleared-income', 'income', 50_000, today, { status: 'cleared' }),
        transaction('posted-food', 'expense', 20_000),
        transaction('cleared-transport', 'expense', 10_000, today, {
          status: 'cleared',
          category_id: 'cat-transport',
          category_name: 'Transport',
          category_color: '#38bdf8',
        }),
        transaction('previous-income', 'income', 90_000, previousMonth),
        transaction('previous-food', 'expense', 5_000, previousMonth),
        transaction('pending', 'expense', 901_000, today, { status: 'pending' }),
        transaction('reconciliation-bridge', 'expense', 902_000, today, {
          reporting_treatment: 'exclude_from_cashflow',
          transaction_kind: 'reconciliation_bridge',
        }),
        transaction('archived-mirror', 'expense', 903_000, today, {
          transaction_kind: 'archived_transfer_mirror',
        }),
        transaction('archived-standard', 'expense', 904_000, today, { is_archived: 1 }),
        transaction('transfer', 'transfer', 905_000),
        transaction('malformed-status', 'expense', 906_000, today, { status: 'unknown' }),
        transaction('malformed-reporting', 'expense', 907_000, today, {
          reporting_treatment: 'unknown',
        }),
        transaction('malformed-kind', 'expense', 908_000, today, {
          transaction_kind: 'unknown',
        }),
        transaction('malformed-type', 'refund', 909_000),
        transaction('malformed-archive', 'expense', 910_000, today, { is_archived: 'yes' }),
      ]

      render(<Dashboard />)

      expect(screen.getAllByText('$1,500.00').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('$300.00').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('80%')).toBeInTheDocument()
      expect(screen.getAllByText('+$600.00 vs last month').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('+$250.00 vs last month').length).toBeGreaterThanOrEqual(1)

      await user.click(screen.getByText('analytics.categories'))

      expect(
        screen.getByText('Food', { selector: 'dt > span:last-child' }).parentElement?.parentElement
      ).toHaveTextContent('Food$200.00')
      expect(
        screen.getByText('Transport', { selector: 'dt > span:last-child' }).parentElement
          ?.parentElement
      ).toHaveTextContent('Transport$100.00')
    })
  })

  describe('goals', () => {
    it('groups up to three distinct goal sections with a single internal heading and action', () => {
      mockGoals = Array.from({ length: 4 }, (_, index) => ({
        id: `goal-${index}`,
        name: `Goal ${index}`,
        icon: 'target',
        progress: 25,
        current_amount: 10_000,
        target_amount: 40_000,
        currency: 'USD',
      }))
      render(<Dashboard />)
      const card = screen.getByRole('heading', { name: 'goals.title' }).closest('section')!
      expect(card).toContainElement(screen.getByRole('link', { name: 'goals.viewAll' }))
      expect(card.querySelectorAll('.native-panel')).toHaveLength(0)
      expect(card).toHaveTextContent('Goal 0')
      expect(card).toHaveTextContent('Goal 2')
      expect(card).not.toHaveTextContent('Goal 3')
    })

    it('keeps progress in the goal durable native denomination across authority changes', () => {
      mockGoals = [
        {
          id: 'goal-mxn',
          name: 'Emergency fund',
          icon: 'target',
          progress: 25,
          current_amount: 10_000,
          target_amount: 40_000,
          currency: 'MXN',
          mainConversion: {
            complete: true,
            toCurrency: 'USD',
          },
        },
      ]

      const { rerender } = render(<Dashboard />)
      expect(screen.getByText('MX$100.00')).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Emergency fund' }).closest('section')
      ).toHaveTextContent('MX$400.00')

      mockMainCurrency = 'EUR'
      rerender(<Dashboard />)

      expect(screen.getByText('MX$100.00')).toBeInTheDocument()
      expect(screen.queryByText('€100.00')).not.toBeInTheDocument()
    })
  })

  describe('spending intelligence', () => {
    it('keeps the compact view tabs keyboard-accessible and removes the budgets action', async () => {
      const user = userEvent.setup()
      render(<Dashboard />)

      const paceTab = screen.getByRole('tab', { name: 'analytics.pace' })
      paceTab.focus()
      await user.keyboard('{ArrowRight}')

      expect(screen.getByRole('tab', { name: 'analytics.trend' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      expect(window.localStorage.getItem('shikin_dashboard_spending_mode')).toBe('trend')
      expect(document.querySelector('a[href="/budgets"]')).not.toBeInTheDocument()
    })

    it('exposes four spending modes with wraparound arrow, Home, and End keys', async () => {
      const user = userEvent.setup()
      render(<Dashboard />)

      const paceTab = screen.getByRole('tab', { name: 'analytics.pace' })
      const trendTab = screen.getByRole('tab', { name: 'analytics.trend' })
      const categoriesTab = screen.getByRole('tab', { name: 'analytics.categories' })
      const cashFlowTab = screen.getByRole('tab', { name: 'analytics.cashflow' })

      expect(paceTab).toHaveAttribute('aria-controls', 'spending-pace-panel')
      expect(trendTab).toHaveAttribute('aria-controls', 'spending-trend-panel')
      expect(categoriesTab).toHaveAttribute('aria-controls', 'spending-categories-panel')
      expect(cashFlowTab).toHaveAttribute('aria-controls', 'spending-cashflow-panel')

      paceTab.focus()
      await user.keyboard('{End}')
      expect(cashFlowTab).toHaveAttribute('aria-selected', 'true')
      expect(cashFlowTab).toHaveFocus()
      expect(window.localStorage.getItem('shikin_dashboard_spending_mode')).toBe('cashflow')

      await user.keyboard('{ArrowRight}')
      expect(paceTab).toHaveAttribute('aria-selected', 'true')
      expect(paceTab).toHaveFocus()

      await user.keyboard('{ArrowLeft}')
      expect(cashFlowTab).toHaveAttribute('aria-selected', 'true')

      await user.keyboard('{Home}')
      expect(paceTab).toHaveAttribute('aria-selected', 'true')
      expect(window.localStorage.getItem('shikin_dashboard_spending_mode')).toBe('pace')
    })

    it('restores persisted pace, trend, categories, and cashflow modes', () => {
      for (const mode of ['pace', 'trend', 'categories', 'cashflow'] as const) {
        window.localStorage.setItem('shikin_dashboard_spending_mode', mode)
        const { unmount } = render(<Dashboard />)
        expect(screen.getByRole('tab', { name: `analytics.${mode}` })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        unmount()
      }
    })

    it('does not render a standalone cash-flow card beside spending by category', async () => {
      const user = userEvent.setup()
      render(<Dashboard />)

      expect(
        screen.getByRole('heading', { name: 'overview.spendingByCategory' })
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'overview.cashFlow' })).not.toBeInTheDocument()
      expect(
        screen
          .getByRole('heading', { name: 'overview.spendingByCategory' })
          .closest('.native-panel')?.parentElement
      ).not.toHaveClass('xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]')

      await user.click(screen.getByRole('tab', { name: 'analytics.cashflow' }))

      expect(screen.getByRole('heading', { name: 'overview.cashFlow' })).toBeInTheDocument()
      expect(screen.getByRole('table', { name: 'overview.cashFlow' })).toBeInTheDocument()
      expect(document.querySelector('#overview-cashflow-data')?.closest('.native-panel')).toBe(
        document.getElementById('spending-cashflow-panel')?.closest('.native-panel')
      )
    })

    it('shows a deliberate main-currency setup state instead of converted zeroes', () => {
      mockMainCurrency = null
      mockTransactions = [
        {
          id: 'native-only',
          description: 'Native expense',
          type: 'expense',
          amount: 12_345,
          currency: 'MXN',
          date: dayjs().format('YYYY-MM-DD'),
          status: 'posted',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
          is_archived: 0,
          category_color: null,
          category_name: null,
          account_name: 'Cash',
        },
      ]

      render(<Dashboard />)

      const panel = document.getElementById('spending-pace-panel')
      expect(panel).not.toBeNull()
      expect(within(panel!).getByRole('alert')).toHaveTextContent('currency.mainRequired')
      expect(within(panel!).queryByRole('table')).not.toBeInTheDocument()
    })

    it('withholds spending charts when the transaction source fails', () => {
      mockTransactionError = 'Transaction read failed'
      mockTransactions = [
        {
          id: 'stale-row',
          description: 'Previously loaded',
          type: 'expense',
          amount: 10_000,
          currency: 'USD',
          date: dayjs().format('YYYY-MM-DD'),
          category_color: null,
          category_name: null,
          account_name: 'Checking',
        },
      ]

      render(<Dashboard />)

      expect(screen.getByText(/analytics.sourceUnavailable/)).toHaveTextContent(
        'Transaction read failed'
      )
      expect(
        screen.queryByRole('table', { name: 'analytics.paceChartLabel' })
      ).not.toBeInTheDocument()
    })

    it('builds graph modes from transaction data', async () => {
      const user = userEvent.setup()
      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      ]
      mockTransactions = [
        {
          id: 'tx-food-current',
          description: 'Groceries',
          type: 'expense',
          amount: 10000,
          currency: 'USD',
          date: dayjs().format('YYYY-MM-DD'),
          category_id: 'cat-food',
          category_color: '#f97316',
          category_name: 'Food',
          account_name: 'Checking',
        },
        {
          id: 'tx-transport-current',
          description: 'Taxi',
          type: 'expense',
          amount: 2000,
          currency: 'USD',
          date: dayjs().format('YYYY-MM-DD'),
          category_id: 'cat-transport',
          category_color: '#38bdf8',
          category_name: 'Transport',
          account_name: 'Checking',
        },
        {
          id: 'tx-food-previous',
          description: 'Previous groceries',
          type: 'expense',
          amount: 6000,
          currency: 'USD',
          date: dayjs().subtract(1, 'month').format('YYYY-MM-DD'),
          category_id: 'cat-food',
          category_color: '#f97316',
          category_name: 'Food',
          account_name: 'Checking',
        },
      ]

      render(<Dashboard />)

      expect(screen.getAllByText('analytics.spendingAndCashFlow').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('analytics.pace')).toBeInTheDocument()
      expect(screen.getByText('analytics.trend')).toBeInTheDocument()
      expect(screen.getByText('analytics.categories')).toBeInTheDocument()
      expect(screen.getByText('analytics.cashflow')).toBeInTheDocument()
      expect(screen.getAllByText('$120.00').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByRole('table', { name: 'analytics.paceChartLabel' })).toBeInTheDocument()

      await user.click(screen.getByText('analytics.categories'))

      expect(
        screen.getByRole('table', { name: 'analytics.categoriesChartLabel' })
      ).toBeInTheDocument()
      expect(screen.getAllByText('Food').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Transport').length).toBeGreaterThanOrEqual(1)

      await user.click(screen.getByText('analytics.trend'))

      expect(screen.getByRole('table', { name: 'analytics.trendChartLabel' })).toBeInTheDocument()
      expect(screen.getAllByText('analytics.income').length).toBeGreaterThan(0)

      await user.click(screen.getByText('analytics.cashflow'))

      const cashFlowTable = screen.getByRole('table', { name: 'overview.cashFlow' })
      expect(cashFlowTable).toBeInTheDocument()
      expect(within(cashFlowTable).getAllByRole('row')).toHaveLength(7)
    })
  })

  describe('net worth current calculation', () => {
    it('recalculates after an in-session account balance refresh', async () => {
      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 195000 },
      ]
      mockNetWorth = 1195000
      mockCalculateCurrent.mockResolvedValue(undefined)

      const { rerender } = render(<Dashboard />)
      expect(await screen.findByText('$11,950.00')).toBeInTheDocument()

      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 205000 },
      ]
      mockNetWorth = 1205000
      rerender(<Dashboard />)

      expect(screen.queryByText('$11,950.00')).not.toBeInTheDocument()
      expect(await screen.findByText('$12,050.00')).toBeInTheDocument()
      expect(mockCalculateCurrent).toHaveBeenCalledTimes(2)
    })

    it('recalculates after an in-session investment refresh', async () => {
      mockInvestments = [{ id: 'inv-1', shares: 1, currentPrice: 100000 }]
      mockNetWorth = 1195000
      mockCalculateCurrent.mockResolvedValue(undefined)

      const { rerender } = render(<Dashboard />)
      expect(await screen.findByText('$11,950.00')).toBeInTheDocument()

      mockInvestments = [{ id: 'inv-1', shares: 2, currentPrice: 100000 }]
      mockNetWorth = 1295000
      rerender(<Dashboard />)

      expect(screen.queryByText('$11,950.00')).not.toBeInTheDocument()
      expect(await screen.findByText('$12,950.00')).toBeInTheDocument()
      expect(mockCalculateCurrent).toHaveBeenCalledTimes(2)
    })

    it('starts each rapid revision and only publishes the latest completion', async () => {
      const pending: Array<{
        resolve: () => void
        promise: Promise<void>
      }> = []
      mockAccounts = [{ id: 'acc-1', balance: 100000 }]
      mockNetWorth = 1195000
      mockCalculateCurrent.mockImplementation(() => {
        let resolve = () => {}
        const promise = new Promise<void>((resolvePromise) => {
          resolve = resolvePromise
        })
        pending.push({ resolve, promise })
        return promise
      })

      const { rerender } = render(<Dashboard />)
      await waitFor(() => expect(mockCalculateCurrent).toHaveBeenCalledTimes(1))

      mockAccounts = [{ id: 'acc-1', balance: 200000 }]
      rerender(<Dashboard />)
      mockAccounts = [{ id: 'acc-1', balance: 300000 }]
      mockNetWorth = 1395000
      rerender(<Dashboard />)

      expect(screen.queryByText('$11,950.00')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('currency.totalUnavailable')
      expect(mockCalculateCurrent).toHaveBeenCalledTimes(3)

      await act(async () => pending[0].resolve())
      await act(async () => pending[1].resolve())
      expect(screen.queryByText('$13,950.00')).not.toBeInTheDocument()

      await act(async () => pending[2].resolve())
      expect(await screen.findByText('$13,950.00')).toBeInTheDocument()
      expect(mockCalculateCurrent).toHaveBeenCalledTimes(3)
    })

    it('does not publish a pending calculation error after unmount', async () => {
      let rejectFirst: ((error: Error) => void) | undefined
      mockAccounts = [{ id: 'acc-1', balance: 100000 }]
      mockCalculateCurrent.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject
          })
      )

      const { rerender, unmount } = render(<Dashboard />)
      await waitFor(() => expect(mockCalculateCurrent).toHaveBeenCalledTimes(1))

      mockAccounts = [{ id: 'acc-1', balance: 200000 }]
      rerender(<Dashboard />)
      unmount()
      await act(async () => rejectFirst?.(new Error('Late net worth failure')))

      expect(mockCalculateCurrent).toHaveBeenCalledTimes(2)
    })

    it('withholds stale data while pending, then keeps a $10k unlinked holding in headline and chart current value', async () => {
      let resolveCalculation: (() => void) | undefined
      mockNetWorth = 195000
      mockNetWorthHistory = [
        { date: '2026-01-01', netWorth: 195000, assets: 195000, liabilities: 0 },
        { date: '2026-02-01', netWorth: 1195000, assets: 1195000, liabilities: 0 },
      ]
      mockCalculateCurrent.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveCalculation = resolve
          })
      )

      const { rerender } = render(<Dashboard />)

      const pendingWarning = screen.getByRole('alert')
      expect(pendingWarning).toHaveTextContent('currency.totalUnavailable')
      expect(pendingWarning.closest('.metric-item')).toHaveTextContent('overview.netWorth')
      await waitFor(() => expect(mockCalculateCurrent).toHaveBeenCalledTimes(1))

      // The complete calculation includes a valid $10,000 holding with no accountId.
      mockNetWorth = 1195000
      rerender(<Dashboard />)
      await act(async () => resolveCalculation?.())

      await waitFor(() => {
        expect(
          within(screen.getByRole('tabpanel', { name: 'overview.views.summary' })).getByText(
            '$11,950.00'
          )
        ).toBeInTheDocument()
      })

      await userEvent.setup().click(screen.getByRole('tab', { name: 'overview.views.history' }))
      expect(
        within(screen.getByRole('tabpanel', { name: 'overview.views.history' })).getAllByText(
          '$11,950.00'
        )
      ).toHaveLength(2)
    })

    it('withholds a stale current amount when calculation fails', async () => {
      mockNetWorth = 500000
      mockCalculateCurrent.mockRejectedValueOnce(new Error('Net worth query failed'))

      render(<Dashboard />)

      const warning = await screen.findByRole('alert')
      expect(warning).toHaveTextContent('Net worth query failed')
      expect(screen.queryByText('$5,000.00')).not.toBeInTheDocument()
    })
  })

  describe('category drill-down and history period', () => {
    it('links category bars to the shared transactions query contract', () => {
      const today = dayjs()
      mockAccounts = [
        { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      ]
      mockTransactions = [
        {
          id: 'tx-food',
          description: 'Groceries',
          type: 'expense',
          amount: 10000,
          currency: 'USD',
          date: today.format('YYYY-MM-DD'),
          status: 'posted',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
          is_archived: 0,
          category_id: 'cat-food',
          category_color: '#f97316',
          category_name: 'Food',
          account_name: 'Checking',
        },
        {
          id: 'tx-none',
          description: 'Unknown',
          type: 'expense',
          amount: 4000,
          currency: 'USD',
          date: today.format('YYYY-MM-DD'),
          status: 'posted',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
          is_archived: 0,
          category_id: null,
          category_color: null,
          category_name: null,
          account_name: 'Checking',
        },
      ]

      render(<Dashboard />)

      const foodLink = screen.getByRole('link', { name: /Food/ })
      expect(foodLink).toHaveAttribute(
        'href',
        expect.stringMatching(
          new RegExp(
            `^/transactions\\?type=expense&category=cat-food&dateFrom=${today.startOf('month').format('YYYY-MM-DD')}&dateTo=${today.format('YYYY-MM-DD')}$`
          )
        )
      )

      const uncategorizedLink = screen.getByRole('link', { name: /Uncategorized/ })
      expect(uncategorizedLink.getAttribute('href')).toMatch(
        /^\/transactions\?type=expense&dateFrom=\d{4}-\d{2}-\d{2}&dateTo=\d{4}-\d{2}-\d{2}$/
      )
      expect(uncategorizedLink.getAttribute('href')).not.toContain('category=')
    })

    it('loads net worth history for the selected period without writing snapshots', async () => {
      const user = userEvent.setup()
      mockNetWorthHistory = [
        { date: '2024-01-01', netWorth: 100000, assets: 100000, liabilities: 0 },
        { date: '2024-06-01', netWorth: 120000, assets: 120000, liabilities: 0 },
      ]

      render(<Dashboard />)

      await waitFor(() => expect(mockCalculateCurrent).toHaveBeenCalled())
      expect(mockLoadHistory).toHaveBeenCalledWith('6m')

      await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
      await user.click(screen.getByRole('button', { name: 'overview.period.3m' }))
      expect(mockLoadHistory).toHaveBeenCalledWith('3m')
    })
  })
})
