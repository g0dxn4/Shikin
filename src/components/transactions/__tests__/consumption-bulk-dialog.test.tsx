import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClassificationCatalogEntry } from '@shikin/finance-core'
import { ConsumptionBulkDialog, type ConsumptionBulkCandidate } from '../consumption-bulk-dialog'
import {
  applyConsumptionClassifications,
  listClassificationTypes,
  previewConsumptionClassifications,
  type ConsumptionClassificationBatchPreview,
} from '@/lib/classification-type-service'
import { readConsumptionClassificationContext } from '@/lib/consumption-service'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/classification-type-service', () => ({
  listClassificationTypes: vi.fn(),
  previewConsumptionClassifications: vi.fn(),
  applyConsumptionClassifications: vi.fn(),
}))
vi.mock('@/lib/consumption-service', () => ({
  readConsumptionClassificationContext: vi.fn(),
}))

const mockList = vi.mocked(listClassificationTypes)
const mockRead = vi.mocked(readConsumptionClassificationContext)
const mockPreview = vi.mocked(previewConsumptionClassifications)
const mockApply = vi.mocked(applyConsumptionClassifications)

const contribution = {
  consumptionCentavos: 0,
  earnedIncomeCentavos: 0,
  otherIncomeCentavos: 0,
  principalRecoveryCentavos: 0,
  assetAcquisitionCentavos: 0,
}

function definition(
  overrides: Partial<ClassificationCatalogEntry> & Pick<ClassificationCatalogEntry, 'id' | 'role'>
): ClassificationCatalogEntry {
  return {
    kind: 'builtin',
    revisionId: null,
    version: null,
    name: overrides.role,
    archived: false,
    direction: 'expense',
    requiresPurchase: false,
    contribution,
    guidance: 'Server catalog guidance',
    ...overrides,
  }
}

const catalog: ClassificationCatalogEntry[] = [
  definition({ id: 'purchase', role: 'purchase' }),
  definition({
    id: 'refund',
    role: 'refund',
    direction: 'income',
    requiresPurchase: true,
  }),
  definition({
    id: 'custom-loan',
    kind: 'custom',
    revisionId: 'revision-7',
    version: 7,
    name: 'Family loan return',
    role: 'principal_recovery',
    direction: 'income',
  }),
]

const candidates: ConsumptionBulkCandidate[] = [
  {
    id: 'split-income',
    description: 'Split income record',
    date: '2026-03-01',
    currency: 'USD',
    type: 'income',
    amount: 500,
  },
  {
    id: 'expense-eur',
    description: 'Euro expense record',
    date: '2026-03-02',
    currency: 'EUR',
    type: 'expense',
    amount: 900,
  },
]

const splitContext = {
  transaction: {
    id: 'split-income',
    type: 'income',
    amount: 500,
    currency: 'USD',
    description: 'Split income record',
    date: '2026-03-01',
  },
  allocations: [
    {
      transactionId: 'split-income',
      splitId: 'real-split-a',
      amountCentavos: 200,
      categoryId: 'one',
      categoryName: 'One',
      classification: {
        id: 'old-assignment',
        transaction_id: 'split-income',
        split_id: 'real-split-a',
        role: 'other_income' as const,
        referenced_purchase_id: null,
        type_revision_id: 'old-revision',
      },
      classificationDisplay: {
        name: 'Old immutable label',
        version: 2,
        revisionId: 'old-revision',
      },
    },
    {
      transactionId: 'split-income',
      splitId: 'real-split-b',
      amountCentavos: 300,
      categoryId: 'two',
      categoryName: 'Two',
      classification: null,
      classificationDisplay: null,
    },
  ],
  purchaseOptions: [
    {
      classificationId: 'confirmed-purchase',
      transactionId: 'purchase-tx',
      splitId: null,
      description: 'Confirmed original',
      date: '2026-02-01',
      amountCentavos: 1000,
      currency: 'USD',
      categoryId: 'shopping',
      categoryName: 'Shopping',
    },
  ],
  classificationTypes: catalog,
}

