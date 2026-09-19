import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConsumptionClassificationDialog } from '../consumption-classification-dialog'
import {
  clearConsumptionClassification,
  readConsumptionClassificationContext,
  setConsumptionClassification,
} from '@/lib/consumption-service'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/consumption-service', () => ({
  readConsumptionClassificationContext: vi.fn(),
  setConsumptionClassification: vi.fn(),
  clearConsumptionClassification: vi.fn(),
}))

const mockRead = vi.mocked(readConsumptionClassificationContext)
const mockSet = vi.mocked(setConsumptionClassification)
const mockClear = vi.mocked(clearConsumptionClassification)

const context = {
  transaction: {
    id: 'refund',
    type: 'income',
    amount: 500,
    currency: 'USD',
    description: 'Synthetic refund',
    date: '2026-02-01',
  },
  allocations: [
    {
      transactionId: 'refund',
      splitId: 'split-one',
      amountCentavos: 200,
      categoryId: 'other',
      categoryName: 'Other',
      classification: null,
    },
    {
      transactionId: 'refund',
      splitId: 'split-two',
      amountCentavos: 300,
      categoryId: 'other',
      categoryName: 'Other',
      classification: {
        id: 'classification-two',
        transaction_id: 'refund',
        split_id: 'split-two',
        role: 'earned_income' as const,
        referenced_purchase_id: null,
      },
    },
  ],
  purchaseOptions: [
    {
      classificationId: 'purchase-classification',
      transactionId: 'purchase',
      splitId: null,
      description: 'Synthetic purchase',
      date: '2026-01-01',
      amountCentavos: 1000,
      currency: 'USD',
      categoryId: 'food',
      categoryName: 'Food',
    },
  ],
}

describe('ConsumptionClassificationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRead.mockResolvedValue(context)
    mockSet.mockResolvedValue({
      id: 'new-classification',
      transaction_id: 'refund',
      split_id: 'split-one',
      role: 'refund',
      referenced_purchase_id: 'purchase-classification',
    })
    mockClear.mockResolvedValue(true)
  })

  it('renders split allocations separately and requires an explicit purchase selection', async () => {
    const user = userEvent.setup()
    render(<ConsumptionClassificationDialog transactionId="refund" open onOpenChange={vi.fn()} />)
    expect(await screen.findAllByText('allocation.split')).toHaveLength(2)
    const roles = screen.getAllByLabelText('fields.role')
    await user.selectOptions(roles[0], 'refund')
    await user.click(screen.getAllByRole('button', { name: 'actions.save' })[0])
    expect(screen.getByRole('alert')).toHaveTextContent('errors.purchaseRequired')
    expect(mockSet).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('fields.purchase'), 'purchase-classification')
    await user.click(screen.getAllByRole('button', { name: 'actions.save' })[0])
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({
        transactionId: 'refund',
        splitId: 'split-one',
        role: 'refund',
        referencedPurchaseId: 'purchase-classification',
      })
    )
  })

  it('clears explicitly and surfaces dependent-reference errors', async () => {
    mockClear.mockRejectedValueOnce(
      new Error('Clear referencing refund/principal classifications first.')
    )
    const user = userEvent.setup()
    render(<ConsumptionClassificationDialog transactionId="refund" open onOpenChange={vi.fn()} />)
    await screen.findAllByText('allocation.split')
    await user.click(screen.getByRole('button', { name: 'actions.clear' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Clear referencing/)
    expect(screen.getByRole('alert')).toHaveTextContent('errors.clearDependents')
  })

  it('ignores a stale response after the selected transaction changes', async () => {
    let resolveFirst!: (value: typeof context) => void
    mockRead
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({
        ...context,
        transaction: { ...context.transaction, id: 'new', description: 'New response' },
      })
    const { rerender } = render(
      <ConsumptionClassificationDialog transactionId="old" open onOpenChange={vi.fn()} />
    )
    rerender(<ConsumptionClassificationDialog transactionId="new" open onOpenChange={vi.fn()} />)
    expect(await screen.findByText('New response')).toBeInTheDocument()
    resolveFirst({
      ...context,
      transaction: { ...context.transaction, id: 'old', description: 'Stale response' },
    })
    await Promise.resolve()
    expect(screen.queryByText('Stale response')).not.toBeInTheDocument()
  })
})
