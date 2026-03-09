import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { Dashboard } from '../dashboard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const mockFetchAccounts = vi.fn()
const mockFetchTransactions = vi.fn()
const mockSetAIPanelOpen = vi.fn()
const mockOpenAccountDialog = vi.fn()
const mockOpenTransactionDialog = vi.fn()

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    setAIPanelOpen: mockSetAIPanelOpen,
    openAccountDialog: mockOpenAccountDialog,
    openTransactionDialog: mockOpenTransactionDialog,
  }),
}))

let mockAccounts: unknown[] = []
let mockTransactions: unknown[] = []

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: mockAccounts,
    fetch: mockFetchAccounts,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    transactions: mockTransactions,
    fetch: mockFetchTransactions,
  }),
}))

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccounts = []
    mockTransactions = []
  })

  it('calls fetchAccounts and fetchTransactions on mount', () => {
    render(<Dashboard />)

    expect(mockFetchAccounts).toHaveBeenCalled()
    expect(mockFetchTransactions).toHaveBeenCalled()
  })

  describe('empty state', () => {
    it('renders CTA when no accounts', () => {
      render(<Dashboard />)

      expect(screen.getByText('empty.title')).toBeInTheDocument()
      expect(screen.getByText('empty.description')).toBeInTheDocument()
    })

    it('openAccountDialog called on add account CTA', async () => {
      const user = userEvent.setup()
      render(<Dashboard />)

      await user.click(screen.getByText('empty.addAccount'))

      expect(mockOpenAccountDialog).toHaveBeenCalled()
    })

    it('setAIPanelOpen called on "Ask Val" CTA', async () => {
      const user = userEvent.setup()
      render(<Dashboard />)

      await user.click(screen.getByText('empty.askAI'))

      expect(mockSetAIPanelOpen).toHaveBeenCalledWith(true)
    })
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

    it('shows formatted total balance in hero card', () => {
      render(<Dashboard />)

      // Total = 150000 + 50000 - 10000 + 5000 = 195000 cents = $1,950.00
      expect(screen.getByText('$1,950.00')).toBeInTheDocument()
    })

    it('shows up to 3 account cards with name and balance', () => {
      render(<Dashboard />)

      expect(screen.getByText('Checking')).toBeInTheDocument()
      expect(screen.getByText('Savings')).toBeInTheDocument()
      expect(screen.getByText('Credit')).toBeInTheDocument()
      // 4th account is not shown (slice to 3)
      expect(screen.queryByText('Extra')).not.toBeInTheDocument()
    })

    it('"View All" link points to /accounts', () => {
      render(<Dashboard />)

      const viewAllLinks = screen.getAllByText('viewAll')
      const accountsLink = viewAllLinks[0].closest('a')
      expect(accountsLink).toHaveAttribute('href', '/accounts')
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
      const successSpan = Array.from(amountSpans).find((el) => el.classList.contains('text-success'))
      const destructiveSpan = Array.from(amountSpans).find((el) => el.classList.contains('text-destructive'))

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

      // Monthly income: $5,000.00
      expect(screen.getByText('$5,000.00')).toBeInTheDocument()
      // Monthly expenses: $2,000.00
      expect(screen.getByText('$2,000.00')).toBeInTheDocument()
      // Savings rate: (5000-2000)/5000*100 = 60%
      expect(screen.getByText('60%')).toBeInTheDocument()
    })
  })
})
