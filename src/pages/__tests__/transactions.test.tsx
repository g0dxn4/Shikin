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

vi.mock('@/components/transactions/statement-import-dialog', () => ({
  StatementImportDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="statement-import-dialog">
        <button onClick={() => onOpenChange(false)}>Close import</button>
      </div>
    ) : null,
}))

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
const mockOpenTransactionDialog = vi.fn()

let mockTransactions: unknown[] = []
let mockIsLoading = false
let mockTransactionFetchError: string | null = null

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openTransactionDialog: mockOpenTransactionDialog,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    transactions: mockTransactions,
    isLoading: mockIsLoading,
    fetchError: mockTransactionFetchError,
    error: null,
    fetch: mockFetch,
    remove: mockRemove,
    isSplit: vi.fn().mockReturnValue(false),
    splitTransactionIds: new Set(),
    getSplits: vi.fn().mockResolvedValue([]),
  }),
}))

describe('Transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransactions = []
    mockIsLoading = false
    mockTransactionFetchError = null
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

  it('opens the statement import dialog from the transactions header', async () => {
    const user = userEvent.setup()

    render(<Transactions />)

    await user.click(screen.getByText('import.button'))

    expect(screen.getByTestId('statement-import-dialog')).toBeInTheDocument()
  })

  it('keeps search open and removes filter and recurring controls', () => {
    render(<Transactions />)

    expect(screen.getByPlaceholderText('actions.search...')).toBeInTheDocument()
    expect(screen.getAllByText('All')).toHaveLength(1)
    expect(screen.queryByText('actions.filter')).not.toBeInTheDocument()
    expect(screen.queryByText('tabs.recurring')).not.toBeInTheDocument()
  })

  it('renders dedicated load error state instead of empty transactions CTA', () => {
    mockTransactionFetchError = 'Transactions unavailable'

    render(<Transactions />)

    expect(screen.getByText('Couldn’t load your transactions')).toBeInTheDocument()
    expect(screen.getByText('Transactions unavailable')).toBeInTheDocument()
    expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
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

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
  })

  it('filters to uncategorized transactions from the filter bar', async () => {
    const user = userEvent.setup()
    mockTransactions = [
      {
        id: 'tx-1',
        description: 'Imported Coffee',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      },
      {
        id: 'tx-2',
        description: 'Categorized Lunch',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: 'cat-1',
        category_color: '#ff0000',
        category_name: 'Food',
        account_name: 'Checking',
      },
    ]

    render(<Transactions />)

    await user.click(screen.getByText('form.categoryNone (1)'))

    expect(screen.getByText('Imported Coffee')).toBeInTheDocument()
    expect(screen.queryByText('Categorized Lunch')).not.toBeInTheDocument()
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

  it('keeps transaction actions visible on mobile while preserving desktop hover reveal', () => {
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

    const hoverDiv = container.querySelector(
      '.opacity-100.md\\:opacity-0.md\\:group-hover\\:opacity-100.md\\:focus-within\\:opacity-100'
    )
    expect(hoverDiv).toBeInTheDocument()
  })

  it('transaction action buttons have aria-labels', () => {
    mockTransactions = [
      {
        id: 'tx-1',
        description: 'Test Transaction',
        type: 'expense',
        amount: 1000,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_color: null,
        category_name: null,
        account_name: 'Checking',
      },
    ]

    render(<Transactions />)

    // Check that edit and delete buttons have aria-labels with the transaction description
    const editButton = screen.getByLabelText('Edit Test Transaction')
    const deleteButton = screen.getByLabelText('Delete Test Transaction')
    expect(editButton).toBeInTheDocument()
    expect(deleteButton).toBeInTheDocument()
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
