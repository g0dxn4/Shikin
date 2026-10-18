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
import { formatMoney } from '@/lib/money'
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
    expect(screen.getByText(/does not sum limits/)).toBeInTheDocument()
    expect(screen.getByText(/Monthly · Actual gross · MXN ·/)).toBeInTheDocument()
    expect(screen.getAllByText(/Actual gross · MXN/).length).toBeGreaterThan(0)
    const details = screen.getByText('Details & evidence').closest('details')
    expect(details).not.toHaveAttribute('open')
    await user.click(screen.getByText('Details & evidence'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Inspect scope, coverage & money evidence')).toBeInTheDocument()
    expect(screen.getByText(/Inspect contributing transactions/)).toBeInTheDocument()
    expect(screen.queryByText('Total Budgeted')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add Budget' }))
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
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows known January amounts and opens a contributing transaction', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Food plan')
    await user.click(screen.getByText('Dates & window'))
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-01-20' } })
    const spent = formatMoney(25000, 'MXN')
    const limit = formatMoney(100000, 'MXN')
    const remaining = formatMoney(75000, 'MXN')
    expect((await screen.findAllByText(spent)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(limit).length).toBeGreaterThan(0)
    expect(screen.getAllByText(remaining).length).toBeGreaterThan(0)
    const ring = screen.getByRole('progressbar', { name: /Food plan/ })
    expect(ring).toHaveAttribute('data-budget-usage-filled', 'true')
    expect(ring).toHaveAttribute('data-budget-usage-percent', '25')
    expect(ring).toHaveAccessibleName(new RegExp(spent.replace('$', '\\$')))
    await user.click(screen.getByText('Details & evidence'))
    await user.click(screen.getByText(/Inspect contributing transactions/))
    await user.click(screen.getByRole('button', { name: /2026-01-10 · expense/ }))
    expect(useUIStore.getState().openTransactionDialog).toHaveBeenCalledWith('expense')
  })

  it('does not fill a ring when the window crosses plan periods', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Food plan')
    await user.click(screen.getByText('Dates & window'))
    fireEvent.change(screen.getByLabelText('Custom start'), { target: { value: '2026-01-01' } })
    await screen.findByText('Explicit windows require both start and end.')
    expect(screen.queryByText('Food plan')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Custom end'), { target: { value: '2026-03-31' } })
    await screen.findByText(/This range spans plan periods/)
    expect(screen.getByText('Food plan')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /usage unavailable/i })).toHaveAttribute(
      'data-budget-usage-filled',
      'false'
    )
  })

  it('filters the display period without summing and pages 20 plans', async () => {
    const user = userEvent.setup()
    const snapshot = scopedFixture()
    snapshot.budgets = Array.from({ length: 21 }, (_, index) => ({
      ...snapshot.budgets[0],
      id: `budget-${index}`,
      name: `Plan ${index}`,
    }))
    read.mockResolvedValue(snapshot)
    renderPage()
    await screen.findByText('Plan 0')
    expect(screen.getByText('Showing 20 of 21')).toBeInTheDocument()
    expect(screen.queryByText('Plan 20')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(formatMoney(21 * 100000, 'MXN'))
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }))
    expect(screen.getByText('Plan 20')).toBeInTheDocument()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Current plan period' }),
      'weekly'
    )
    expect(screen.queryByText('Plan 0')).not.toBeInTheDocument()
    expect(screen.getByText('No plans match this period.')).toBeInTheDocument()
    expect(screen.getByText(/Budgets may overlap/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
