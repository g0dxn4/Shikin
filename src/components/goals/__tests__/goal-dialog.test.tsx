import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalDialog } from '../goal-dialog'

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

const mockCloseGoalDialog = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockGetById = vi.fn()

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    goalDialogOpen: true,
    editingGoalId: null,
    closeGoalDialog: mockCloseGoalDialog,
  }),
}))

vi.mock('@/stores/goal-store', () => ({
  useGoalStore: () => ({
    add: mockAdd,
    update: mockUpdate,
    getById: mockGetById,
  }),
}))

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    isLoading: false,
    fetchError: null,
    fetch: mockFetchAccounts,
  }),
}))

describe('GoalDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prevents dialog closure while mutation is in flight', async () => {
    // Create a delayed promise so isLoading stays true
    mockAdd.mockImplementation(() => new Promise(() => {}))

    render(<GoalDialog />)

    // Fill the form and submit
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('form.name'), 'Test Goal')
    await user.type(screen.getByLabelText('form.targetAmount'), '1000')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    // Verify the button shows loading state (dialog should stay open)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /actions\.saving/i })).toBeInTheDocument()
    })

    // Verify close was NOT called while loading
    expect(mockCloseGoalDialog).not.toHaveBeenCalled()
  })

  it('asks before closing when the form has unsaved changes', async () => {
    const user = userEvent.setup()

    render(<GoalDialog />)

    await user.type(screen.getByLabelText('form.name'), 'Dirty Goal')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByTestId('discard-confirm')).toBeInTheDocument()
    expect(mockCloseGoalDialog).not.toHaveBeenCalled()

    screen.getByText('Discard').click()

    expect(mockCloseGoalDialog).toHaveBeenCalled()
  })

  it('closes dialog after successful mutation', async () => {
    mockAdd.mockResolvedValueOnce(undefined)

    render(<GoalDialog />)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('form.name'), 'Test Goal')
    await user.type(screen.getByLabelText('form.targetAmount'), '1000')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockCloseGoalDialog).toHaveBeenCalled()
    })
  })
})
