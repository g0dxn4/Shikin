import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountForm } from '../account-form'
import type { Account } from '@/types/database'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
})
const account: Account = {
  id: 'synthetic',
  name: 'Portfolio',
  type: 'investment',
  currency: 'USD',
  balance: 12345,
  icon: 'wallet',
  color: '#abc',
  account_mode: 'transactional',
  valuation_mode: 'unresolved',
  is_archived: 0,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
}
async function select(label: string, option: string) {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('option', { name: option }))
}
describe('account ownership and observed-date form wiring', () => {
  it('demands an explicit informed ownership choice for a new portfolio', async () => {
    const submit = vi.fn(),
      user = userEvent.setup()
    render(<AccountForm onSubmit={submit} />)
    await user.type(screen.getByLabelText('form.name'), 'Synthetic portfolio')
    await select('form.type', 'types.investment')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    expect(submit).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('form.chooseValuationMode')
    await select('form.valuationMode', 'form.portfolioSnapshot')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'investment',
          valuationMode: 'portfolio_snapshot',
          accountMode: 'transactional',
          balance: 0,
        }),
        expect.anything()
      )
    )
  })
  it('preserves legacy unresolved ownership and makes mode-only updates without an observation request', async () => {
    const submit = vi.fn(),
      user = userEvent.setup()
    render(<AccountForm account={account} onSubmit={submit} />)
    expect(screen.getByLabelText('form.valuationMode')).toHaveTextContent('form.unresolved')
    await select('form.valuationMode', 'form.cashPlusHoldings')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          valuationMode: 'cash_plus_holdings',
          balance: 123.45,
          observedDate: undefined,
        }),
        expect.anything()
      )
    )
  })
  it('gives explicit ownership precedence over snapshot-only tracking', () => {
    render(
      <AccountForm
        account={{
          ...account,
          account_mode: 'snapshot_only',
          valuation_mode: 'cash_plus_holdings',
        }}
        onSubmit={vi.fn()}
      />
    )
    expect(screen.getByLabelText('form.valuationMode')).toHaveTextContent('form.cashPlusHoldings')
    expect(screen.getByLabelText('form.accountMode')).toHaveTextContent('form.snapshotOnly')
  })
  it('passes the observed date when editing a balance and explains retention of later activity', async () => {
    const submit = vi.fn(),
      user = userEvent.setup()
    render(<AccountForm account={account} onSubmit={submit} />)
    fireEvent.change(screen.getByLabelText('form.observedDate'), {
      target: { value: '2025-01-31' },
    })
    fireEvent.change(screen.getByLabelText('form.balance'), { target: { value: '140' } })
    expect(screen.getByLabelText('form.observedDate')).toHaveAccessibleDescription(
      'form.observedDateHelp'
    )
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ balance: 140, observedDate: '2025-01-31' }),
        expect.anything()
      )
    )
  })
  it('clears nullable metadata explicitly rather than treating blanks as omissions', async () => {
    const submit = vi.fn(),
      user = userEvent.setup()
    render(
      <AccountForm
        account={{
          ...account,
          type: 'credit_card',
          credit_limit: 0,
          statement_closing_day: 5,
          payment_due_day: 20,
        }}
        onSubmit={submit}
      />
    )
    expect(screen.getByLabelText('form.creditLimit')).toHaveValue(0)
    for (const label of [
      'form.creditLimit',
      'form.statementClosingDay',
      'form.paymentDueDay',
      'form.icon',
      'form.color',
    ])
      await user.clear(screen.getByLabelText(label))
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          creditLimit: null,
          statementClosingDay: null,
          paymentDueDay: null,
          icon: null,
          color: null,
          observedDate: undefined,
        }),
        expect.anything()
      )
    )
  })
})