function previewResult(
  overrides: Partial<ConsumptionClassificationBatchPreview> = {}
): ConsumptionClassificationBatchPreview {
  return {
    revision: 12,
    previewToken: 'review-token',
    applicable: true,
    changed: true,
    errors: [],
    guidance: 'Review the server-resolved effects.',
    items: [
      {
        target: { transactionId: 'split-income', splitId: 'real-split-a' },
        before: splitContext.allocations[0].classification,
        after: {
          id: '__preview__',
          transaction_id: 'split-income',
          split_id: 'real-split-a',
          role: 'principal_recovery',
          referenced_purchase_id: null,
          type_revision_id: 'revision-7',
        },
        resolved: {
          role: 'principal_recovery',
          typeId: 'custom-loan',
          revisionId: 'revision-7',
          version: 7,
          name: 'Family loan return',
          contribution: { ...contribution, principalRecoveryCentavos: 200 },
        },
        amountCentavos: 200,
        source: {
          transaction: splitContext.transaction,
          split: {
            id: 'real-split-a',
            transaction_id: 'split-income',
            amount: 200,
            category_id: 'one',
          },
          currency: 'USD',
        },
        errors: [],
        changed: true,
      },
    ],
    ...overrides,
  } as ConsumptionClassificationBatchPreview
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('ConsumptionBulkDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockList.mockResolvedValue({
      definitions: catalog,
      types: [
        {
          id: 'custom-loan',
          current_revision_id: 'revision-7',
          archived: 0,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      revisions: [
        {
          id: 'old-revision',
          type_id: 'custom-loan',
          version: 2,
          name: 'Old immutable label',
          financial_treatment: 'other_income',
          created_at: '2026-01-01',
        },
        {
          id: 'revision-7',
          type_id: 'custom-loan',
          version: 7,
          name: 'Family loan return',
          financial_treatment: 'principal_recovery',
          created_at: '2026-02-01',
        },
      ],
    })
    mockRead.mockResolvedValue(splitContext)
    mockPreview.mockResolvedValue(previewResult())
    mockApply.mockResolvedValue({
      ...previewResult(),
      batchId: 'batch-1',
      items: [
        {
          ...previewResult().items[0],
          after: {
            id: 'actual-assignment-id',
            transaction_id: 'split-income',
            split_id: 'real-split-a',
            role: 'principal_recovery',
            referenced_purchase_id: null,
            type_revision_id: 'revision-7',
          },
        },
      ],
    })
  })

  it('starts with zero allocations, loads only expanded rows, and keeps real split IDs partial', async () => {
    const user = userEvent.setup()
    render(
      <ConsumptionBulkDialog
        open
        candidates={candidates}
        onOpenChange={vi.fn()}
        onChanged={vi.fn()}
      />
    )

    expect(screen.getByText('bulk.selection.count')).toBeVisible()
    expect(mockRead).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    const allocations = await screen.findAllByRole('checkbox')
    expect(allocations).toHaveLength(2)
    expect(allocations[0]).not.toBeChecked()
    expect(allocations[1]).not.toBeChecked()
    expect(screen.getByText('real-split-a')).toBeVisible()
    expect(screen.getByText('real-split-b')).toBeVisible()
    expect(screen.getByText('bulk.candidates.currentCustom')).toBeVisible()

    await user.click(allocations[1])
    expect(screen.getAllByLabelText('bulk.treatment.override')).toHaveLength(1)
    expect(screen.getByText(/real-split-b/)).toBeVisible()
    expect(screen.queryByText(/real-split-a/, { selector: 'p' })).not.toBeInTheDocument()
  })

  it('snapshots the visible page per open session and clears selection when reopened', async () => {
    const user = userEvent.setup()
    const changed = [{ ...candidates[1], id: 'new-page', description: 'New filtered page row' }]
    const { rerender } = render(
      <ConsumptionBulkDialog open candidates={candidates} onOpenChange={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    await user.click((await screen.findAllByRole('checkbox'))[0])

    rerender(<ConsumptionBulkDialog open candidates={changed} onOpenChange={vi.fn()} />)
    expect(screen.getAllByText('Split income record').length).toBeGreaterThan(0)
    expect(screen.queryByText('New filtered page row')).not.toBeInTheDocument()

    rerender(<ConsumptionBulkDialog open={false} candidates={changed} onOpenChange={vi.fn()} />)
    rerender(<ConsumptionBulkDialog open candidates={changed} onOpenChange={vi.fn()} />)
    expect(await screen.findByText('New filtered page row')).toBeVisible()
    expect(screen.queryByText('Split income record')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('enforces the 100-allocation cap without auto-selecting overflow', async () => {
    const manyContext = {
      ...splitContext,
      allocations: Array.from({ length: 101 }, (_, index) => ({
        transactionId: 'split-income',
        splitId: `persisted-split-${index}`,
        amountCentavos: 1,
        categoryId: null,
        categoryName: null,
        classification: null,
      })),
    }
    mockRead.mockResolvedValueOnce(manyContext)
    const user = userEvent.setup()
    render(<ConsumptionBulkDialog open candidates={[candidates[0]]} onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    const allocations = await screen.findAllByRole('checkbox')
    allocations.slice(0, 100).forEach((allocation) => fireEvent.click(allocation))

    expect(
      allocations.filter((allocation) => (allocation as HTMLInputElement).checked)
    ).toHaveLength(100)
    expect(allocations[100]).toBeDisabled()
    expect(allocations[100]).not.toBeChecked()
  })

  it('pins custom revisions, keeps references per allocation, suppresses stale previews, and applies the exact reviewed payload once', async () => {
    const firstPreview = deferred<ReturnType<typeof previewResult>>()
    mockPreview.mockImplementationOnce(() => firstPreview.promise as never)
    const apply = deferred<Awaited<ReturnType<typeof applyConsumptionClassifications>>>()
    mockApply.mockImplementationOnce(() => apply.promise)
    const onChanged = vi.fn()
    const user = userEvent.setup()
    render(
      <ConsumptionBulkDialog
        open
        candidates={[candidates[0]]}
        onOpenChange={vi.fn()}
        onChanged={onChanged}
      />
    )
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    const allocations = await screen.findAllByRole('checkbox')
    await user.click(allocations[0])
    await user.click(allocations[1])
    const treatments = screen.getAllByLabelText('bulk.treatment.override')
    await user.selectOptions(treatments[0], 'custom:custom-loan:revision-7')
    await user.selectOptions(treatments[1], 'builtin:refund')
    await user.selectOptions(screen.getByLabelText('bulk.treatment.purchase'), 'confirmed-purchase')

    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))
    await user.type(screen.getByLabelText('bulk.auditNote.label'), 'Reviewed mixed batch')
    firstPreview.resolve(previewResult())
    await Promise.resolve()
    expect(screen.queryByText('bulk.preview.title')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))
    expect(await screen.findByText('bulk.preview.title')).toBeVisible()
    const exactTargets = [
      {
        transactionId: 'split-income',
        splitId: 'real-split-a',
        referencedPurchaseId: null,
        customTypeId: 'custom-loan',
        expectedRevisionId: 'revision-7',
      },
      {
        transactionId: 'split-income',
        splitId: 'real-split-b',
        referencedPurchaseId: 'confirmed-purchase',
        builtinRole: 'refund',
      },
    ]
    expect(mockPreview).toHaveBeenLastCalledWith(exactTargets)

    await user.click(screen.getByLabelText('bulk.preview.confirm'))
    const applyButton = screen.getByRole('button', { name: 'bulk.actions.apply' })
    await user.click(applyButton)
    await user.click(applyButton)
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith({
      targets: exactTargets,
      previewToken: 'review-token',
      auditNote: 'Reviewed mixed batch',
    })
    expect(onChanged).not.toHaveBeenCalled()

    apply.resolve({
      ...previewResult(),
      batchId: 'batch-1',
      items: [
        {
          ...previewResult().items[0],
          after: {
            id: 'actual-assignment-id',
            transaction_id: 'split-income',
            split_id: 'real-split-a',
            role: 'principal_recovery',
            referenced_purchase_id: null,
            type_revision_id: 'revision-7',
          },
        },
      ],
    })
    expect(await screen.findByText('actual-assignment-id')).toBeVisible()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'bulk.actions.apply' })).not.toBeInTheDocument()
  })

  it('suppresses a delayed preview after the dialog session closes', async () => {
    const pending = deferred<ConsumptionClassificationBatchPreview>()
    mockPreview.mockReturnValueOnce(pending.promise)
    const user = userEvent.setup()
    const { rerender } = render(
      <ConsumptionBulkDialog open candidates={[candidates[0]]} onOpenChange={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    await user.click((await screen.findAllByRole('checkbox'))[0])
    await user.selectOptions(
      screen.getByLabelText('bulk.treatment.override'),
      'custom:custom-loan:revision-7'
    )
    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))

    rerender(
      <ConsumptionBulkDialog open={false} candidates={[candidates[0]]} onOpenChange={vi.fn()} />
    )
    pending.resolve(previewResult())
    await Promise.resolve()
    rerender(<ConsumptionBulkDialog open candidates={[candidates[1]]} onOpenChange={vi.fn()} />)

    expect(await screen.findByText('Euro expense record')).toBeVisible()
    expect(screen.queryByText('bulk.preview.title')).not.toBeInTheDocument()
  })

  it('shows mixed-currency source facts, all five server effects, and item/global errors', async () => {
    const invalid = previewResult({
      applicable: false,
      changed: false,
      errors: ['Global capacity conflict'],
      items: [
        previewResult().items[0],
        {
          ...previewResult().items[0],
          target: { transactionId: 'expense-eur', splitId: null },
          before: null,
          amountCentavos: 900,
          source: {
            transaction: {
              id: 'expense-eur',
              type: 'expense',
              amount: 900,
              currency: 'EUR',
              description: 'Euro expense record',
              date: '2026-03-02',
            },
            split: null,
            currency: 'EUR',
          },
          resolved: {
            role: 'asset_acquisition',
            typeId: null,
            revisionId: null,
            version: null,
            name: 'asset_acquisition',
            contribution: { ...contribution, assetAcquisitionCentavos: 900 },
          },
          errors: ['Protected evidence conflict'],
          changed: false,
        },
      ],
    })
    mockPreview.mockResolvedValueOnce(invalid as never)
    mockRead.mockImplementation(async (id) =>
      id === 'split-income'
        ? splitContext
        : {
            ...splitContext,
            transaction: {
              id: 'expense-eur',
              type: 'expense',
              amount: 900,
              currency: 'EUR',
              description: 'Euro expense record',
              date: '2026-03-02',
            },
            allocations: [
              {
                transactionId: 'expense-eur',
                splitId: null,
                amountCentavos: 900,
                categoryId: null,
                categoryName: null,
                classification: null,
              },
            ],
          }
    )
    const user = userEvent.setup()
    render(<ConsumptionBulkDialog open candidates={candidates} onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    await user.click((await screen.findAllByRole('checkbox'))[0])
    await user.click(screen.getByRole('button', { name: /Euro expense record/ }))
    await user.click((await screen.findAllByRole('checkbox'))[2])
    const treatments = screen.getAllByLabelText('bulk.treatment.override')
    await user.selectOptions(treatments[0], 'custom:custom-loan:revision-7')
    await user.selectOptions(treatments[1], 'builtin:purchase')
    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))

    expect(await screen.findByText('Global capacity conflict')).toBeVisible()
    expect(screen.getByText('Protected evidence conflict')).toBeVisible()
    expect(screen.getAllByText('Euro expense record').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(0)
    for (const label of [
      'bulk.effects.consumption',
      'bulk.effects.earnedIncome',
      'bulk.effects.otherIncome',
      'bulk.effects.principalRecovery',
      'bulk.effects.assetAcquisition',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole('button', { name: 'bulk.actions.apply' })).toBeDisabled()
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('reports no-op previews without applying and requires a new preview after stale apply', async () => {
    const user = userEvent.setup()
    mockPreview.mockResolvedValueOnce(previewResult({ changed: false }))
    render(<ConsumptionBulkDialog open candidates={[candidates[0]]} onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    await user.click((await screen.findAllByRole('checkbox'))[0])
    await user.selectOptions(
      screen.getByLabelText('bulk.treatment.override'),
      'custom:custom-loan:revision-7'
    )
    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))
    expect(await screen.findByText('bulk.preview.noChanges')).toBeVisible()
    expect(screen.getByRole('button', { name: 'bulk.actions.apply' })).toBeDisabled()
    expect(mockApply).not.toHaveBeenCalled()

    mockPreview.mockResolvedValueOnce(previewResult())
    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))
    await user.click(await screen.findByLabelText('bulk.preview.confirm'))
    mockApply.mockRejectedValueOnce(new Error('Classification preview is stale.'))
    await user.click(screen.getByRole('button', { name: 'bulk.actions.apply' }))
    expect(await screen.findByText('Classification preview is stale.')).toBeVisible()
    expect(screen.queryByText('bulk.preview.title')).not.toBeInTheDocument()
    expect(mockPreview).toHaveBeenCalledTimes(2)
    expect(mockApply).toHaveBeenCalledTimes(1)
  })

  it('uses a bounded short-viewport dialog layout', () => {
    mockList.mockReturnValueOnce(new Promise(() => {}))
    render(<ConsumptionBulkDialog open candidates={candidates} onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('max-h-[calc(100dvh-1rem)]', 'overflow-hidden', 'min-w-0')
    expect(dialog.className).toMatch(/grid-rows-\[auto_minmax\(0,1fr\)_auto\]/)
  })
})
