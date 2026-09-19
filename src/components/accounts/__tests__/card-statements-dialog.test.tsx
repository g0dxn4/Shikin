import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardStatementsDialog } from '../card-statements-dialog'
import type { Account } from '@/types/database'
import type { CardStatement } from '@/lib/card-payment-service'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(':')}` : key,
  }),
}))

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
  vi.clearAllMocks()
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
    service.previewRecordCardPayment.mockResolvedValue({
      revision: 7,
      operation: 'record-card-transfer',
      before: {},
      after: { transactionId: 'new-payment' },
    })
    service.recordCardPayment.mockResolvedValue({ transactionId: 'new-payment', statement })

    render(<CardStatementsDialog open onOpenChange={vi.fn()} account={account} />)
    await user.click(await screen.findByRole('button', { name: /payment.action/ }))
    expect(await screen.findByLabelText('payment.from')).toHaveValue('bank')

    const paymentDialog = screen.getByRole('dialog', { name: 'payment.title' })
    await user.clear(within(paymentDialog).getByLabelText('fields.amount'))
    await user.type(within(paymentDialog).getByLabelText('fields.amount'), '5.00')
    await user.click(within(paymentDialog).getByRole('button', { name: 'actions.review' }))

    expect(await within(paymentDialog).findByLabelText('review.title')).toBeInTheDocument()
    expect(service.recordCardPayment).not.toHaveBeenCalled()
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
        7
      )
    })
  })

  it('shows explicit ordinary-evidence confirmation and surfaces stale apply errors', async () => {
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
      operation: 'link-payment',
      before: statement,
      after: { ...statement, paidAmount: 300, linkedPaidAmount: 100 },
    })
    service.linkCardPayment.mockRejectedValue(new Error('Payment data changed after preview.'))

    render(<CardStatementsDialog open onOpenChange={vi.fn()} account={account} />)
    await user.click(await screen.findByRole('button', { name: /link.action/ }))
    const linkDialog = screen.getByRole('dialog', { name: 'link.title' })
    const confirmation = await within(linkDialog).findByRole('checkbox')
    await user.click(confirmation)
    await user.clear(within(linkDialog).getByLabelText('fields.amount'))
    await user.type(within(linkDialog).getByLabelText('fields.amount'), '1.00')
    await user.click(within(linkDialog).getByRole('button', { name: 'actions.review' }))
    await user.click(await within(linkDialog).findByRole('button', { name: 'actions.confirm' }))

    expect(service.previewLinkCardPayment).toHaveBeenCalledWith(
      expect.objectContaining({ explicitRepaymentConfirmation: true, amount: 100 })
    )
    expect(await within(linkDialog).findByRole('alert')).toHaveTextContent(
      'Payment data changed after preview.'
    )
  })
})
