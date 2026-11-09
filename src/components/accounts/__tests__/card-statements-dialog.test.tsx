import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardStatementsDialog } from '../card-statements-dialog'
import type { Account } from '@/types/database'
import type { CardStatement } from '@/lib/card-payment-service'
import { toast } from 'sonner'
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

vi.mock('react-i18next', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(':')}` : key
  return { useTranslation: () => ({ t }) }
})

const invalidateTransactionPage = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transaction-query-events', () => ({ invalidateTransactionPage }))

const service = vi.hoisted(() => ({
  listCardStatements: vi.fn(),
  listCardPaymentLinks: vi.fn(),
  listEligibleCardPayments: vi.fn(),
  listCardPaymentSources: vi.fn(),
  previewLinkCardPayment: vi.fn(),
  linkCardPayment: vi.fn(),
  previewRecordCardPayment: vi.fn(),
  recordCardPayment: vi.fn(),
  previewCreateCardStatement: vi.fn(),
  createCardStatement: vi.fn(),
  previewUpdateCardStatement: vi.fn(),
  updateCardStatement: vi.fn(),
  previewDeleteCardStatement: vi.fn(),
  deleteCardStatement: vi.fn(),
  previewUnlinkCardPayment: vi.fn(),
  unlinkCardPayment: vi.fn(),
}))

vi.mock('@/lib/card-payment-service', () => service)
vi.mock('@/stores/account-store', () => ({
  useAccountStore: (selector: (state: { fetch: () => Promise<void> }) => unknown) =>
    selector({ fetch: vi.fn().mockResolvedValue(undefined) }),
}))

const account: Account = {
  id: 'card',
  name: 'Evidence Card',
  type: 'credit_card',
  currency: 'USD',
  balance: -1000,
  icon: null,
  color: null,
  is_archived: 0,
  account_mode: 'transactional',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const statement: CardStatement = {
  id: 'statement',
  accountId: 'card',
  statementStartDate: '2026-01-01',
  statementEndDate: '2026-01-31',
  dueDate: '2026-02-15',
  statementBalance: 1000,
  minimumPayment: 100,
  paidAmount: 200,
  unattributedPaidAmount: 200,
  linkedPaidAmount: 0,
  currency: 'USD',
  status: 'partial',
  source: null,
  note: null,
  createdAt: null,
  updatedAt: null,
  legacyOverpaid: false,
  activeLinks: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  service.listCardStatements.mockResolvedValue([statement])
  service.listCardPaymentLinks.mockResolvedValue([])
  service.listEligibleCardPayments.mockResolvedValue([])
  service.listCardPaymentSources.mockResolvedValue([
    { id: 'bank', name: 'Checking', currency: 'USD', balance: 5000 },
  ])
})

describe('CardStatementsDialog', () => {
  it('shows honest statement currency, baseline, linked coverage and status', async () => {
    render(<CardStatementsDialog open onOpenChange={vi.fn()} account={account} />)

    expect(await screen.findByText('2026-01-31')).toBeInTheDocument()
    expect(screen.getByText('status.partial')).toBeInTheDocument()
    expect(screen.getByText('description:USD')).toBeInTheDocument()
    expect(screen.getByText('baseline')).toBeInTheDocument()
    expect(screen.getByText('linked')).toBeInTheDocument()
    expect(screen.getAllByText('$2.00').length).toBeGreaterThan(0)
  })

  it('requires reviewed confirmation before recording a real atomic transfer', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn().mockResolvedValue(undefined)
    service.previewRecordCardPayment.mockResolvedValue({
      revision: 7,
      token: 'payment-token',
      operation: 'record-card-transfer',
      before: {},
      after: {
        transactionId: 'new-payment',
        sourceBalance: 4500,
        cardBalance: -500,
        currency: 'USD',
      },
    })
    service.recordCardPayment.mockResolvedValue({ transactionId: 'new-payment', statement })

    render(
      <CardStatementsDialog open onOpenChange={vi.fn()} account={account} onChanged={onChanged} />
    )
    await user.click(await screen.findByRole('button', { name: /payment.action/ }))
    expect(await screen.findByLabelText('payment.from')).toHaveValue('bank')

    const paymentDialog = screen.getByRole('dialog', { name: 'payment.title' })
    await user.clear(within(paymentDialog).getByLabelText('fields.amount'))
    await user.type(within(paymentDialog).getByLabelText('fields.amount'), '5.00')
    await user.click(within(paymentDialog).getByRole('button', { name: 'actions.review' }))

    expect(await within(paymentDialog).findByLabelText('review.title')).toBeInTheDocument()
    expect(within(paymentDialog).getByText('review.resultingSource')).toBeInTheDocument()
    expect(within(paymentDialog).getByText('review.resultingCard')).toBeInTheDocument()
    expect(service.recordCardPayment).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    await user.click(within(paymentDialog).getByRole('button', { name: 'actions.confirm' }))

    await waitFor(() => {
      expect(service.recordCardPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          cardAccountId: 'card',
          fromAccountId: 'bank',
          statementId: 'statement',
          amount: 500,
          statementOnly: false,
        }),
        'payment-token'
      )
      expect(invalidateTransactionPage).toHaveBeenCalledWith('add')
      expect(onChanged).toHaveBeenCalledTimes(1)
      expect(service.listCardStatements).toHaveBeenCalledTimes(2)
    })
  })

  it('does not revive an obsolete preview after payment inputs change', async () => {
    const user = userEvent.setup()
    let resolvePreview!: (value: Record<string, unknown>) => void
    service.previewRecordCardPayment.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve
      })
    )

    render(<CardStatementsDialog open onOpenChange={vi.fn()} account={account} />)
    await user.click(await screen.findByRole('button', { name: /payment.action/ }))
    const paymentDialog = screen.getByRole('dialog', { name: 'payment.title' })
    const amount = within(paymentDialog).getByLabelText('fields.amount')
    await user.clear(amount)
    await user.type(amount, '5.00')
    await user.click(within(paymentDialog).getByRole('button', { name: 'actions.review' }))
    await user.clear(amount)
    await user.type(amount, '6.00')
    resolvePreview({
      revision: 7,
      token: 'obsolete-token',
      operation: 'record-card-transfer',
      before: {},
      after: { sourceBalance: 4400, cardBalance: -400, currency: 'USD' },
    })

    await waitFor(() => {
      expect(within(paymentDialog).queryByRole('button', { name: 'actions.confirm' })).toBeNull()
    })
  })

  it.each(['read-async', 'read-sync', 'callback-sync'])(
    'keeps a committed payment successful after %s failure',
    async (failure) => {
      const user = userEvent.setup()
      const onChanged = vi.fn().mockResolvedValue(undefined)
      if (failure === 'callback-sync') {
        onChanged.mockImplementationOnce(() => {
          throw new Error('callback unavailable')
        })
      } else {
        service.listCardStatements.mockResolvedValueOnce([statement]).mockImplementationOnce(() => {
          expect(invalidateTransactionPage).toHaveBeenCalledWith('add')
          if (failure === 'read-sync') throw new Error('refresh unavailable')
          return Promise.reject(new Error('refresh unavailable'))
        })
      }
      service.previewRecordCardPayment.mockResolvedValue({
        revision: 7,
        token: 'payment-token',
        operation: 'record-card-transfer',
        before: {},
        after: { sourceBalance: -100, cardBalance: 100, currency: 'USD' },
      })
      service.recordCardPayment.mockResolvedValue({ transactionId: 'committed', statement })

      render(
        <CardStatementsDialog open onOpenChange={vi.fn()} account={account} onChanged={onChanged} />
      )
      await user.click(await screen.findByRole('button', { name: /payment.action/ }))
      const paymentDialog = screen.getByRole('dialog', { name: 'payment.title' })
      await user.clear(within(paymentDialog).getByLabelText('fields.amount'))
      await user.type(within(paymentDialog).getByLabelText('fields.amount'), '11.00')
      await user.click(within(paymentDialog).getByRole('button', { name: 'actions.review' }))
      expect(
        await within(paymentDialog).findByText('review.negativeFundsWarning')
      ).toBeInTheDocument()
      expect(within(paymentDialog).getByText('review.cardCreditWarning')).toBeInTheDocument()
      await user.click(within(paymentDialog).getByRole('button', { name: 'actions.confirm' }))

      expect(await within(paymentDialog).findByRole('alert')).toHaveTextContent(
        'savedRefreshFailed'
      )
      expect(within(paymentDialog).queryByRole('button', { name: 'actions.confirm' })).toBeNull()
      expect(
        within(paymentDialog).getByRole('button', { name: 'actions.close' })
      ).toBeInTheDocument()
      expect(invalidateTransactionPage).toHaveBeenCalledWith('add')
      expect(onChanged).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('refresh unavailable')).not.toBeInTheDocument()
      await user.click(within(paymentDialog).getByRole('button', { name: 'actions.close' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(toast.warning).not.toHaveBeenCalled()
      expect(service.listCardStatements).toHaveBeenCalledTimes(2)
      expect(service.recordCardPayment).toHaveBeenCalledOnce()
    }
  )

  it.each([false, true])(
    'refreshes and invalidates after unmount, reporting any warning (incomplete=%s)',
    async (incomplete) => {
      const user = userEvent.setup()
      const onChanged = vi.fn().mockResolvedValue(undefined)
      if (incomplete) onChanged.mockRejectedValueOnce(new Error('refresh unavailable'))
      let resolvePayment!: (value: { transactionId: string; statement: CardStatement }) => void
      service.previewRecordCardPayment.mockResolvedValue({
        revision: 7,
        token: 'payment-token',
        operation: 'record-card-transfer',
        before: {},
        after: { sourceBalance: 4000, cardBalance: 0, currency: 'USD' },
      })
      service.recordCardPayment.mockReturnValue(
        new Promise((resolve) => {
          resolvePayment = resolve
        })
      )

      const view = render(
        <CardStatementsDialog open onOpenChange={vi.fn()} account={account} onChanged={onChanged} />
      )
      await user.click(await screen.findByRole('button', { name: /payment.action/ }))
      const paymentDialog = screen.getByRole('dialog', { name: 'payment.title' })
      await user.click(within(paymentDialog).getByRole('button', { name: 'actions.review' }))
      await user.click(
        await within(paymentDialog).findByRole('button', { name: 'actions.confirm' })
      )
      view.unmount()
      resolvePayment({ transactionId: 'committed', statement })

      await waitFor(() => {
        expect(invalidateTransactionPage).toHaveBeenCalledWith('add')
        expect(onChanged).toHaveBeenCalledTimes(1)
      })
      if (incomplete)
        await waitFor(() =>
          expect(toast.warning).toHaveBeenCalledExactlyOnceWith('savedRefreshFailed')
        )
      else expect(toast.warning).not.toHaveBeenCalled()
      expect(service.recordCardPayment).toHaveBeenCalledOnce()
    }
  )

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ] as const)(
    'keeps link save errors distinct from read errors (committed=%s, unmounted=%s)',
    async (committed, unmounted) => {
      const user = userEvent.setup()
      service.listEligibleCardPayments.mockResolvedValue([
        {
          transactionId: 'ordinary',
          canonicalTransactionId: 'ordinary',
          description: 'Manual repayment',
          date: '2026-02-01',
          amount: 1000,
          currency: 'USD',
          shape: 'ordinary_bank_expense',
          requiresExplicitConfirmation: true,
          eligibleCapacity: 1000,
          activeLinkedAmount: 0,
          remainingCapacity: 1000,
        },
      ])
      service.previewLinkCardPayment.mockResolvedValue({
        revision: 8,
        token: 'link-token',
        operation: 'link-payment',
        before: statement,
        after: { ...statement, paidAmount: 300, linkedPaidAmount: 100 },
      })
      let resolveSave!: (result: typeof statement) => void
      if (unmounted)
        service.linkCardPayment.mockReturnValueOnce(
          new Promise((resolve) => {
            resolveSave = resolve
          })
        )
      else if (committed) service.linkCardPayment.mockResolvedValue(statement)
      else
        service.linkCardPayment.mockRejectedValue(new Error('Payment data changed after preview.'))
      const onChanged = vi.fn(() => {
        throw new Error('read unavailable')
      })

      const view = render(
        <CardStatementsDialog open onOpenChange={vi.fn()} account={account} onChanged={onChanged} />
      )
      await user.click(await screen.findByRole('button', { name: /link.action/ }))
      const linkDialog = screen.getByRole('dialog', { name: 'link.title' })
      const confirmation = await within(linkDialog).findByRole('checkbox')
      await user.click(confirmation)
      await user.clear(within(linkDialog).getByLabelText('fields.amount'))
      await user.type(within(linkDialog).getByLabelText('fields.amount'), '1.00')
      await user.click(within(linkDialog).getByRole('button', { name: 'actions.review' }))
      await user.click(await within(linkDialog).findByRole('button', { name: 'actions.confirm' }))
      if (unmounted) {
        view.unmount()
        await act(async () => resolveSave(statement))
      }

      expect(service.previewLinkCardPayment).toHaveBeenCalledWith(
        expect.objectContaining({ explicitRepaymentConfirmation: true, amount: 100 })
      )
      if (unmounted) {
        await waitFor(() =>
          expect(toast.warning).toHaveBeenCalledExactlyOnceWith('savedRefreshFailed')
        )
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } else {
        expect(await within(linkDialog).findByRole('alert')).toHaveTextContent(
          committed ? 'savedRefreshFailed' : 'Payment data changed after preview.'
        )
      }
      expect(service.linkCardPayment).toHaveBeenCalledOnce()
      expect(onChanged).toHaveBeenCalledTimes(committed ? 1 : 0)
      if (committed) {
        expect(invalidateTransactionPage).toHaveBeenCalledWith('review')
        if (!unmounted) expect(toast.warning).not.toHaveBeenCalled()
      } else {
        expect(invalidateTransactionPage).not.toHaveBeenCalled()
        expect(toast.warning).not.toHaveBeenCalled()
      }
    }
  )

  it.each([false, true])(
    'uses one statement-editor warning channel (unmounted=%s)',
    async (unmounted) => {
      service.previewUpdateCardStatement.mockResolvedValue({
        token: 'edit-token',
        after: statement,
      })
      let resolveSave!: () => void
      service.updateCardStatement.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
      )
      const onChanged = vi.fn().mockRejectedValue(new Error('read unavailable'))
      const user = userEvent.setup()
      const view = render(
        <CardStatementsDialog open onOpenChange={vi.fn()} account={account} onChanged={onChanged} />
      )
      await user.click(await screen.findByRole('button', { name: 'actions.edit' }))
      const dialog = screen.getByRole('dialog', { name: 'editor.editTitle' })
      await user.click(within(dialog).getByRole('button', { name: 'actions.review' }))
      await user.click(await within(dialog).findByRole('button', { name: 'actions.confirm' }))
      if (unmounted) view.unmount()
      resolveSave()
      if (unmounted) {
        await waitFor(() =>
          expect(toast.warning).toHaveBeenCalledExactlyOnceWith('savedRefreshFailed')
        )
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } else {
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('savedRefreshFailed')
        expect(toast.warning).not.toHaveBeenCalled()
      }
      expect(service.updateCardStatement).toHaveBeenCalledOnce()
      expect(onChanged).toHaveBeenCalledOnce()
    }
  )

  it.each([false, true])(
    'uses one statement-deletion warning channel (unmounted=%s)',
    async (unmounted) => {
      service.previewDeleteCardStatement.mockResolvedValue({ token: 'delete-token', after: null })
      let resolveSave!: () => void
      service.deleteCardStatement.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
      )
      const onChanged = vi.fn().mockRejectedValue(new Error('read unavailable'))
      const user = userEvent.setup()
      const view = render(
        <CardStatementsDialog open onOpenChange={vi.fn()} account={account} onChanged={onChanged} />
      )
      await user.click(await screen.findByRole('button', { name: 'actions.delete' }))
      const dialog = await screen.findByRole('dialog', { name: 'confirm.deleteTitle' })
      await user.click(within(dialog).getByRole('button', { name: 'actions.confirm' }))
      if (unmounted) view.unmount()
      resolveSave()
      if (unmounted) {
        await waitFor(() =>
          expect(toast.warning).toHaveBeenCalledExactlyOnceWith('savedRefreshFailed')
        )
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } else {
        expect(await screen.findByRole('alert')).toHaveTextContent('savedRefreshFailed')
        expect(toast.warning).not.toHaveBeenCalled()
      }
      expect(service.deleteCardStatement).toHaveBeenCalledOnce()
      expect(onChanged).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['record', 'open', 1, 0],
    ['record', 'child-closed', 1, 0],
    ['record', 'unmounted', 1, 1],
    ['link', 'open', 1, 0],
    ['link', 'child-closed', 1, 0],
    ['link', 'unmounted', 1, 1],
    ['editor', 'open', 1, 0],
    ['editor', 'child-closed', 1, 0],
    ['editor', 'unmounted', 1, 1],
  ] as const)(
    'pins %s refresh notices with %s (%i visible, %i toasts)',
    async (flow, context, notices, toasts) => {
      service.listCardStatements
        .mockResolvedValueOnce([statement])
        .mockRejectedValueOnce(new Error('statement reload unavailable'))
      const onChanged = vi.fn().mockResolvedValue(undefined)
      const mutation =
        flow === 'record'
          ? service.recordCardPayment
          : flow === 'link'
            ? service.linkCardPayment
            : service.updateCardStatement
      let resolveCommit!: (result: unknown) => void
      mutation.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCommit = resolve
        })
      )
      if (flow === 'record') {
        service.previewRecordCardPayment.mockResolvedValue({
          token: 'record-token',
          after: { sourceBalance: 4200, cardBalance: -200, currency: 'USD' },
        })
      } else if (flow === 'link') {
        service.listEligibleCardPayments.mockResolvedValue([
          {
            transactionId: 'ordinary',
            canonicalTransactionId: 'ordinary',
            description: 'Manual repayment',
            date: '2026-02-01',
            amount: 1000,
            currency: 'USD',
            shape: 'ordinary_bank_expense',
            requiresExplicitConfirmation: true,
            eligibleCapacity: 1000,
            activeLinkedAmount: 0,
            remainingCapacity: 1000,
          },
        ])
        service.previewLinkCardPayment.mockResolvedValue({ token: 'link-token', after: statement })
      } else {
        service.previewUpdateCardStatement.mockResolvedValue({
          token: 'edit-token',
          after: statement,
        })
      }
      const user = userEvent.setup()
      const view = render(
        <CardStatementsDialog open onOpenChange={vi.fn()} account={account} onChanged={onChanged} />
      )
      const action =
        flow === 'record' ? 'payment.action' : flow === 'link' ? 'link.action' : 'actions.edit'
      const title =
        flow === 'record' ? 'payment.title' : flow === 'link' ? 'link.title' : 'editor.editTitle'
      await user.click(await screen.findByRole('button', { name: action }))
      const child = screen.getByRole('dialog', { name: title })
      if (flow === 'link') {
        await user.click(await within(child).findByRole('checkbox'))
        await user.clear(within(child).getByLabelText('fields.amount'))
        await user.type(within(child).getByLabelText('fields.amount'), '1.00')
      }
      await user.click(within(child).getByRole('button', { name: 'actions.review' }))
      await user.click(await within(child).findByRole('button', { name: 'actions.confirm' }))
      await waitFor(() => expect(mutation).toHaveBeenCalledOnce())
      if (context === 'child-closed') {
        const input = within(child).getByLabelText(
          flow === 'editor' ? 'fields.note' : 'fields.amount'
        )
        await user.clear(input)
        await user.type(input, flow === 'editor' ? 'new draft' : '2.00')
        await user.click(within(child).getByRole('button', { name: 'actions.cancel' }))
        expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument()
        expect(screen.getByRole('dialog', { name: 'title:Evidence Card' })).toBeVisible()
      } else if (context === 'unmounted') view.unmount()
      await act(async () =>
        resolveCommit(flow === 'record' ? { transactionId: 'committed', statement } : statement)
      )
      if (context !== 'unmounted') {
        expect(await screen.findByRole('alert')).toHaveTextContent('savedRefreshFailed')
      } else expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(vi.mocked(toast.warning).mock.calls).toEqual(
        Array.from({ length: toasts }, () => ['savedRefreshFailed'])
      )
      expect(
        screen.queryAllByRole('alert').length + vi.mocked(toast.warning).mock.calls.length
      ).toBe(notices)
      expect(service.listCardStatements).toHaveBeenCalledTimes(2)
      expect(onChanged).toHaveBeenCalledOnce()
      expect(mutation).toHaveBeenCalledOnce()
    }
  )
})
