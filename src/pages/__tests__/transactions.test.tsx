import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const mockUpdateReviewFields = vi.fn().mockResolvedValue(undefined)
const mockOpenTransactionDialog = vi.fn()
const mockOpenRecurringDialog = vi.fn()
const mockAccountFetch = vi.fn().mockResolvedValue(undefined)
const mockCategoryFetch = vi.fn().mockResolvedValue(undefined)

let mockTransactions: unknown[] = []
let mockAccounts: unknown[] = []
let mockArchivedAccounts: unknown[] = []
let mockCategories: unknown[] = []
let mockIsLoading = false
let mockTransactionFetchError: string | null = null
let mockIsSplit = vi.fn().mockReturnValue(false)
let mockSplitCategoryIdsByTransaction = new Map<string, Set<string>>()

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openTransactionDialog: mockOpenTransactionDialog,
    openRecurringDialog: mockOpenRecurringDialog,
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: mockAccounts,
    archivedAccounts: mockArchivedAccounts,
    fetch: mockAccountFetch,
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: mockCategories,
    fetch: mockCategoryFetch,
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
    updateReviewFields: mockUpdateReviewFields,
    isSplit: mockIsSplit,
    splitTransactionIds: new Set(mockSplitCategoryIdsByTransaction.keys()),
    splitCategoryIdsByTransaction: mockSplitCategoryIdsByTransaction,
    getSplits: vi.fn().mockResolvedValue([]),
  }),
}))

