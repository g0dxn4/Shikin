import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { ReportsPage } from '../reports'
import type { FrontendNetConsumptionReport } from '@/lib/consumption-service'

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
const mockFetchBudgets = vi.fn().mockResolvedValue(undefined)
const mockFetchTransactions = vi.fn().mockResolvedValue(undefined)
const mockLoadRates = vi.fn().mockResolvedValue(undefined)
const { mockReadNetConsumptionReport } = vi.hoisted(() => ({
  mockReadNetConsumptionReport: vi.fn(),
}))

vi.mock('@/lib/consumption-service', () => ({
  readNetConsumptionReport: mockReadNetConsumptionReport,
}))

let mockAccounts: Array<Record<string, unknown>> = []
let mockBudgets: Array<Record<string, unknown>> = []
let mockTransactions: Array<Record<string, unknown>> = []
let mockPreferredCurrency = 'USD'
let mockRates: Record<string, number> = {}
let mockInvalidRates: Array<{ fromCurrency: string; toCurrency: string; rate: string }> = []
let mockConvertToPreferred: (
  amountCentavos: number,
  currency: string
) =>
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
    }
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

let mockBudgetDisplayComplete = true
let mockBudgetDisplayError: string | null = null

vi.mock('@/components/budgets/use-budget-display', () => ({
  useBudgetDisplay: (stored: Array<{ amount: number; spent: number }>) => ({
    budgets: stored.map((budget) => ({
      ...budget,
      complete: mockBudgetDisplayComplete,
      currency: 'USD',
    })),
    complete: mockBudgetDisplayComplete,
    error: mockBudgetDisplayError,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { currencies?: string; details?: string; message?: string }) =>
      options?.currencies
        ? `${key}: ${options.currencies}`
        : options?.details
          ? `${key}: ${options.details}`
          : options?.message
            ? `${key}: ${options.message}`
            : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: mockAccounts,
    fetch: mockFetchAccounts,
    isLoading: false,
  }),
}))

vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: () => ({
    budgets: mockBudgets,
    fetch: mockFetchBudgets,
    isLoading: false,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    transactions: mockTransactions,
    fetch: mockFetchTransactions,
    isLoading: false,
  }),
}))

const stableConvertToPreferred = (amountCentavos: number, currency: string) =>
  mockConvertToPreferred(amountCentavos, currency)
const stableGetTotalBalanceInPreferred = (accounts: Array<{ balance: number }>) =>
  mockTotalBalanceResult ?? {
    complete: true as const,
    preferredCurrency: mockPreferredCurrency,
    amountCentavos: accounts.reduce((sum, account) => sum + account.balance, 0),
    missingCurrencies: [] as const,
  }

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
    preferredCurrency: mockPreferredCurrency,
    rates: mockRates,
    invalidRates: mockInvalidRates,
    convertToPreferred: stableConvertToPreferred,
    getTotalBalanceInPreferred: stableGetTotalBalanceInPreferred,
    loadRates: mockLoadRates,
  }),
}))

