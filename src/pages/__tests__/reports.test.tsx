import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import { ReportsPage } from '../reports'

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
const mockFetchBudgets = vi.fn().mockResolvedValue(undefined)
const mockFetchTransactions = vi.fn().mockResolvedValue(undefined)
const mockLoadRates = vi.fn().mockResolvedValue(undefined)

let mockAccounts: Array<Record<string, unknown>> = []
let mockBudgets: Array<Record<string, unknown>> = []
let mockTransactions: Array<Record<string, unknown>> = []
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

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
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
})
