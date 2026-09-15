import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

let mockNetWorthHistory: Array<{
  date: string
  netWorth: number
  assets: number
  liabilities: number
}> = []

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openTransactionDialog: mockOpenTransactionDialog,
  }),
}))

let mockAccounts: unknown[] = []
let mockTransactions: unknown[] = []
let mockAccountError: string | null = null
let mockTransactionError: string | null = null
let mockGoalError: string | null = null
let mockCurrencyError: string | null = null
let mockSplitsError: string | null = null
let mockTotalBalanceResult:
  | {
      complete: true
      preferredCurrency: string
      amountCentavos: number
      missingCurrencies: readonly []
    }
  | {
      complete: false
      preferredCurrency: string
      missingCurrencies: string[]
      reason: 'missing_exchange_rates' | 'invalid_currency_data'
      invalidCurrencies?: Array<{
        accountId: string | null
        accountName: string | null
        value: string
      }>
      invalidRates?: Array<{ fromCurrency: string; toCurrency: string; rate: string }>
    }
  | null = null

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: mockAccounts,
    isLoading: false,
    fetchError: mockAccountError,
    error: mockAccountError,
    fetch: mockFetchAccounts,
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
    preferredCurrency: 'USD',
    error: mockCurrencyError,
    rates: {},
    convertToPreferred: (amountCentavos: number) => ({
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos,
      missingCurrencies: [],
    }),
    getTotalBalanceInPreferred: (accounts: Array<{ balance: number }>) =>
      mockTotalBalanceResult ?? {
        complete: true,
        preferredCurrency: 'USD',
        amountCentavos: accounts.reduce((sum, account) => sum + account.balance, 0),
        missingCurrencies: [],
      },
    loadRates: mockLoadRates,
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
    isLoading: false,
    loadHistory: mockLoadHistory,
    calculateCurrent: mockCalculateCurrent,
    totalsComplete: true,
    netWorth: 0,
    totalAssets: 0,
    totalLiabilities: 0,
    missingCurrencies: [],
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
    mockTransactions = []
    mockAccountError = null
    mockTransactionError = null
    mockGoalError = null
    mockCurrencyError = null
    mockSplitsError = null
    mockTotalBalanceResult = null
    mockNetWorthHistory = []
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

    it('shows the complete preferred-currency total in the hero card', () => {
      render(<Dashboard />)

      // Total = 150000 + 50000 - 10000 + 5000 = 195000 cents = $1,950.00
      expect(screen.getByText('$1,950.00')).toBeInTheDocument()
      expect(screen.queryByRole('alert', { name: /currency\.totalUnavailable/ })).toBeNull()
    })

    it('renders accessible invalid-currency diagnostics without a scalar total', () => {
      mockTotalBalanceResult = {
        complete: false,
        preferredCurrency: 'USD',
        missingCurrencies: [],
        reason: 'invalid_currency_data',
        invalidCurrencies: [{ accountId: 'acc-broken', accountName: 'Broken savings', value: '' }],
        invalidRates: [{ fromCurrency: '', toCurrency: 'USD', rate: '1' }],
      }

      render(<Dashboard />)

      const warning = screen.getByRole('alert')
      expect(warning).toHaveTextContent('currency.totalUnavailable')
      expect(warning).toHaveTextContent(
        'currency.invalidData: Broken savings (currency.blankValue), currency.invalidRate'
      )
      expect(screen.queryByText('$1,950.00')).not.toBeInTheDocument()
    })

    it('shows an accessible missing-rate warning without a false scalar total', () => {
      mockAccounts = [
        { id: 'acc-usd', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
        { id: 'acc-eur', name: 'Euro', type: 'savings', currency: 'EUR', balance: 200000 },
      ]
      mockTotalBalanceResult = {
        complete: false,
        preferredCurrency: 'USD',
        missingCurrencies: ['EUR'],
        reason: 'missing_exchange_rates',
      }

      render(<Dashboard />)

      const warning = screen.getByRole('alert')
      expect(warning).toHaveTextContent('currency.totalUnavailable')
      expect(warning).toHaveTextContent('currency.missingRates: EUR')
      expect(screen.queryByText('$3,000.00')).not.toBeInTheDocument()
    })

    it('does not render account preview cards', () => {
      render(<Dashboard />)

      expect(screen.queryByText('Checking')).not.toBeInTheDocument()
      expect(screen.queryByText('Savings')).not.toBeInTheDocument()
      expect(screen.queryByText('Credit')).not.toBeInTheDocument()
      expect(screen.queryByText('Extra')).not.toBeInTheDocument()
    })

    it('renders zero and negative complete net worth without inventing a mixed total', () => {
      mockTotalBalanceResult = {
        complete: true,
        preferredCurrency: 'USD',
        amountCentavos: 0,
        missingCurrencies: [],
      }
      const { unmount } = render(<Dashboard />)
      expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(1)
      unmount()

      mockTotalBalanceResult = {
        complete: true,
        preferredCurrency: 'USD',
        amountCentavos: -1250,
        missingCurrencies: [],
      }
      render(<Dashboard />)
      expect(screen.getByText('-$12.50')).toBeInTheDocument()
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

      expect(mockCalculateCurrent).toHaveBeenCalled()
      expect(mockLoadHistory).toHaveBeenCalledWith('6m')

      await user.click(screen.getByRole('button', { name: 'overview.period.3m' }))
      expect(mockLoadHistory).toHaveBeenCalledWith('3m')
    })
  })
})
