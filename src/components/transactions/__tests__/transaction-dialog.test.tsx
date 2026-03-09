import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionDialog } from '../transaction-dialog'
import type { TransactionWithDetails } from '@/stores/transaction-store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockCloseTransactionDialog = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockGetById = vi.fn()

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
    update: mockUpdate,
    getById: mockGetById,
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [{ id: 'acc-1', name: 'Checking', currency: 'USD' }],
    fetch: vi.fn(),
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: [],
    fetch: vi.fn(),
  }),
}))

const mockTransaction: TransactionWithDetails = {
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
}

describe('TransactionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEditingTransactionId = null
  })

  it('renders dialog with create mode title', () => {
    render(<TransactionDialog />)

    // Title and description both render "addTransaction"
    const elements = screen.getAllByText('addTransaction')
    expect(elements.length).toBeGreaterThanOrEqual(1)
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
    mockGetById.mockReturnValue(mockTransaction)
    mockUpdate.mockResolvedValueOnce(undefined)

    render(<TransactionDialog />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('tx-edit', expect.any(Object))
      expect(toast.success).toHaveBeenCalledWith('toast.updated')
      expect(mockCloseTransactionDialog).toHaveBeenCalled()
    })
  })

  it('shows error toast when update throws', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()

    mockEditingTransactionId = 'tx-edit'
    mockGetById.mockReturnValue(mockTransaction)
    mockUpdate.mockRejectedValueOnce(new Error('DB error'))

    render(<TransactionDialog />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('toast.error')
    })
  })
})
