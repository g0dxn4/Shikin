import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import dayjs from 'dayjs'
import { ReportsPage } from '../reports'
import type { FrontendNetConsumptionReport } from '@/lib/consumption-service'

function renderReports() {
  return render(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>
  )
}

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
const mockFetchBudgets = vi.fn().mockResolvedValue(undefined)
const mockFetchTransactions = vi.fn().mockResolvedValue(undefined)
const mockLoadRates = vi.fn().mockResolvedValue(undefined)
const { mockReadNetConsumptionReport } = vi.hoisted(() => ({
  mockReadNetConsumptionReport: vi.fn(),
}))

vi.mock('@/lib/consumption-service', () => ({
  readNetConsumptionReport: mockReadNetConsumptionReport,
  isValidNetConsumptionPeriod: (start: string, end: string) => {
    const realDate = (value: string) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false
      const parsed = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    }
    return realDate(start) && realDate(end) && start <= end
  },
}))

let mockAccounts: Array<Record<string, unknown>> = []
let mockArchivedAccounts: Array<Record<string, unknown>> = []
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
    archivedAccounts: mockArchivedAccounts,
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
    mockAccounts = [
      {
        id: 'account-1',
        name: 'Daily Checking',
        balance: 250_000,
        currency: 'USD',
        is_archived: 0,
      },
    ]
    mockArchivedAccounts = []
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
    renderReports()

    expect(screen.getByText('reports.title')).toBeInTheDocument()
    expect(screen.getByText('reports.categoryBreakdown')).toBeInTheDocument()
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('$2,500.00')).toBeInTheDocument()
    expect(mockLoadRates).toHaveBeenCalled()
  })

  it('keeps gross cash flow as default and loads page-owned native-currency net consumption on demand', async () => {
    const user = userEvent.setup()
    renderReports()

    expect(screen.getByRole('button', { name: 'basis.gross' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(mockReadNetConsumptionReport).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'basis.net' }))

    expect(await screen.findAllByText('$75.00')).toHaveLength(2)
    expect(screen.getByText('$200.00')).toBeInTheDocument()
    expect(screen.queryByText(/allocation-1/)).not.toBeInTheDocument()
    expect(screen.getAllByText('report.incompleteStatus · 1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('link', { name: 'actions.reviewUnclassified' })).toHaveAttribute(
      'href',
      expect.stringContaining('reviewReason=unclassified')
    )
    expect(
      screen.getByRole('link', { name: 'actions.reviewAccount · Daily Checking' })
    ).toHaveAttribute('href', '/accounts?account=account-1')
    expect(mockReadNetConsumptionReport).toHaveBeenCalledWith(
      dayjs().startOf('month').format('YYYY-MM-DD'),
      dayjs().endOf('month').format('YYYY-MM-DD')
    )
    expect(screen.queryByText('$2,500.00')).not.toBeInTheDocument()
  })

  it('surfaces net-basis read failures without replacing the gross report', async () => {
    mockReadNetConsumptionReport.mockRejectedValueOnce(new Error('Synthetic read failure'))
    const user = userEvent.setup()
    renderReports()

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
    renderReports()

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

    renderReports()

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
    const { rerender } = renderReports()
    expect(screen.getAllByText('reports.cashUnavailable: EUR').length).toBeGreaterThan(0)

    mockRates = { 'EUR:USD': 2 }
    mockTotalBalanceResult = {
      complete: true,
      preferredCurrency: 'USD',
      amountCentavos: 50000,
      missingCurrencies: [],
    }
    rerender(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    )
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
    rerender(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    )
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
    rerender(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    )
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

    renderReports()

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

    renderReports()

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

    renderReports()

    expect(screen.getByRole('alert')).toHaveTextContent('reports.cashUnavailable: EUR')
    expect(screen.queryByText('$3,000.00')).not.toBeInTheDocument()
  })

  it('withholds budget health when converted budget totals are incomplete', () => {
    mockBudgetDisplayComplete = false

    renderReports()

    expect(screen.getByRole('alert')).toHaveTextContent('reports.budgetUnavailable')
    expect(screen.queryByText('25%')).not.toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
  })

  it('shows a budget-health read error instead of stored raw sums', () => {
    mockBudgetDisplayComplete = false
    mockBudgetDisplayError = 'Read failed'

    renderReports()

    expect(screen.getByRole('alert')).toHaveTextContent('reports.budgetReadError: Read failed')
    expect(screen.queryByText('25%')).not.toBeInTheDocument()
  })

  it('loads a historical native-currency net period and keeps it across basis switches', async () => {
    const previousStart = dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
    const previousEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')
    mockReadNetConsumptionReport.mockImplementation(async (start: string, end: string) => ({
      basis: 'net_consumption',
      complete: true,
      classificationComplete: true,
      coverageComplete: true,
      unresolvedIds: [],
      uncoveredAccountIds: [],
      totalsByCurrency: [
        { currency: 'MXN', consumptionCentavos: 12345, earnedIncomeCentavos: 20000 },
      ],
      byCategory: [
        {
          currency: 'MXN',
          categoryId: 'food',
          categoryName: 'Food',
          amountCentavos: 12345,
        },
      ],
      period: { start, end },
      currencyScope: 'all',
      message: 'Complete',
    }))
    const user = userEvent.setup()
    renderReports()

    await user.click(screen.getByRole('button', { name: 'basis.net' }))
    await user.click(screen.getByRole('button', { name: 'period.previousMonth' }))

    expect(await screen.findByText('MXN')).toBeInTheDocument()
    expect(mockReadNetConsumptionReport).toHaveBeenCalledWith(previousStart, previousEnd)
    expect(screen.getByRole('button', { name: 'period.previousMonth' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(screen.getByRole('button', { name: 'basis.gross' }))
    expect(screen.getByText('reports.categoryBreakdown')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'basis.net' }))
    expect(await screen.findByText('MXN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'period.previousMonth' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(mockReadNetConsumptionReport).toHaveBeenLastCalledWith(previousStart, previousEnd)
  })

  it('rejects an inverted net period before querying', async () => {
    const user = userEvent.setup()
    renderReports()

    await user.click(screen.getByRole('button', { name: 'basis.net' }))
    await screen.findByLabelText('period.start')
    mockReadNetConsumptionReport.mockClear()
    fireEvent.change(screen.getByLabelText('period.end'), { target: { value: '2020-01-01' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('period.invalid')
    expect(mockReadNetConsumptionReport).not.toHaveBeenCalled()
    expect(screen.queryByText('report.title')).not.toBeInTheDocument()
  })

  it('clears the previous net report, shows retry, and ignores an obsolete response', async () => {
    const currentStart = dayjs().startOf('month').format('YYYY-MM-DD')
    const currentEnd = dayjs().endOf('month').format('YYYY-MM-DD')
    const previousStart = dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
    const previousEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')
    let resolveCurrent!: (value: FrontendNetConsumptionReport) => void
    mockReadNetConsumptionReport.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCurrent = resolve))
    )
    mockReadNetConsumptionReport.mockRejectedValueOnce(new Error('Range read failure'))
    const user = userEvent.setup()
    renderReports()

    await user.click(screen.getByRole('button', { name: 'basis.net' }))
    await user.click(screen.getByRole('button', { name: 'period.previousMonth' }))
    resolveCurrent({
      basis: 'net_consumption',
      complete: true,
      classificationComplete: true,
      coverageComplete: true,
      unresolvedIds: [],
      uncoveredAccountIds: [],
      totalsByCurrency: [
        { currency: 'USD', consumptionCentavos: 7500, earnedIncomeCentavos: 20000 },
      ],
      byCategory: [],
      period: { start: currentStart, end: currentEnd },
      currencyScope: 'all',
      message: 'Complete',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'report.loadError: Range read failure'
    )
    expect(screen.getByRole('button', { name: 'actions.retry' })).toHaveClass('min-h-11')
    expect(screen.queryByText('$75.00')).not.toBeInTheDocument()
    expect(screen.queryByText(`${currentStart} – ${currentEnd}`)).not.toBeInTheDocument()

    mockReadNetConsumptionReport.mockResolvedValueOnce({
      basis: 'net_consumption',
      complete: false,
      classificationComplete: false,
      coverageComplete: true,
      unresolvedIds: ['allocation-1'],
      uncoveredAccountIds: ['01HUNKNOWNACCOUNTIDENTLONGULID'],
      totalsByCurrency: [{ currency: 'EUR', consumptionCentavos: 4400, earnedIncomeCentavos: 0 }],
      byCategory: [],
      period: { start: previousStart, end: previousEnd },
      currencyScope: 'all',
      message: 'Known subtotals only.',
    })
    await user.click(screen.getByRole('button', { name: 'actions.retry' }))

    expect(await screen.findByText('€44.00')).toBeInTheDocument()
    expect(screen.queryByText(/allocation-1/)).not.toBeInTheDocument()
    expect(screen.getByText('report.incompleteStatus · 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'actions.reviewUnclassified' })).toHaveAttribute(
      'href',
      expect.stringContaining(`dateFrom=${previousStart}&dateTo=${previousEnd}`)
    )
    const unknownAccountLink = screen.getByRole('link', {
      name: /actions.reviewAccount · 01HUNKNOWNACCOUNTIDENTLONGULID/,
    })
    expect(unknownAccountLink).toHaveClass('max-w-full')
    expect(unknownAccountLink.querySelector('.break-all')).not.toBeNull()
    expect(mockReadNetConsumptionReport).toHaveBeenLastCalledWith(previousStart, previousEnd)
  })
})
