import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { Dashboard } from '../dashboard'

// ResizeObserver polyfill for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { currencies?: string; details?: string }) =>
      options?.currencies
        ? `${key}: ${options.currencies}`
        : options?.details
          ? `${key}: ${options.details}`
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
let mockNetWorthLoading = false
let mockPreferredCurrency = 'USD'
let mockRates: Record<string, number> = {}
let mockInvalidRates: Array<{ fromCurrency: string; toCurrency: string; rate: string }> = []
const mockConvertToPreferred = vi.fn((amount: number, currency: string) => {
  const normalized = currency.toUpperCase()
  if (normalized === mockPreferredCurrency) {
    return {
      complete: true as const,
      preferredCurrency: mockPreferredCurrency,
      amountCentavos: amount,
      missingCurrencies: [] as const,
    }
  }
  const rate = mockRates[`${normalized}:${mockPreferredCurrency}`]
  return rate
    ? {
        complete: true as const,
        preferredCurrency: mockPreferredCurrency,
        amountCentavos: Math.round(amount * rate),
        missingCurrencies: [] as const,
      }
    : {
        complete: false as const,
        preferredCurrency: mockPreferredCurrency,
        missingCurrencies: [normalized],
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
    goals: [],
    fetchError: mockGoalError,
    fetch: mockFetchGoals,
  }),
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
    preferredCurrency: mockPreferredCurrency,
    error: mockCurrencyError,
    rates: mockRates,
    invalidRates: mockInvalidRates,
    loadRates: mockLoadRates,
    convertToPreferred: mockConvertToPreferred,
  }),
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
    isLoading: mockNetWorthLoading,
    loadHistory: mockLoadHistory,
    calculateCurrent: mockCalculateCurrent,
    totalsComplete: mockNetWorthComplete,
    netWorth: mockNetWorth,
    preferredCurrency: mockNetWorthCurrency,
    totalAssets: 0,
    totalLiabilities: 0,
    missingCurrencies: mockNetWorthMissingCurrencies,
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
    mockNetWorthLoading = false
    mockPreferredCurrency = 'USD'
    mockRates = {}
    mockInvalidRates = []
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

    expect(screen.getByText(/analytics.categoriesUnavailable/)).toBeInTheDocument()
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
    expect(screen.queryByLabelText('overview.chartTitle')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    expect(screen.getByLabelText('overview.chartTitle')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    expect(screen.getByLabelText('overview.comparison.firstAccount')).toBeInTheDocument()
    expect(screen.getByLabelText('overview.comparison.secondAccount')).toBeInTheDocument()
    await waitFor(() => expect(mockDashboardQuery).toHaveBeenCalledTimes(2))
  })

  it('removes only the Overview toolbar add action', () => {
    const { container } = render(<Dashboard />)

    expect(container.querySelector('.page-toolbar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'addTransaction' })).toBeInTheDocument()
  })

  describe('without accounts', () => {
    it('keeps dashboard intelligence visible', () => {
      render(<Dashboard />)

      expect(screen.getAllByText('analytics.spendingPace').length).toBeGreaterThanOrEqual(1)
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

    expect(screen.getByText('Some dashboard data couldn’t be loaded')).toBeInTheDocument()
    expect(screen.getByText('Accounts: Accounts unavailable')).toBeInTheDocument()
    expect(screen.getByText('Transactions: Transactions unavailable')).toBeInTheDocument()
  })

  it('keeps goal and exchange rate partial failures visible', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 1000 },
    ]
    mockGoalError = 'Goals unavailable'
    mockCurrencyError = 'Rates unavailable'

    render(<Dashboard />)

    expect(screen.getByText('Some dashboard data couldn’t be loaded')).toBeInTheDocument()
    expect(screen.getByText('Goals: Goals unavailable')).toBeInTheDocument()
    expect(screen.getByText('Exchange rates: Rates unavailable')).toBeInTheDocument()
  })

  it('shows account load failures in the dashboard error banner', () => {
    mockAccountError = 'Accounts unavailable'

    render(<Dashboard />)

    expect(screen.getByText('Some dashboard data couldn’t be loaded')).toBeInTheDocument()
    expect(screen.getByText('Accounts: Accounts unavailable')).toBeInTheDocument()
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

    it('withholds a previously complete current value when invalid rates arrive', async () => {
      mockNetWorth = 195000
      mockCalculateCurrent.mockResolvedValue(undefined)
      const { rerender } = render(<Dashboard />)
      expect(await screen.findByText('$1,950.00')).toBeInTheDocument()

      mockInvalidRates = [{ fromCurrency: 'EUR', toCurrency: 'USD', rate: '0' }]
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

    it('does not render account preview cards', () => {
      render(<Dashboard />)

      expect(screen.queryByText('Checking')).not.toBeInTheDocument()
      expect(screen.queryByText('Savings')).not.toBeInTheDocument()
      expect(screen.queryByText('Credit')).not.toBeInTheDocument()
      expect(screen.queryByText('Extra')).not.toBeInTheDocument()
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
      expect(screen.getAllByText(/currency\.derivedUnavailable: EUR/).length).toBeGreaterThan(0)

      mockRates = { 'EUR:USD': 2 }
      rerender(<Dashboard />)
      expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)

      mockPreferredCurrency = 'EUR'
      mockRates = { 'USD:EUR': 0.5 }
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
        screen.getByText('Food', { selector: 'span.truncate.font-semibold' }).parentElement
          ?.parentElement
      ).toHaveTextContent('Food$200.00')
      expect(
        screen.getByText('Transport', { selector: 'span.truncate.font-semibold' }).parentElement
          ?.parentElement
      ).toHaveTextContent('Transport$100.00')
    })
  })

  describe('spending intelligence', () => {
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

      expect(screen.getAllByText('analytics.spendingPace').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('analytics.pace')).toBeInTheDocument()
      expect(screen.getByText('analytics.trend')).toBeInTheDocument()
      expect(screen.getByText('analytics.categories')).toBeInTheDocument()
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
        expect(screen.getByText('$11,950.00')).toBeInTheDocument()
      })

      await userEvent.setup().click(screen.getByRole('tab', { name: 'overview.views.history' }))
      expect(screen.getAllByText('$11,950.00')).toHaveLength(2)
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
