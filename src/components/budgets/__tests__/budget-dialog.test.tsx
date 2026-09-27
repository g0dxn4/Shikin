import type * as ScopedReadModule from '@/lib/scoped-report-read'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@/i18n'
vi.mock('@/lib/scoped-report-read', async (original) => ({
  ...(await original<typeof ScopedReadModule>()),
  readScopedSnapshot: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { readScopedSnapshot } from '@/lib/scoped-report-read'
import { scopedFixture } from '@/test/scoped-fixture'
import { BudgetDialog } from '../budget-dialog'
import { useBudgetStore } from '@/stores/budget-store'
import { useUIStore } from '@/stores/ui-store'
import { useCurrencyStore } from '@/stores/currency-store'
const update = vi.fn()
const add = vi.fn()
beforeEach(() => {
  const snapshot = scopedFixture()
  snapshot.budgets[0].is_active = 0
  vi.mocked(readScopedSnapshot).mockReset()
  vi.mocked(readScopedSnapshot).mockResolvedValue(snapshot)
  update.mockReset()
  update.mockResolvedValue(undefined)
  add.mockReset()
  add.mockResolvedValue(undefined)
  useBudgetStore.setState({ budgets: [], update, add })
  useUIStore.setState({ budgetDialogOpen: true, editingBudgetId: 'budget' })
  useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'USD', manualRates: [] })
})
describe('BudgetDialog protections with authoritative inactive inspection', () => {
  it('loads a by-ID inactive plan even when absent from the active list and saves reactivation', async () => {
    const user = userEvent.setup()
    render(<BudgetDialog />)
    await screen.findByDisplayValue('Food plan')
    await user.click(screen.getByText('Currency, measure & active status'))
    expect(screen.getByLabelText('Active budget')).not.toBeChecked()
    await user.click(screen.getByLabelText('Active budget'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'budget',
        expect.objectContaining({ currency: 'MXN', amount: undefined, isActive: true })
      )
    )
    expect(useUIStore.getState().budgetDialogOpen).toBe(false)
  })
  it('keeps the draft on failed save and requires dirty-discard confirmation', async () => {
    update.mockRejectedValue(new Error('Write rejected'))
    const user = userEvent.setup()
    render(<BudgetDialog />)
    await screen.findByDisplayValue('Food plan')
    await user.type(screen.getByLabelText('Budget Name'), ' changed')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(screen.getByLabelText('Budget Name')).toHaveValue('Food plan changed')
    expect(useUIStore.getState().budgetDialogOpen).toBe(true)
    await user.keyboard('{Escape}')
    await screen.findByText('Discard changes?')
    expect(useUIStore.getState().budgetDialogOpen).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(useUIStore.getState().budgetDialogOpen).toBe(false)
  })
  it('does not turn a missing budget ID into a new or editable blank form', async () => {
    vi.mocked(readScopedSnapshot).mockResolvedValue({ ...scopedFixture(), budgets: [] })
    render(<BudgetDialog />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Budget not found.')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})
