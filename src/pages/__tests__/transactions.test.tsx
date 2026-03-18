import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { Transactions } from '../transactions'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

const mockFetch = vi.fn()
const mockRemove = vi.fn()
const mockOpenTransactionDialog = vi.fn()

let mockTransactions: unknown[] = []
let mockIsLoading = false

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openTransactionDialog: mockOpenTransactionDialog,
    recurringDialogOpen: false,
    editingRecurringId: null,
    openRecurringDialog: vi.fn(),
    closeRecurringDialog: vi.fn(),
  }),
}))

vi.mock('@/stores/recurring-store', () => ({
  useRecurringStore: () => ({
    rules: [],
    isLoading: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    toggleActive: vi.fn(),
    getById: vi.fn(),
    materializeTransactions: vi.fn(),
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    fetch: vi.fn(),
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: [],
    fetch: vi.fn(),
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    transactions: mockTransactions,
    isLoading: mockIsLoading,
    fetch: mockFetch,
    remove: mockRemove,
  }),
}))

describe('Transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransactions = []
    mockIsLoading = false
  })

  it('calls fetch on mount', () => {
    render(<Transactions />)

    expect(mockFetch).toHaveBeenCalled()
  })

  it('renders loading state when isLoading', () => {
    mockIsLoading = true

    const { container } = render(<Transactions />)

    // Loading state renders skeleton, not the transactions list
    expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
    expect(container.querySelector('.skeleton')).toBeInTheDocument()
  })

  it('renders empty state with add button', () => {
    render(<Transactions />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
    expect(screen.getByText('empty.description')).toBeInTheDocument()
  })

  it('groups transactions by date', () => {
    const today = dayjs().format('YYYY-MM-DD')
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')

    mockTransactions = [
      {
        id: 'tx-1',
        description: 'Coffee',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        date: today,
        category_color: null,
        category_name: 'Food',
        account_name: 'Checking',
      },
      {
        id: 'tx-2',
        description: 'Lunch',
        type: 'expense',
        amount: 1500,
        currency: 'USD',
        date: yesterday,
        category_color: '#ff0000',
        category_name: 'Food',
        account_name: 'Checking',
      },
    ]

    render(<Transactions />)

    expect(screen.getByText('dateHeaders.today')).toBeInTheDocument()
    expect(screen.getByText('dateHeaders.yesterday')).toBeInTheDocument()
  })

  it('renders transaction rows with description and colored amount', () => {
    mockTransactions = [
      {
        id: 'tx-1',
        description: 'Groceries',
        type: 'expense',
        amount: 5000,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_color: '#ff0000',
        category_name: 'Food',
        account_name: 'Checking',
      },
    ]

    render(<Transactions />)

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Food')).toBeInTheDocument()
  })

  it('hover-reveal edit/delete buttons have opacity-0 class', () => {
    mockTransactions = [
      {
        id: 'tx-1',
        description: 'Test',
        type: 'expense',
        amount: 1000,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      },
    ]

    const { container } = render(<Transactions />)

    const hoverDiv = container.querySelector('.opacity-0.group-hover\\:opacity-100')
    expect(hoverDiv).toBeInTheDocument()
  })

  it('edit button opens transaction dialog with tx id', async () => {
    const user = userEvent.setup()
    mockTransactions = [
      {
        id: 'tx-42',
        description: 'Editable',
        type: 'expense',
        amount: 1000,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      },
    ]

    const { container } = render(<Transactions />)

    // Find the edit button (first icon button in the hover row)
    const buttons = container.querySelectorAll('.group button')
    // Edit button is the one with Pencil icon
    await user.click(buttons[0])

    expect(mockOpenTransactionDialog).toHaveBeenCalledWith('tx-42')
  })

  it('delete flow: click delete → confirm → remove → toast', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockRemove.mockResolvedValueOnce(undefined)

    mockTransactions = [
      {
        id: 'tx-del',
        description: 'Deletable',
        type: 'expense',
        amount: 1000,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      },
    ]

    const { container } = render(<Transactions />)

    // Click delete button (second icon button)
    const buttons = container.querySelectorAll('.group button')
    await user.click(buttons[1])

    // Confirm dialog should appear
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    // Click confirm
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('tx-del')
      expect(toast.success).toHaveBeenCalledWith('toast.deleted')
    })
  })
})
