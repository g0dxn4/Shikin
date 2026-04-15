import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvestmentDialog } from '../investment-dialog'

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

const mockCloseInvestmentDialog = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockGetById = vi.fn()

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    investmentDialogOpen: true,
    editingInvestmentId: null,
    closeInvestmentDialog: mockCloseInvestmentDialog,
  }),
}))

vi.mock('@/stores/investment-store', () => ({
  useInvestmentStore: () => ({
    add: mockAdd,
    update: mockUpdate,
    getById: mockGetById,
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    isLoading: false,
    fetchError: null,
  }),
}))

describe('InvestmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prevents dialog closure while mutation is in flight', async () => {
    // Create a delayed promise so isLoading stays true
    mockAdd.mockImplementation(() => new Promise(() => {}))

    render(<InvestmentDialog />)

    // Fill the form and submit
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('form.symbol'), 'AAPL')
    await user.type(screen.getByLabelText('form.name'), 'Apple Inc')
    await user.type(screen.getByLabelText('form.shares'), '10')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    // Verify the button shows loading state (dialog should stay open)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '...' })).toBeInTheDocument()
    })

    // Verify close was NOT called while loading
    expect(mockCloseInvestmentDialog).not.toHaveBeenCalled()
  })

  it('asks before closing when the form has unsaved changes', async () => {
    const user = userEvent.setup()

    render(<InvestmentDialog />)

    await user.type(screen.getByLabelText('form.symbol'), 'AAPL')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByTestId('discard-confirm')).toBeInTheDocument()
    expect(mockCloseInvestmentDialog).not.toHaveBeenCalled()

    screen.getByText('Discard').click()

    expect(mockCloseInvestmentDialog).toHaveBeenCalled()
  })

  it('closes dialog after successful mutation', async () => {
    mockAdd.mockResolvedValueOnce(undefined)

    render(<InvestmentDialog />)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('form.symbol'), 'AAPL')
    await user.type(screen.getByLabelText('form.name'), 'Apple Inc')
    await user.type(screen.getByLabelText('form.shares'), '10')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockCloseInvestmentDialog).toHaveBeenCalled()
    })
  })
})
