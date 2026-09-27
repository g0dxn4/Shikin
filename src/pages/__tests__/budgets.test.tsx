import type * as ScopedReadModule from '@/lib/scoped-report-read'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import '@/i18n'
vi.mock('@/components/budgets/category-spending-panel', () => ({
  CategorySpendingPanel: () => <section aria-label="category actuals" />,
}))
vi.mock('@/lib/scoped-report-read', async (original) => ({
  ...(await original<typeof ScopedReadModule>()),
  readScopedSnapshot: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { readScopedSnapshot } from '@/lib/scoped-report-read'
import { scopedFixture } from '@/test/scoped-fixture'
import { useBudgetStore } from '@/stores/budget-store'
import { useUIStore } from '@/stores/ui-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { TRANSACTION_PAGE_INVALIDATION_EVENT } from '@/lib/transaction-query-events'
import { Budgets } from '../budgets'
const read = vi.mocked(readScopedSnapshot)
const remove = vi.fn()
beforeEach(() => {
  read.mockReset()
  read.mockResolvedValue(scopedFixture())
  remove.mockReset()
  remove.mockResolvedValue(undefined)
  useBudgetStore.setState({ budgets: [], options: {}, fetchError: null, isLoading: false, remove })
  useUIStore.setState({ openBudgetDialog: vi.fn(), openTransactionDialog: vi.fn() })
  useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'USD', manualRates: [] })
})
const renderPage = (url = '/budgets') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Budgets />
    </MemoryRouter>
  )
describe('Budgets scoped page', () => {
  it('keeps native currency, nonadditive labels, existing add/edit/delete confirmations', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Food plan')
    expect(screen.getByText(/Budgets may overlap/)).toBeInTheDocument()
    expect(screen.getByText(/Actual gross · MXN/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Add Budget' })[0])
    expect(useUIStore.getState().openBudgetDialog).toHaveBeenCalledWith()
    await user.click(screen.getByRole('button', { name: 'Edit Food plan' }))
    expect(useUIStore.getState().openBudgetDialog).toHaveBeenCalledWith('budget')
    await user.click(screen.getByRole('button', { name: 'Delete Food plan' }))
    await screen.findByRole('dialog')
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete Food plan' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Delete Budget' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('budget'))
  })
  it('inspects inactive plans through an explicit deep link and retains windows across event refresh', async () => {
    const snapshot = scopedFixture()
    snapshot.budgets[0].is_active = 0
    read.mockResolvedValue(snapshot)
    const user = userEvent.setup()
    renderPage('/budgets?budget=budget')
    await screen.findByText('Inactive budget · editable for reactivation')
    await user.click(screen.getByText('Dates & window'))
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-01-20' } })
    await waitFor(() => expect(useBudgetStore.getState().options.asOf).toBe('2026-01-20'))
    // Explicit refresh and transaction-dialog invalidation use the same current options.
    const previous = read.mock.calls.length
    act(() => window.dispatchEvent(new CustomEvent(TRANSACTION_PAGE_INVALIDATION_EVENT)))
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(previous))
    expect(useBudgetStore.getState().options.budgetId).toBe('budget')
    await user.click(screen.getByRole('button', { name: 'Refresh from database' }))
    await screen.findByText('Food plan')
  })
  it('surfaces read failure without showing stale plan values', async () => {
    read.mockRejectedValue(new Error('snapshot failure'))
    renderPage()
    await screen.findByText('snapshot failure')
    expect(screen.queryByText('Food plan')).not.toBeInTheDocument()
  })
})
