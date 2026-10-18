import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReceivablePaymentView } from '@/lib/receivable-payment-service'

const mocks = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn(), refreshed: vi.fn() }))
vi.mock('@/lib/receivable-payment-service', () => ({
  readReceivablePayments: mocks.read,
  changeReceivablePayment: mocks.change,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { ReceivablePayments } from './receivable-payments'

const view: ReceivablePaymentView = {
  receivable: {
    id: 'invoice',
    payer: 'Client',
    amount: 20000,
    received_amount: 20000,
    unattributed_received_amount: 0,
    currency: 'USD',
    status: 'received',
    account_id: 'bank',
    matched_transaction_id: null,
    updated_at: '2026-10-10T12:00:00Z',
  },
  summary: {
    receivedAmount: 20000,
    remainingAmount: 0,
    linkedAmount: 20000,
    unattributedReceivedAmount: 0,
    activePaymentCount: 2,
    matchedTransactionId: null,
    status: 'received',
  },
  payments: [8000, 12000].map((amount, index) => ({
    id: `receipt-${index}`,
    receivable_id: 'invoice',
    transaction_id: `bank-${index}`,
    amount,
    currency: 'USD',
    transaction_date: '2026-10-10',
    transaction_snapshot_json: '{}',
    source: 'frontend',
    note: null,
    created_at: '2026-10-10T12:00:00Z',
    reversed_at: null,
    reversal_source: null,
    reversal_note: null,
  })),
  candidates: [],
}
const after = {
  receivedAmount: 12000,
  remainingAmount: 8000,
  linkedAmount: 12000,
  unattributedReceivedAmount: 0,
  activePaymentCount: 1,
  matchedTransactionId: 'bank-1',
  status: 'partial' as const,
}

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue(view)
  mocks.change.mockReset().mockResolvedValue({ token: 'reviewed-evidence', changed: true, after })
  mocks.refreshed.mockReset().mockResolvedValue(undefined)
})

async function prepare() {
  render(
    <ReceivablePayments receivableId="invoice" onClose={vi.fn()} onChanged={mocks.refreshed} />
  )
  const reverseButtons = await screen.findAllByRole('button', { name: 'payments.reverse' })
  fireEvent.click(reverseButtons[0]!)
  await screen.findByRole('button', { name: 'payments.apply' })
}

describe('receivable payment review dialog', () => {
  it('previews one selected receipt and applies only its reviewed evidence token', async () => {
    await prepare()
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith({
      receivableId: 'invoice',
      action: 'reverse',
      paymentId: 'receipt-0',
    })
    expect(screen.getByText('payments.remaining: $80.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'payments.apply' }))
    await waitFor(() => expect(mocks.refreshed).toHaveBeenCalledTimes(1))
    expect(mocks.change).toHaveBeenLastCalledWith({
      receivableId: 'invoice',
      action: 'reverse',
      paymentId: 'receipt-0',
      apply: true,
      expectedToken: 'reviewed-evidence',
    })
    expect(screen.queryByRole('button', { name: 'payments.apply' })).not.toBeInTheDocument()
  })

  it('retains the selected receipt and reviewed token after an apply error for safe retry', async () => {
    await prepare()
    mocks.change.mockRejectedValueOnce(new Error('Save interrupted'))
    fireEvent.click(screen.getByRole('button', { name: 'payments.apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save interrupted')
    expect(mocks.refreshed).not.toHaveBeenCalled()
    const attempted = mocks.change.mock.calls[1]![0]
    fireEvent.click(screen.getByRole('button', { name: 'payments.apply' }))
    await waitFor(() => expect(mocks.refreshed).toHaveBeenCalledTimes(1))
    expect(mocks.change.mock.calls[2]![0]).toEqual(attempted)
  })
})
