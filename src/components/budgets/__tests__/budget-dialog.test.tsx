import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BudgetDialog } from '../budget-dialog'

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

const mockCloseBudgetDialog = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()

const mockBudget = {
  id: 'budget-1',
  name: 'Test Budget',
  category_id: 'cat-1',
  amount: 10000,
  period: 'monthly' as const,
  is_active: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const mockGetById = vi.fn().mockReturnValue(mockBudget)

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    budgetDialogOpen: true,
    editingBudgetId: 'budget-1', // Edit mode to pre-fill form
    closeBudgetDialog: mockCloseBudgetDialog,
  }),
}))

vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: () => ({
    add: mockAdd,
    update: mockUpdate,
    getById: mockGetById,
  }),
}))

const mockFetchCategories = vi.fn().mockResolvedValue(undefined)

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: [{ id: 'cat-1', name: 'Food', type: 'expense' }],
    isLoading: false,
    fetchError: null,
    fetch: mockFetchCategories,
  }),
}))

describe('BudgetDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prevents dialog closure while mutation is in flight', async () => {
    let resolveUpdate: () => void = () => {}
    mockUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve
        })
    )

    render(<BudgetDialog />)

    // Fill the form and submit (category is pre-selected since we mock categories)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('form.name'), ' Updated')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    // Verify the button shows loading state (dialog should stay open)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /actions\.saving/i })).toBeInTheDocument()
    })

    // Verify close was NOT called while loading
    expect(mockCloseBudgetDialog).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdate()
    })
  })

  it('asks before closing when the form has unsaved changes', async () => {
    const user = userEvent.setup()

    render(<BudgetDialog />)

    await user.type(screen.getByLabelText('form.name'), ' Dirty')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByTestId('discard-confirm')).toBeInTheDocument()
    expect(mockCloseBudgetDialog).not.toHaveBeenCalled()

    await act(async () => {
      screen.getByText('Discard').click()
    })

    expect(mockCloseBudgetDialog).toHaveBeenCalled()
  })

  it('closes dialog after successful mutation', async () => {
    mockUpdate.mockResolvedValueOnce(undefined)

    render(<BudgetDialog />)

    const user = userEvent.setup()
    // Just submit the pre-filled form
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockCloseBudgetDialog).toHaveBeenCalled()
    })
  })
})
