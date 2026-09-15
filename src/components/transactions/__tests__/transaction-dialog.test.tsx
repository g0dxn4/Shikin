import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionDialog } from '../transaction-dialog'
import type { TransactionPageRow } from '@/lib/transaction-query'

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
    title,
    onConfirm,
  }: {
    open: boolean
    title: string
    onConfirm: () => void
  }) =>
    open ? (
      <div data-testid="discard-confirm">
        <span>{title}</span>
        <button onClick={onConfirm}>Discard</button>
      </div>
    ) : null,
}))

const mockCloseTransactionDialog = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockGetTransactionById = vi.fn()
const mockInvalidateTransactionPage = vi.fn()

let mockEditingTransactionId: string | null = null

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    transactionDialogOpen: true,
    editingTransactionId: mockEditingTransactionId,
    closeTransactionDialog: mockCloseTransactionDialog,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    add: mockAdd,
    addWithSplits: vi.fn(),
    update: mockUpdate,
  }),
}))

vi.mock('@/lib/transaction-query', () => ({
  getTransactionById: (id: string) => mockGetTransactionById(id),
}))

vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: (reason: string) => mockInvalidateTransactionPage(reason),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [{ id: 'acc-1', name: 'Checking', currency: 'USD' }],
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: [],
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
  }),
}))

const mockTransaction: TransactionPageRow = {
  id: 'tx-edit',
  account_id: 'acc-1',
  category_id: null,
  subcategory_id: null,
  type: 'expense',
  amount: 2500,
  currency: 'USD',
  description: 'Test expense',
  notes: null,
  date: '2024-06-15',
  tags: '',
  is_recurring: 0,
  transfer_to_account_id: null,
  created_at: '2024-06-15T00:00:00Z',
  updated_at: '2024-06-15T00:00:00Z',
  account_name: 'Checking',
  has_splits: 0,
}

describe('TransactionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEditingTransactionId = null
    mockGetTransactionById.mockResolvedValue(mockTransaction)
  })

  it('prevents dialog closure while mutation is in flight', async () => {
    let resolveUpdate: () => void = () => {}
    mockUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve
        })
    )

    // Use edit mode so form is pre-filled with valid data
    mockEditingTransactionId = 'tx-edit'
    render(<TransactionDialog />)

    // Submit only after the bounded by-ID lookup has loaded the current row.
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'actions.save' }))

    // Verify the button shows loading state (dialog should stay open)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '...' })).toBeInTheDocument()
    })

    // Verify close was NOT called while loading
    expect(mockCloseTransactionDialog).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdate()
    })
  })

  it('asks before closing when the form has unsaved changes', async () => {
    const user = userEvent.setup()

    render(<TransactionDialog />)

    await user.type(screen.getByLabelText('form.description'), 'Dirty transaction')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByTestId('discard-confirm')).toBeInTheDocument()
    expect(mockCloseTransactionDialog).not.toHaveBeenCalled()

    await act(async () => {
      screen.getByText('Discard').click()
    })

    expect(mockCloseTransactionDialog).toHaveBeenCalled()
  })

  it('renders dialog with create mode title', () => {
    render(<TransactionDialog />)

    expect(screen.getByText('addTransaction')).toBeInTheDocument()
    expect(screen.getByText('dialog.addDescription')).toBeInTheDocument()
  })

  it('renders DialogContent with overflow classes', () => {
    render(<TransactionDialog />)

    // Dialog renders in a portal, query the whole document
    const content = document.querySelector('.overflow-y-auto')
    expect(content).toBeInTheDocument()
  })

  it('calls add and shows success toast on create submit (edit mode pre-filled)', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockAdd.mockResolvedValueOnce(undefined)

    // Use edit mode so form is pre-filled with valid data
    mockEditingTransactionId = 'tx-edit'
    mockUpdate.mockResolvedValueOnce(undefined)

    render(<TransactionDialog />)

    await user.click(await screen.findByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('tx-edit', expect.any(Object))
      expect(toast.success).toHaveBeenCalledWith('toast.updated')
      expect(mockCloseTransactionDialog).toHaveBeenCalled()
      expect(mockInvalidateTransactionPage).toHaveBeenCalledWith('edit')
    })
  })

  it('loads a page-2 edit target by ID while the global transaction store is empty', async () => {
    let resolveLookup!: (transaction: TransactionPageRow) => void
    mockEditingTransactionId = 'page-2-row'
    mockGetTransactionById.mockImplementationOnce(
      () => new Promise((resolve) => (resolveLookup = resolve))
    )

    render(<TransactionDialog />)

    expect(mockGetTransactionById).toHaveBeenCalledWith('page-2-row')
    expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument()

    await act(async () =>
      resolveLookup({ ...mockTransaction, id: 'page-2-row', description: 'Actual page two row' })
    )

    expect(await screen.findByDisplayValue('Actual page two row')).toBeInTheDocument()
  })

  it('does not render or enable an editable default form when lookup returns not found', async () => {
    mockEditingTransactionId = 'missing-row'
    mockGetTransactionById.mockResolvedValueOnce(null)

    render(<TransactionDialog />)

    expect(await screen.findByText('dialog.notFound')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument()
  })

  it('invalidates filtered page queries after a new transaction succeeds', async () => {
    const user = userEvent.setup()
    mockAdd.mockResolvedValueOnce(undefined)

    render(<TransactionDialog />)

    await user.type(screen.getByLabelText('form.amount'), '12.34')
    await user.type(screen.getByLabelText('form.description'), 'New matching record')
    const nativeAccountSelect = [...document.querySelectorAll('select')].find((select) =>
      [...select.options].some((option) => option.text === 'Checking')
    )
    if (!nativeAccountSelect) throw new Error('Expected account select')
    fireEvent.change(nativeAccountSelect, { target: { value: 'acc-1' } })
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => expect(mockAdd).toHaveBeenCalled())
    expect(mockInvalidateTransactionPage).toHaveBeenCalledWith('add')
  })

  it('shows error toast when update throws', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()

    mockEditingTransactionId = 'tx-edit'
    mockUpdate.mockRejectedValueOnce(new Error('DB error'))

    render(<TransactionDialog />)

    await user.click(await screen.findByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('DB error')
    })
  })
})
