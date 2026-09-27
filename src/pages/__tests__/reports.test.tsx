import type * as ScopedReadModule from '@/lib/scoped-report-read'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  projectScopedReport,
  projectScopedRecurringEstimate,
  resolveReportWindow,
} from '@shikin/finance-core'
import i18n from '@/i18n'
vi.mock('@/lib/scoped-report-read', async (original) => ({
  ...(await original<typeof ScopedReadModule>()),
  readScopedReport: vi.fn(),
}))
import { readScopedReport, type ScopedRead, type ScopedReadInput } from '@/lib/scoped-report-read'
import { scopedFixture, fixtureWindow, deferred } from '@/test/scoped-fixture'
import { useCurrencyStore } from '@/stores/currency-store'
import { useUIStore } from '@/stores/ui-store'
import { TRANSACTION_PAGE_INVALIDATION_EVENT } from '@/lib/transaction-query-events'
import { ReportsPage } from '../reports'
const read = vi.mocked(readScopedReport)
let snapshot = scopedFixture()
function projection(input: ScopedReadInput): ScopedRead {
  const window = resolveReportWindow({ ...fixtureWindow, ...input.window })
  const currency = input.currency || snapshot.mainCurrency!
  return {
    result:
      input.basis === 'recurring_estimate'
        ? projectScopedRecurringEstimate({
            dataset: snapshot.estimates,
            scope: input.scope,
            currency,
            asOf: window.asOf,
            groupBy: input.groupBy,
          })
        : projectScopedReport({
            dataset: snapshot.dataset,
            scope: input.scope,
            currency,
            window,
            basis: input.basis,
            groupBy: input.groupBy,
          }),
    window,
    accounts: snapshot.accounts,
    categories: snapshot.categories,
    mainCurrency: snapshot.mainCurrency,
  }
}
beforeEach(() => {
  snapshot = scopedFixture()
  read.mockReset()
  read.mockImplementation(async (input) => projection(input))
  useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'USD', manualRates: [] })
  useUIStore.setState({ openTransactionDialog: vi.fn() })
})
describe('scoped Reports UI', () => {
  it('renders Spanish labels without changing the captured measure contract', async () => {
    await i18n.changeLanguage('es')
    try {
      render(<ReportsPage />)
      await screen.findByText('Completo')
      expect(screen.getByLabelText('Medida')).toHaveValue('gross_cashflow')
      expect(screen.getByRole('option', { name: 'Neto clasificado' })).toHaveValue(
        'net_consumption'
      )
      expect(
        screen.getByRole('button', { name: 'Actualizar desde la base de datos' })
      ).toBeInTheDocument()
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  })
  it('exposes gross/net/estimates, account/category/tag scope and grouping without unscoped metrics', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByText('Complete')
    expect(screen.getByLabelText('Measure')).toHaveValue('gross_cashflow')
    expect(screen.queryByText('Total Balance')).not.toBeInTheDocument()
    await user.click(screen.getByText('Advanced scope · accounts, categories & tags'))
    await user.click(
      within(screen.getByRole('group', { name: 'Exclude categories' })).getByLabelText('Food')
    )
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: expect.objectContaining({ excludeCategoryIds: ['food'] }),
        })
      )
    )
    await user.selectOptions(screen.getByLabelText('Group by'), 'account')
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: 'account' }))
    )
    await user.selectOptions(screen.getByLabelText('Measure'), 'net_consumption')
    await screen.findAllByText('Net consumption')
    expect(screen.getAllByText(/Incomplete · totals/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Earned income').length).toBeGreaterThan(0)
  })
  it('opens each selected parent once through the authoritative global dialog and refreshes on the existing event', async () => {
    snapshot.dataset = {
      ...snapshot.dataset,
      splits: [
        { id: 'a', transaction_id: 'expense', category_id: 'food', amount: 15000 },
        { id: 'b', transaction_id: 'expense', category_id: 'other', amount: 10000 },
      ],
    }
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByText('Complete')
    await user.click(screen.getByText(/Inspect contributing transactions/))
    const parents = screen.getAllByRole('button', { name: /2026-01-10 · expense/ })
    expect(parents).toHaveLength(1)
    await user.click(parents[0])
    expect(useUIStore.getState().openTransactionDialog).toHaveBeenCalledWith('expense')
    expect(screen.getByText(/Full parent · context only/)).toHaveTextContent('250')
    expect(screen.getByText(/Selected allocation: a/)).toBeInTheDocument()
    const previous = read.mock.calls.length
    act(() => window.dispatchEvent(new CustomEvent(TRANSACTION_PAGE_INVALIDATION_EVENT)))
    await waitFor(() => expect(read.mock.calls.length).toBe(previous + 1))
    expect(read.mock.calls[read.mock.calls.length - 1][0]).toMatchObject({
      basis: 'gross_cashflow',
      groupBy: 'category',
    })
    await user.click(screen.getByRole('button', { name: 'Refresh from database' }))
    await waitFor(() => expect(read.mock.calls.length).toBe(previous + 2))
  })
  it('resolves custom/as-of/week/timezone/through with the same controls', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByText('Complete')
    await user.click(screen.getByText('Dates & window'))
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-01-12' } })
    await user.selectOptions(screen.getByLabelText('Include through'), 'period_end')
    await user.selectOptions(screen.getByLabelText('Week starts on'), '1')
    fireEvent.change(screen.getByLabelText('Time zone (IANA)'), {
      target: { value: 'America/Mexico_City' },
    })
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(
        expect.objectContaining({
          window: {
            asOf: '2026-01-12',
            through: 'period_end',
            weekStartsOn: 1,
            timeZone: 'America/Mexico_City',
          },
        })
      )
    )
    fireEvent.change(screen.getByLabelText('Custom start'), { target: { value: '2026-02-01' } })
    await screen.findByRole('alert')
  })
  it('withholds old results during rapid currency changes and ignores late/unmounted responses', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ReportsPage />)
    await screen.findByText('Complete')
    const old = deferred<ScopedRead>()
    read.mockReturnValueOnce(old.promise)
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD')
    expect(screen.getByRole('status')).toHaveTextContent('Loading snapshot')
    expect(screen.queryByText('Actual expenses')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Currency'), 'MXN')
    await screen.findByText('Complete')
    await act(async () => old.resolve(projection({ basis: 'gross_cashflow', currency: 'USD' })))
    expect(screen.queryByText(/Incomplete · totals/)).not.toBeInTheDocument()
    const pending = deferred<ScopedRead>()
    read.mockReturnValueOnce(pending.promise)
    await user.click(screen.getByRole('button', { name: 'Refresh from database' }))
    unmount()
    await act(async () => pending.resolve(projection({ basis: 'gross_cashflow' })))
  })
  it('shows separate current recurring sources, never a combined total, tags explicitly unsupported for subscriptions', async () => {
    snapshot.estimates = {
      ...snapshot.estimates,
      recurringRules: [
        {
          id: 'rule',
          amount: 10000,
          currency: 'MXN',
          account_id: 'bank',
          category_id: 'food',
          is_active: 1,
          type: 'expense',
          frequency: 'monthly',
          tags: '["business"]',
        },
      ],
      subscriptions: [
        {
          id: 'sub',
          amount: 20000,
          currency: 'MXN',
          account_id: 'bank',
          category_id: 'food',
          is_active: 1,
          billing_cycle: 'monthly',
        },
      ],
    }
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByText('Complete')
    await user.selectOptions(screen.getByLabelText('Measure'), 'recurring_estimate')
    await screen.findByRole('heading', { name: 'Recurring rules · separate source' })
    expect(
      screen.getByRole('heading', { name: 'Subscriptions · separate source' })
    ).toBeInTheDocument()
    expect(screen.getByText(/No combined total/)).toBeInTheDocument()
    await user.click(screen.getByText('Advanced scope · accounts, categories & tags'))
    await user.type(screen.getByLabelText('Include tags'), 'business')
    await screen.findByText(/Subscriptions do not support tag filtering/)
    expect(
      screen.getByRole('heading', { name: 'Subscriptions · separate source' }).parentElement
    ).toHaveTextContent('Incomplete')
  })
})