function transaction(
  id: string,
  type: string,
  amount: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    type,
    amount,
    date: dayjs().format('YYYY-MM-DD'),
    status: 'posted',
    reporting_treatment: 'normal',
    transaction_kind: 'standard',
    is_archived: 0,
    category_name: type === 'expense' ? 'Food' : null,
    category_color: '#30d158',
    ...overrides,
  }
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccounts = [{ id: 'account-1', balance: 250_000, currency: 'USD', is_archived: 0 }]
    mockBudgets = [{ id: 'budget-1', amount: 100_000, spent: 25_000 }]
    mockTransactions = [
      transaction('tx-expense', 'expense', 25_000),
      transaction('tx-income', 'income', 500_000),
    ]
    mockTotalBalanceResult = null
    mockPreferredCurrency = 'USD'
    mockRates = {}
    mockInvalidRates = []
    mockBudgetDisplayComplete = true
    mockBudgetDisplayError = null
    mockConvertToPreferred = (amountCentavos) => ({
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos,
      missingCurrencies: [],
    })
    mockReadNetConsumptionReport.mockResolvedValue({
      basis: 'net_consumption',
      complete: false,
      classificationComplete: false,
      coverageComplete: false,
      unresolvedIds: ['allocation-1'],
      uncoveredAccountIds: ['account-1'],
      totalsByCurrency: [
        { currency: 'USD', consumptionCentavos: 7500, earnedIncomeCentavos: 20000 },
      ],
      byCategory: [
        {
          currency: 'USD',
          categoryId: 'food',
          categoryName: 'Food',
          amountCentavos: 7500,
        },
      ],
      period: {
        start: dayjs().startOf('month').format('YYYY-MM-DD'),
        end: dayjs().endOf('month').format('YYYY-MM-DD'),
      },
      currencyScope: 'all',
      message: 'Known subtotals only.',
    })
  })

  it('renders a usable monthly report and its complete cash total', () => {
    render(<ReportsPage />)

    expect(screen.getByText('reports.title')).toBeInTheDocument()
    expect(screen.getByText('reports.categoryBreakdown')).toBeInTheDocument()
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('$2,500.00')).toBeInTheDocument()
    expect(mockLoadRates).toHaveBeenCalled()
  })

  it('keeps gross cash flow as default and loads page-owned native-currency net consumption on demand', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)

    expect(screen.getByRole('button', { name: 'basis.gross' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(mockReadNetConsumptionReport).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'basis.net' }))

    expect(await screen.findAllByText('$75.00')).toHaveLength(2)
    expect(screen.getByText('$200.00')).toBeInTheDocument()
    expect(screen.getByText(/allocation-1/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'actions.reviewUnclassified' })).toHaveAttribute(
      'href',
      expect.stringContaining('reviewReason=unclassified')
    )
    expect(screen.queryByText('$2,500.00')).not.toBeInTheDocument()
  })

  it('surfaces net-basis read failures without replacing the gross report', async () => {
    mockReadNetConsumptionReport.mockRejectedValueOnce(new Error('Synthetic read failure'))
    const user = userEvent.setup()
    render(<ReportsPage />)

    await user.click(screen.getByRole('button', { name: 'basis.net' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'report.loadError: Synthetic read failure'
    )
    await user.click(screen.getByRole('button', { name: 'basis.gross' }))
    expect(screen.getByText('reports.categoryBreakdown')).toBeInTheDocument()
  })

  it('ignores a stale net response after returning to gross basis', async () => {
    let resolveNet!: (value: FrontendNetConsumptionReport) => void
    mockReadNetConsumptionReport.mockImplementationOnce(
      () => new Promise((resolve) => (resolveNet = resolve))
    )
    const user = userEvent.setup()
    render(<ReportsPage />)

    await user.click(screen.getByRole('button', { name: 'basis.net' }))
    await user.click(screen.getByRole('button', { name: 'basis.gross' }))
    resolveNet({
      basis: 'net_consumption',
      complete: true,
      classificationComplete: true,
      coverageComplete: true,
      unresolvedIds: [],
      uncoveredAccountIds: [],
      totalsByCurrency: [],
      byCategory: [],
      period: { start: '2026-09-01', end: '2026-09-30' },
      currencyScope: 'all',
      message: 'Complete',
    })
    await Promise.resolve()
    expect(screen.getByText('reports.categoryBreakdown')).toBeInTheDocument()
    expect(screen.queryByText('report.title')).not.toBeInTheDocument()
  })

  it('converts mixed-currency cash flow before aggregating it', () => {
    mockTransactions = [
      transaction('tx-usd', 'expense', 10_000, { currency: 'USD' }),
      transaction('tx-eur', 'expense', 10_000, { currency: 'EUR' }),
    ]
    mockConvertToPreferred = (amountCentavos, currency) => ({
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos: currency === 'EUR' ? amountCentavos * 2 : amountCentavos,
      missingCurrencies: [],
    })

    render(<ReportsPage />)

    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)
  })

  it('recomputes stable converter results after deferred rates, currency switches, and invalid-rate updates', () => {
    mockTransactions = [transaction('tx-eur', 'expense', 10_000, { currency: 'EUR' })]
    mockConvertToPreferred = (amountCentavos, currency) => {
      if (mockInvalidRates.length > 0) {
        return {
          complete: false,
          preferredCurrency: mockPreferredCurrency,
          missingCurrencies: [],
          reason: 'invalid_currency_data',
        }
      }
      if (currency === mockPreferredCurrency) {
        return {
          complete: true,
          preferredCurrency: mockPreferredCurrency,
          amountCentavos,
          missingCurrencies: [],
        }
      }
      const rate = mockRates[`${currency}:${mockPreferredCurrency}`]
      return rate
        ? {
            complete: true,
            preferredCurrency: mockPreferredCurrency,
            amountCentavos: Math.round(amountCentavos * rate),
            missingCurrencies: [] as const,
          }
        : {
            complete: false,
            preferredCurrency: mockPreferredCurrency,
            missingCurrencies: [currency],
            reason: 'missing_exchange_rates',
          }
    }

    mockTotalBalanceResult = {
      complete: false,
      preferredCurrency: 'USD',
      missingCurrencies: ['EUR'],
      reason: 'missing_exchange_rates',
    }
    const { rerender } = render(<ReportsPage />)
    expect(screen.getAllByText('reports.cashUnavailable: EUR').length).toBeGreaterThan(0)

    mockRates = { 'EUR:USD': 2 }
    mockTotalBalanceResult = {
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos: 50000,
      missingCurrencies: [],
    }
    rerender(<ReportsPage />)
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$500.00')).toBeInTheDocument()

    mockPreferredCurrency = 'EUR'
    mockRates = {}
    mockTotalBalanceResult = {
      complete: true,
      preferredCurrency: 'EUR',
      amountCentavos: 25000,
      missingCurrencies: [],
    }
    rerender(<ReportsPage />)
    expect(screen.getAllByText('€100.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('€250.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('€200.00')).not.toBeInTheDocument()

    mockInvalidRates = [{ fromCurrency: 'USD', toCurrency: 'EUR', rate: '0' }]
    mockTotalBalanceResult = {
      complete: false,
      preferredCurrency: 'EUR',
      missingCurrencies: [],
      reason: 'invalid_currency_data',
      invalidRates: mockInvalidRates,
    }
    rerender(<ReportsPage />)
    expect(screen.getAllByText(/reports\.cashUnavailable/).length).toBeGreaterThan(0)
    expect(screen.getByText(/reports\.cashInvalidData/)).toBeInTheDocument()
    expect(screen.queryByText('€100.00')).not.toBeInTheDocument()
  })

  it('uses migration-019 eligibility for income, expense, count, net flow, and categories', () => {
    mockTransactions = [
      transaction('posted-income', 'income', 100_000),
      transaction('cleared-income', 'income', 50_000, { status: 'cleared' }),
      transaction('posted-food', 'expense', 20_000),
      transaction('cleared-transport', 'expense', 10_000, {
        status: 'cleared',
        category_name: 'Transport',
        category_color: '#38bdf8',
      }),
      transaction('pending', 'expense', 901_000, { status: 'pending' }),
      transaction('staged', 'expense', 911_000, {
        ledger_treatment: 'staged_no_balance_impact',
      }),
      transaction('reconciliation-bridge', 'expense', 902_000, {
        reporting_treatment: 'exclude_from_cashflow',
        transaction_kind: 'reconciliation_bridge',
      }),
      transaction('archived-mirror', 'expense', 903_000, {
        transaction_kind: 'archived_transfer_mirror',
      }),
      transaction('archived-standard', 'expense', 904_000, { is_archived: 1 }),
      transaction('transfer', 'transfer', 905_000),
      transaction('malformed-status', 'expense', 906_000, { status: 'unknown' }),
      transaction('malformed-reporting', 'expense', 907_000, {
        reporting_treatment: 'unknown',
      }),
      transaction('malformed-kind', 'expense', 908_000, { transaction_kind: 'unknown' }),
      transaction('malformed-type', 'refund', 909_000),
      transaction('malformed-archive', 'expense', 910_000, { is_archived: 'yes' }),
    ]

    render(<ReportsPage />)

    expect(screen.getByText('$1,500.00')).toBeInTheDocument()
    expect(screen.getByText('$1,200.00')).toBeInTheDocument()
    expect(screen.getByText('$300.00')).toBeInTheDocument()
    expect(screen.getByText('$200.00')).toBeInTheDocument()
    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('shows accessible invalid-currency account diagnostics without crashing', () => {
    mockTotalBalanceResult = {
      complete: false,
      preferredCurrency: 'USD',
      missingCurrencies: [],
      reason: 'invalid_currency_data',
      invalidCurrencies: [{ accountId: 'account-1', accountName: 'Broken cash', value: 'US D' }],
    }

    render(<ReportsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'reports.cashInvalidData: Broken cash (US D)'
    )
    expect(screen.queryByText('$2,500.00')).not.toBeInTheDocument()
  })

  it('shows an accessible missing-rate warning without a false cash scalar', () => {
    mockAccounts = [
      { id: 'account-usd', balance: 100_000, currency: 'USD', is_archived: 0 },
      { id: 'account-eur', balance: 200_000, currency: 'EUR', is_archived: 0 },
    ]
    mockTotalBalanceResult = {
      complete: false,
      preferredCurrency: 'USD',
      missingCurrencies: ['EUR'],
      reason: 'missing_exchange_rates',
    }

    render(<ReportsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent('reports.cashUnavailable: EUR')
    expect(screen.queryByText('$3,000.00')).not.toBeInTheDocument()
  })

  it('withholds budget health when converted budget totals are incomplete', () => {
    mockBudgetDisplayComplete = false

    render(<ReportsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent('reports.budgetUnavailable')
    expect(screen.queryByText('25%')).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
  })

  it('shows a budget-health read error instead of stored raw sums', () => {
    mockBudgetDisplayComplete = false
    mockBudgetDisplayError = 'Read failed'

    render(<ReportsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent('reports.budgetReadError: Read failed')
    expect(screen.queryByText('25%')).not.toBeInTheDocument()
  })
})