describe('Transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockFetch.mockResolvedValue(undefined)
    mockRemove.mockReset()
    mockUpdateReviewFields.mockResolvedValue(undefined)
    mockTransactions = []
    mockAccounts = []
    mockArchivedAccounts = []
    mockCategories = []
    mockIsLoading = false
    mockTransactionFetchError = null
    mockIsSplit = vi.fn().mockReturnValue(false)
    mockSplitCategoryIdsByTransaction = new Map()
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

  it('renders practical shared filters and keeps recurring actions available', () => {
    render(<Transactions />)

    expect(screen.getByPlaceholderText('actions.search...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'types.all' })).toBeInTheDocument()
    expect(screen.getByLabelText('filters.dateRange')).toBeInTheDocument()
    expect(screen.getByLabelText('filters.account')).toBeInTheDocument()
    expect(screen.getByLabelText('filters.category')).toBeInTheDocument()
    expect(screen.getByLabelText('filters.status')).toBeInTheDocument()
    expect(screen.getByLabelText('filters.currency')).toBeInTheDocument()
    expect(screen.getByText('recurring.addRule')).toBeInTheDocument()
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

  it('filters the review queue to transactions that need a category', async () => {
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
        status: 'posted',
      },
      {
        id: 'tx-3',
        description: 'Pending transfer',
        type: 'transfer',
        amount: 300,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        category_color: null,
        category_name: null,
        account_name: 'Checking',
        status: 'pending',
      },
    ]

    render(<Transactions />)

    await user.click(screen.getByRole('tab', { name: 'views.review' }))
    await user.click(screen.getByRole('button', { name: 'review.filters.needs-category (1)' }))

    expect(screen.getByText('Imported Coffee')).toBeInTheDocument()
    expect(screen.queryByText('Pending transfer')).not.toBeInTheDocument()
  })

  it('persists accessible view selection and keeps shared filters across views', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      {
        id: 'acc-usd',
        name: 'Checking',
        currency: 'USD',
        is_archived: 0,
        account_mode: 'transactional',
      },
      {
        id: 'acc-eur',
        name: 'Euro account',
        currency: 'EUR',
        is_archived: 0,
        account_mode: 'transactional',
      },
    ]
    mockCategories = [{ id: 'cat-food', name: 'Food', type: 'expense' }]
    mockTransactions = [
      {
        id: 'tx-usd',
        account_id: 'acc-usd',
        description: 'USD groceries',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: 'cat-food',
        category_name: 'Food',
        category_color: null,
        account_name: 'Checking',
      },
      {
        id: 'tx-eur',
        account_id: 'acc-eur',
        description: 'EUR groceries',
        type: 'expense',
        amount: 500,
        currency: 'EUR',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: 'cat-food',
        category_name: 'Food',
        category_color: null,
        account_name: 'Euro account',
      },
    ]

    render(<Transactions />)

    await user.selectOptions(screen.getByLabelText('filters.account'), 'acc-usd')
    await user.selectOptions(screen.getByLabelText('filters.currency'), 'USD')
    expect(screen.getByText('USD groceries')).toBeInTheDocument()
    expect(screen.queryByText('EUR groceries')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))
    expect(screen.getByRole('tab', { name: 'views.ledger' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByText('USD groceries')).toHaveLength(2)
    expect(screen.queryByText('EUR groceries')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('shikin.transactions.view')).toBe('ledger')

    await user.click(screen.getByRole('button', { name: 'filters.clear' }))
    expect(screen.getAllByText('EUR groceries')).toHaveLength(2)
  })

  it('uses split categories for filtering without re-queuing or generically editing a split parent', async () => {
    const user = userEvent.setup()
    mockCategories = [
      { id: 'cat-parent', name: 'Stale parent category', type: 'expense' },
      { id: 'cat-food', name: 'Food', type: 'expense' },
    ]
    mockTransactions = [
      {
        id: 'tx-split',
        account_id: 'acc-usd',
        description: 'Split groceries',
        type: 'expense',
        amount: 5000,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: 'cat-parent',
        category_name: 'Stale parent category',
        account_name: 'Checking',
        status: 'posted',
      },
    ]
    mockIsSplit = vi.fn((id: string) => id === 'tx-split')
    mockSplitCategoryIdsByTransaction = new Map([['tx-split', new Set(['cat-food'])]])

    render(<Transactions />)

    await user.selectOptions(screen.getByLabelText('filters.category'), 'cat-parent')
    expect(screen.queryByText('Split groceries')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('filters.category'), 'cat-food')
    expect(screen.getByText('Split groceries')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit Split groceries')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))
    expect(screen.queryByLabelText('Edit Split groceries')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'views.review' }))
    expect(screen.getByText('review.empty')).toBeInTheDocument()
  })

  it('shows both transfer endpoints and keeps destination-account ledger activity visible', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      {
        id: 'acc-source',
        name: 'Checking',
        currency: 'USD',
        is_archived: 0,
        account_mode: 'transactional',
      },
      {
        id: 'acc-destination',
        name: 'Savings',
        currency: 'USD',
        is_archived: 0,
        account_mode: 'transactional',
      },
    ]
    mockTransactions = [
      {
        id: 'tx-transfer',
        account_id: 'acc-source',
        transfer_to_account_id: 'acc-destination',
        description: 'Move to savings',
        type: 'transfer',
        amount: 5000,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        account_name: 'Checking',
        transfer_to_account_name: 'Savings',
        status: 'posted',
      },
    ]

    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))
    await user.selectOptions(screen.getByLabelText('filters.account'), 'acc-destination')

    expect(screen.getAllByText(/Checking → Savings/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('$50.00')).toHaveLength(4)
  })

  it('keeps completed placeholder lifecycle rows out of inline review editing', async () => {
    const user = userEvent.setup()
    mockTransactions = [
      {
        id: 'tx-placeholder',
        account_id: 'acc-usd',
        description: 'Completed placeholder',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        account_name: 'Checking',
        status: 'pending',
        is_placeholder: 1,
        placeholder_status: 'split',
      },
    ]

    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.review' }))

    expect(screen.getByText('review.protected.placeholderLifecycle')).toBeInTheDocument()
    expect(screen.queryByLabelText('review-category-tx-placeholder')).not.toBeInTheDocument()
  })

  it('queues attention reasons, updates review fields, and keeps protected rows out of inline editing', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      {
        id: 'acc-usd',
        name: 'Checking',
        currency: 'USD',
        is_archived: 0,
        account_mode: 'transactional',
      },
      {
        id: 'acc-archived',
        name: 'Archived',
        currency: 'USD',
        is_archived: 1,
        account_mode: 'transactional',
      },
      {
        id: 'acc-snapshot',
        name: 'Snapshot',
        currency: 'USD',
        is_archived: 0,
        account_mode: 'snapshot_only',
      },
    ]
    mockCategories = [
      { id: 'cat-food', name: 'Food', type: 'expense' },
      { id: 'cat-salary', name: 'Salary', type: 'income' },
    ]
    mockTransactions = [
      {
        id: 'tx-review',
        account_id: 'acc-usd',
        description: 'Needs category',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        category_name: null,
        category_color: null,
        account_name: 'Checking',
      },
      {
        id: 'tx-protected',
        account_id: 'acc-usd',
        description: 'Finalized import',
        type: 'expense',
        amount: 800,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        category_name: null,
        category_color: null,
        account_name: 'Checking',
        is_finalized_statement: 1,
        source: 'statement-import',
      },
    ]

    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.review' }))

    expect(screen.getAllByText('review.reasons.needs-category')).toHaveLength(2)
    expect(screen.getByText('review.protected.finalized')).toBeInTheDocument()
    expect(screen.queryByLabelText('review-category-tx-protected')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete Finalized import')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('review.category'), 'cat-food')
    await waitFor(() => {
      expect(mockUpdateReviewFields).toHaveBeenCalledWith('tx-review', { categoryId: 'cat-food' })
    })

    const reviewAccount = screen.getByLabelText('review.account') as HTMLSelectElement
    expect(Array.from(reviewAccount.options).map((option) => option.value)).toEqual(['acc-usd'])
  })

  it('moves review focus with J and K outside form controls', async () => {
    const user = userEvent.setup()
    mockTransactions = [
      {
        id: 'tx-first',
        account_id: 'acc-usd',
        description: 'First review item',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        category_name: null,
        category_color: null,
        account_name: 'Checking',
      },
      {
        id: 'tx-second',
        account_id: 'acc-usd',
        description: 'Second review item',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        date: dayjs().format('YYYY-MM-DD'),
        category_id: null,
        category_name: null,
        category_color: null,
        account_name: 'Checking',
      },
    ]

    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.review' }))

    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Second review item'))

    const categorySelect = screen.getAllByLabelText('review.category')[1]
    categorySelect.focus()
    fireEvent.keyDown(categorySelect, { key: 'k' })
    expect(document.activeElement).toBe(categorySelect)
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

  it('renders large transaction lists in pages instead of mounting every row at once', async () => {
    const user = userEvent.setup()
    mockTransactions = Array.from({ length: 105 }, (_, index) => ({
      id: `tx-${index}`,
      description: `Paged ${index.toString().padStart(3, '0')}`,
      type: 'expense',
      amount: 1000,
      currency: 'USD',
      date: dayjs().format('YYYY-MM-DD'),
      category_id: null,
      category_color: null,
      category_name: null,
      account_name: 'Checking',
    }))

    render(<Transactions />)

    expect(screen.getByText('Paged 000')).toBeInTheDocument()
    expect(screen.getByText('Paged 099')).toBeInTheDocument()
    expect(screen.queryByText('Paged 100')).not.toBeInTheDocument()
    expect(screen.getByText('pagination.summary')).toBeInTheDocument()

    await user.click(screen.getByText('pagination.showMore'))

    expect(screen.getByText('Paged 100')).toBeInTheDocument()
    expect(screen.getByText('Paged 104')).toBeInTheDocument()
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

  it('shows a specific error toast when deleting a transaction fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockRemove.mockRejectedValueOnce(new Error('Transaction delete DB error'))

    mockTransactions = [
      {
        id: 'tx-delete-fail',
        description: 'Delete Fails',
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

    await user.click(screen.getByLabelText('Delete Delete Fails'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('tx-delete-fail')
      expect(toast.error).toHaveBeenCalledWith('Transaction delete DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })
})
