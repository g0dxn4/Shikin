import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  reverse: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/cashflow-bucket-service', () => ({
  listCashflowBuckets: mocks.list,
  deleteCashflowBucket: mocks.remove,
  reverseCashflowAllocation: mocks.reverse,
  updateCashflowBucket: mocks.update,
}))
vi.mock('@/components/budgets/cashflow-bucket-dialogs', () => ({
  CashflowBucketEditorDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">bucket-editor</div> : null,
  CashflowAllocationDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">bucket-allocation</div> : null,
  CashflowCorrectionDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">bucket-correction</div> : null,
}))
vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>confirm-bucket-action</button> : null,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}))

import { CashflowBucketsPanel } from '../cashflow-buckets-panel'

const bucket = {
  id: 'rent',
  name: 'Rent',
  description: 'Monthly reserve',
  targetAmountCentavos: 100_00,
  balanceCentavos: 40_00,
  currency: 'USD',
  sortOrder: 0,
  isActive: true,
  createdAt: null,
  updatedAt: null,
  allocationCount: 1,
}
const allocation = {
  id: 'allocation-1',
  bucketId: 'rent',
  transactionId: 'income-1',
  amountCentavos: 40_00,
  currency: 'USD',
  allocationDate: '2026-05-01',
  source: 'income-transaction',
  note: null,
  reversesAllocationId: null,
  replacesAllocationId: null,
  createdAt: null,
}

function view() {
  return {
    buckets: [
      bucket,
      {
        ...bucket,
        id: 'travel',
        name: 'Travel',
        currency: 'EUR',
        targetAmountCentavos: null,
        balanceCentavos: 0,
        allocationCount: 0,
      },
    ],
    allocations: [allocation],
    incomeSources: [],
  }
}

describe('CashflowBucketsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue(view())
    mocks.remove.mockResolvedValue(undefined)
    mocks.reverse.mockResolvedValue(undefined)
    mocks.update.mockResolvedValue(undefined)
  })

  it('groups native currencies, states the ledger boundary and exposes wrapped 44px controls', async () => {
    render(<CashflowBucketsPanel />)
    expect(await screen.findByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Travel')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'USD' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'EUR' })).toBeInTheDocument()
    expect(screen.getByText('buckets.disclaimer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'buckets.actions.create' })).toHaveClass('min-h-11')
    expect(screen.getAllByRole('button', { name: 'buckets.actions.allocate' })[0]).toHaveClass(
      'min-h-11'
    )
    expect(
      screen.getByRole('button', { name: 'buckets.actions.create' }).parentElement
    ).toHaveClass('gap-3')
  })

  it('supports keyboard opening and reports/retries load errors', async () => {
    const user = userEvent.setup()
    mocks.list.mockRejectedValue(new Error('offline'))
    render(<CashflowBucketsPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    mocks.list.mockResolvedValue(view())
    await user.click(screen.getByRole('button', { name: 'buckets.actions.retry' }))
    expect(await screen.findByText('Rent')).toBeInTheDocument()

    const create = screen.getByRole('button', { name: 'buckets.actions.create' })
    create.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toHaveTextContent('bucket-editor')
  })

  it('shows delete only for empty unreferenced buckets and confirms one reversal', async () => {
    const user = userEvent.setup()
    render(<CashflowBucketsPanel />)
    await screen.findByText('Rent')
    const deletes = screen.getAllByRole('button', { name: 'buckets.actions.delete' })
    expect(deletes).toHaveLength(1)

    await user.click(screen.getByText(/buckets\.history\.title/))
    await user.click(screen.getByRole('button', { name: 'buckets.actions.reverse' }))
    await user.click(await screen.findByText('confirm-bucket-action'))
    await waitFor(() => expect(mocks.reverse).toHaveBeenCalledWith('allocation-1'))
  })
})
