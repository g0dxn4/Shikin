import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { classificationCatalog } from '@shikin/finance-core'
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
        type_revision_id: null,
      },
      classificationDisplay: {
        name: 'earned_income',
        version: null,
        revisionId: null,
      },
    },
  ],
  classificationTypes: classificationCatalog([], []),
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
    await user.selectOptions(roles[0], 'builtin:refund')
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

  it('submits an active custom type by ID and revision without also sending its role', async () => {
    const customCatalog = classificationCatalog(
      [
        {
          id: 'custom-income',
          current_revision_id: 'custom-income-v2',
          archived: 0,
          created_at: '2026-01-01',
          updated_at: '2026-02-01',
        },
      ],
      [
        {
          id: 'custom-income-v2',
          type_id: 'custom-income',
          version: 2,
          name: 'Family support with a deliberately long custom classification name',
          financial_treatment: 'other_income',
          created_at: '2026-02-01',
        },
      ]
    )
    mockRead.mockResolvedValue({
      ...context,
      classificationTypes: customCatalog,
      allocations: [context.allocations[0]],
    })
    const user = userEvent.setup()
    render(<ConsumptionClassificationDialog transactionId="refund" open onOpenChange={vi.fn()} />)

    const select = await screen.findByLabelText('fields.role')
    expect(screen.getByRole('option', { name: 'roles.other_income' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'roles.principal_recovery' })).toBeInTheDocument()
    await user.selectOptions(select, 'custom:custom-income:custom-income-v2')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({
        transactionId: 'refund',
        splitId: 'split-one',
        customTypeId: 'custom-income',
        expectedRevisionId: 'custom-income-v2',
        referencedPurchaseId: null,
      })
    )
    expect(mockSet.mock.calls[0]?.[0]).not.toHaveProperty('role')
  })

  it('shows an old pinned custom name without selecting a revised or archived head', async () => {
    const revisedCatalog = classificationCatalog(
      [
        {
          id: 'custom-income',
          current_revision_id: 'custom-income-v2',
          archived: 0,
          created_at: '2026-01-01',
          updated_at: '2026-02-01',
        },
      ],
      [
        {
          id: 'custom-income-v2',
          type_id: 'custom-income',
          version: 2,
          name: 'Current renamed type',
          financial_treatment: 'other_income',
          created_at: '2026-02-01',
        },
      ]
    )
    mockRead.mockResolvedValue({
      ...context,
      classificationTypes: revisedCatalog,
      allocations: [
        {
          ...context.allocations[0],
          classification: {
            id: 'old-assignment',
            transaction_id: 'refund',
            split_id: 'split-one',
            role: 'other_income',
            referenced_purchase_id: null,
            type_revision_id: 'custom-income-v1',
          },
          classificationDisplay: {
            name: 'Old family support name',
            version: 1,
            revisionId: 'custom-income-v1',
          },
        },
      ],
    })
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ConsumptionClassificationDialog transactionId="refund" open onOpenChange={onOpenChange} />
    )

    expect(
      await screen.findByText((_, element) =>
        Boolean(
          element?.tagName === 'P' && element.textContent?.includes('Old family support name')
        )
      )
    ).toBeInTheDocument()
    expect(screen.getByText('fields.historicalAssignment')).toBeInTheDocument()
    expect(screen.getByLabelText('fields.role')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'actions.done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockClear).not.toHaveBeenCalled()
  })

  it('keeps an archived custom assignment pinned and unselectable', async () => {
    mockRead.mockResolvedValue({
      ...context,
      classificationTypes: classificationCatalog([], []),
      allocations: [
        {
          ...context.allocations[0],
          classification: {
            id: 'archived-assignment',
            transaction_id: 'refund',
            split_id: 'split-one',
            role: 'principal_recovery',
            referenced_purchase_id: null,
            type_revision_id: 'archived-v3',
          },
          classificationDisplay: {
            name: 'Archived principal receipts',
            version: 3,
            revisionId: 'archived-v3',
          },
        },
      ],
    })
    render(<ConsumptionClassificationDialog transactionId="refund" open onOpenChange={vi.fn()} />)

    expect(
      await screen.findByText((_, element) =>
        Boolean(
          element?.tagName === 'P' && element.textContent?.includes('Archived principal receipts')
        )
      )
    ).toBeInTheDocument()
    expect(screen.getByLabelText('fields.role')).toHaveValue('')
    expect(
      screen.queryByRole('option', { name: 'Archived principal receipts' })
    ).not.toBeInTheDocument()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('offers asset acquisition only for expenses and does not invent purchase references', async () => {
    mockRead.mockResolvedValue({
      ...context,
      transaction: { ...context.transaction, type: 'expense' },
      allocations: [context.allocations[0]],
      purchaseOptions: [],
    })
    const user = userEvent.setup()
    render(<ConsumptionClassificationDialog transactionId="refund" open onOpenChange={vi.fn()} />)

    const select = await screen.findByLabelText('fields.role')
    expect(screen.getByRole('option', { name: 'roles.asset_acquisition' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'roles.other_income' })).not.toBeInTheDocument()
    await user.selectOptions(select, 'builtin:asset_acquisition')
    expect(screen.queryByLabelText('fields.purchase')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({
        transactionId: 'refund',
        splitId: 'split-one',
        role: 'asset_acquisition',
        referencedPurchaseId: null,
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

  it('constrains long labels and amounts to wrapping grid tracks', async () => {
    mockRead.mockResolvedValue({
      ...context,
      transaction: {
        ...context.transaction,
        description:
          'QA staged legacy transaction with deliberately verbose merchant label for modal and row stress',
        amount: 987654321,
      },
      allocations: [
        {
          ...context.allocations[0],
          amountCentavos: 987654321,
          categoryName: 'Other Expenses with an unusually long category label for layout stress',
        },
      ],
    })
    render(<ConsumptionClassificationDialog transactionId="refund" open onOpenChange={vi.fn()} />)
    expect(
      await screen.findByText(
        'QA staged legacy transaction with deliberately verbose merchant label for modal and row stress'
      )
    ).toBeInTheDocument()
    expect(screen.getAllByText('$9,876,543.21').length).toBeGreaterThan(0)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/grid-cols-\[minmax\(0,1fr\)\]/)
    expect(dialog.className).toContain('min-w-0')
    expect(screen.getByRole('button', { name: 'actions.save' }).className).toMatch(/max-w-full/)
    expect(screen.getByLabelText('fields.role').className).toMatch(/min-w-0/)
    expect(screen.getByLabelText('fields.role').className).toMatch(/max-w-full/)
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
