import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountDialog } from '../account-dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockCloseAccountDialog = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockGetById = vi.fn()

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    accountDialogOpen: true,
    editingAccountId: null,
    closeAccountDialog: mockCloseAccountDialog,
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    add: mockAdd,
    update: mockUpdate,
    getById: mockGetById,
  }),
}))

describe('AccountDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog with create mode title', () => {
    render(<AccountDialog />)

    // Title and description both render "addAccount"
    const elements = screen.getAllByText('addAccount')
    expect(elements.length).toBeGreaterThanOrEqual(1)
  })

  it('renders form inside dialog', () => {
    render(<AccountDialog />)

    // The form fields are rendered (proving the dialog is open)
    expect(screen.getByLabelText('form.name')).toBeInTheDocument()
  })

  it('calls add and shows success toast on create submit', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockAdd.mockResolvedValueOnce(undefined)
    render(<AccountDialog />)

    await user.type(screen.getByLabelText('form.name'), 'New Account')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('toast.created')
      expect(mockCloseAccountDialog).toHaveBeenCalled()
    })
  })

  it('shows error toast when add throws', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockAdd.mockRejectedValueOnce(new Error('DB error'))
    render(<AccountDialog />)

    await user.type(screen.getByLabelText('form.name'), 'Failing Account')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('toast.error')
    })
  })
})
