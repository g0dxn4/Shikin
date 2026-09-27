import type * as ScopedReadModule from '@/lib/scoped-report-read'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@/i18n'
vi.mock('@/lib/scoped-report-read', async (importOriginal) => ({
  ...(await importOriginal<typeof ScopedReadModule>()),
  readScopedSnapshot: vi.fn(),
}))
import { readScopedSnapshot } from '@/lib/scoped-report-read'
import { scopedFixture, fixtureBudget, deferred } from '@/test/scoped-fixture'
import { BudgetForm } from '../budget-form'
import { useCurrencyStore } from '@/stores/currency-store'
const read = vi.mocked(readScopedSnapshot)
beforeEach(() => {
  read.mockReset()
  read.mockResolvedValue(scopedFixture())
  useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'USD', manualRates: [] })
})
describe('scoped budget form', () => {
  it('uses DB main, not a preference/draft fallback and submits canonical advanced scope', async () => {
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD' })
    const submit = vi.fn()
    const user = userEvent.setup()
    render(<BudgetForm onSubmit={submit} />)
    await screen.findByRole('option', { name: 'Food' })
    expect(screen.getByLabelText('Currency')).toHaveValue('MXN')
    await user.type(screen.getByLabelText('Budget Name'), 'Food plan')
    await user.selectOptions(screen.getByLabelText('Category'), 'food')
    await user.clear(screen.getByLabelText(/Amount.*MXN/))
    await user.type(screen.getByLabelText(/Amount.*MXN/), '1000')
    await user.click(screen.getByText('Advanced scope · accounts, categories & tags'))
    await user.click(
      within(screen.getByRole('group', { name: 'Include source accounts' })).getByLabelText('Bank')
    )
    await user.type(screen.getByLabelText('Include tags'), ' Business, business')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({
      currency: 'MXN',
      amount: 1000,
      expectedMainCurrency: 'MXN',
      scope: { accountIds: ['bank'], categoryIds: ['food'], tags: ['business'], excludeTags: [] },
    })
  })
  it('clears currency edits, requires re-entry, keeps inactive and net controls editable', async () => {
    const budget = { ...fixtureBudget(), is_active: 0 }
    const submit = vi.fn()
    const user = userEvent.setup()
    render(<BudgetForm budget={budget} onSubmit={submit} />)
    await screen.findByRole('option', { name: 'Food' })
    await user.click(screen.getByText('Currency, measure & active status'))
    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR')
    expect(screen.getByLabelText(/Amount.*EUR/)).toHaveValue(null)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(submit).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Amount.*EUR/), '50')
    await user.selectOptions(screen.getByLabelText('Measure'), 'net_consumption')
    await user.click(screen.getByLabelText('Active budget'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'EUR',
          amount: 50,
          basis: 'net_consumption',
          isActive: true,
        })
      )
    )
  })
  it('preserves dangling selections and requires explicit resolution', async () => {
    const budget = {
      ...fixtureBudget(),
      category_id: null,
      scope_json: '{"accountIds":["deleted"],"categoryIds":["gone"]}',
    }
    render(<BudgetForm budget={budget} onSubmit={vi.fn()} />)
    await screen.findByRole('option', { name: 'Food' })
    fireEvent.click(screen.getByText('Advanced scope · accounts, categories & tags'))
    expect(screen.getByLabelText('Missing reference: deleted')).toBeChecked()
    expect(screen.getByRole('option', { name: 'Missing reference: gone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
  it('guards default currency drafts when DB authority changes and avoids unmounted load updates', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<BudgetForm onSubmit={vi.fn()} />)
    await screen.findByRole('option', { name: 'Food' })
    await user.type(screen.getByLabelText('Budget Name'), 'Draft')
    act(() => useCurrencyStore.setState({ mainCurrency: 'EUR', preferredCurrency: 'EUR' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/changed/i)
    unmount()
    const pending = deferred<ReturnType<typeof scopedFixture>>()
    read.mockReturnValueOnce(pending.promise)
    const next = render(<BudgetForm onSubmit={vi.fn()} />)
    next.unmount()
    await act(async () => pending.resolve(scopedFixture()))
  })
  it('shows snapshot failure and retries without enabling an unconfigured default', async () => {
    read.mockRejectedValueOnce(new Error('Offline'))
    const user = userEvent.setup()
    render(<BudgetForm onSubmit={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Refresh from database' }))
    await screen.findByRole('option', { name: 'Food' })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
