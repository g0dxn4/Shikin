import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  allocate: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}))

vi.mock('@/lib/cashflow-bucket-service', () => ({
  createCashflowBucket: mocks.create,
  updateCashflowBucket: mocks.update,
  allocateCashflow: mocks.allocate,
  previewCashflowCorrection: mocks.preview,
  applyCashflowCorrection: mocks.apply,
  decimalAmountToCentavos: (amount: number) => Math.round(amount * 100),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import {
  CashflowAllocationDialog,
  CashflowBucketEditorDialog,
  CashflowCorrectionDialog,
} from '../cashflow-bucket-dialogs'

const bucket = {
  id: 'rent',
  name: 'Rent',
  description: 'Housing',
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue(bucket)
  mocks.update.mockResolvedValue(bucket)
  mocks.allocate.mockResolvedValue(allocation)
})

describe('cashflow bucket dialogs', () => {
  it('makes target clearing explicit while omitted currency remains immutable on edit', async () => {
    const user = userEvent.setup()
    const saved = vi.fn()
    render(
      <CashflowBucketEditorDialog
        open
        bucket={bucket}
        defaultCurrency="EUR"
        onOpenChange={vi.fn()}
        onSaved={saved}
      />
    )
    expect(screen.queryByText('buckets.fields.currency')).not.toBeInTheDocument()
    await user.click(screen.getByText('buckets.fields.clearTarget'))
    await user.click(screen.getByRole('button', { name: 'buckets.actions.save' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        'rent',
        expect.objectContaining({ clearFields: ['targetAmount'] })
      )
    )
    expect(saved).toHaveBeenCalled()
  })

  it('requires explicit acknowledgement for UNBOUND VIRTUAL allocations', async () => {
    const user = userEvent.setup()
    render(
      <CashflowAllocationDialog
        open
        bucket={bucket}
        sources={[]}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    await user.type(screen.getByRole('spinbutton'), '12.50')
    await user.click(screen.getByRole('button', { name: 'buckets.actions.allocate' }))
    expect(screen.getByRole('alert')).toHaveTextContent('buckets.error.confirmUnbound')
    expect(mocks.allocate).not.toHaveBeenCalled()

    await user.click(screen.getByText('buckets.funding.confirmUnbound'))
    await user.click(screen.getByRole('button', { name: 'buckets.actions.allocate' }))
    await waitFor(() =>
      expect(mocks.allocate).toHaveBeenCalledWith({
        bucketId: 'rent',
        amountCentavos: 1250,
        transactionId: null,
      })
    )
  })

  it('requires correction preview review before applying and surfaces stale failures', async () => {
    const user = userEvent.setup()
    const preview = {
      token: 'reviewed-token',
      original: allocation,
      originalBucket: bucket,
      targetBucket: { ...bucket, id: 'tax', name: 'Tax', balanceCentavos: 0 },
      replacement: {
        bucketId: 'tax',
        amountCentavos: 30_00,
        transactionId: null,
        currency: 'USD',
        allocationDate: '2026-05-02',
        note: null,
      },
      balances: { originalAfterCentavos: 0, targetAfterCentavos: 30_00 },
    }
    mocks.preview.mockResolvedValue(preview)
    mocks.apply.mockRejectedValueOnce(new Error('Bucket correction preview is stale.'))
    render(
      <CashflowCorrectionDialog
        open
        allocation={allocation}
        buckets={[bucket, preview.targetBucket]}
        sources={[]}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    await user.selectOptions(screen.getByLabelText('buckets.fields.targetBucket'), 'tax')
    const amount = screen.getByRole('spinbutton')
    await user.clear(amount)
    await user.type(amount, '30')
    expect(mocks.apply).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'buckets.actions.review' }))
    expect(await screen.findByText('buckets.preview.title')).toBeInTheDocument()
    expect(mocks.preview).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'buckets.actions.applyCorrection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bucket correction preview is stale.'
    )
    expect(screen.getByRole('button', { name: 'buckets.actions.review' })).toBeInTheDocument()
  })
})
