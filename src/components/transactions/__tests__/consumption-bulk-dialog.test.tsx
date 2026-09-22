import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClassificationCatalogEntry } from '@shikin/finance-core'
import esConsumption from '@/i18n/locales/es/consumption.json'
import { ConsumptionBulkDialog, type ConsumptionBulkCandidate } from '../consumption-bulk-dialog'
import {
  applyConsumptionClassifications,
  listClassificationTypes,
  previewConsumptionClassifications,
  type ConsumptionClassificationBatchPreview,
} from '@/lib/classification-type-service'
import { readConsumptionClassificationContext } from '@/lib/consumption-service'

const translationState = vi.hoisted(() => ({ language: 'keys' as 'keys' | 'es' }))

vi.mock('react-i18next', async () => {
  const { default: spanish } = await import('@/i18n/locales/es/consumption.json')
  return {
    useTranslation: () => ({
      t: (key: string) => {
        if (
          translationState.language !== 'es' ||
          (!key.startsWith('guidance.') && key !== 'bulk.preview.guidance')
        )
          return key
        let value: unknown = spanish
        for (const segment of key.split('.')) {
          if (!value || typeof value !== 'object') return key
          value = (value as Record<string, unknown>)[segment]
        }
        return typeof value === 'string' ? value : key
      },
    }),
  }
})
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
  definition({ id: 'asset_acquisition', role: 'asset_acquisition' }),
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
    translationState.language = 'keys'
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

  it('uses fresh context facts and normalizes padded native currency for loaded allocations', async () => {
    const staleCandidate: ConsumptionBulkCandidate = {
      id: 'changed-owner',
      description: 'Stale USD candidate',
      date: '2026-03-01',
      currency: 'USD',
      type: 'income',
      amount: 100,
    }
    mockRead.mockResolvedValueOnce({
      ...splitContext,
      transaction: {
        id: 'changed-owner',
        type: 'expense',
        amount: 200,
        currency: ' eur ',
        description: 'Fresh EUR owner',
        date: '2026-04-02',
      },
      allocations: [
        {
          transactionId: 'changed-owner',
          splitId: 'fresh-split',
          amountCentavos: 200,
          categoryId: 'fresh-category',
          categoryName: 'Fresh category',
          classification: null,
          classificationDisplay: null,
        },
      ],
    })
    const user = userEvent.setup()
    render(<ConsumptionBulkDialog open candidates={[staleCandidate]} onOpenChange={vi.fn()} />)

    expect(screen.getByText('$1.00')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Stale USD candidate/ }))
    const allocation = await screen.findByRole('checkbox')
    expect(screen.getAllByText('€2.00').length).toBeGreaterThanOrEqual(2)

    await user.click(allocation)
    expect(screen.getAllByText('Fresh EUR owner').length).toBeGreaterThan(0)
    expect(screen.getByText(/2026-04-02 · EUR · bulk.candidates.splitId/)).toBeVisible()
    expect(screen.getAllByText('€2.00').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('$2.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/200\s+eur/i)).not.toBeInTheDocument()
  })

  it('shows unavailable instead of treating unknown-currency centavos as currency units', () => {
    mockList.mockReturnValueOnce(new Promise(() => {}))
    render(
      <ConsumptionBulkDialog
        open
        candidates={[
          {
            id: 'unknown-currency',
            description: 'Unknown native currency',
            date: '2026-04-03',
            currency: 'foo',
            type: 'expense',
            amount: 100,
          },
        ]}
        onOpenChange={vi.fn()}
      />
    )

    const candidateButton = screen.getByRole('button', { name: /Unknown native currency/ })
    expect(candidateButton).toHaveTextContent('—')
    expect(candidateButton).not.toHaveTextContent(/100\s+foo|FOO\s*1[.,]00/i)
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

  it('freezes and cannot dismiss a pending apply, then restores focus from Done', async () => {
    const apply = deferred<Awaited<ReturnType<typeof applyConsumptionClassifications>>>()
    mockApply.mockReturnValueOnce(apply.promise)
    const onChanged = vi.fn()
    const onOpenChange = vi.fn()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open bulk dialog
          </button>
          <ConsumptionBulkDialog
            open={open}
            candidates={[candidates[0]]}
            onOpenChange={(nextOpen) => {
              onOpenChange(nextOpen)
              setOpen(nextOpen)
            }}
            onChanged={onChanged}
          />
        </>
      )
    }

    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open bulk dialog' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    const allocation = (await screen.findAllByRole('checkbox'))[0]
    await user.click(allocation)
    const treatment = screen.getByLabelText('bulk.treatment.override')
    await user.selectOptions(treatment, 'builtin:refund')
    const reference = screen.getByLabelText('bulk.treatment.purchase')
    await user.selectOptions(reference, 'confirmed-purchase')
    const note = screen.getByLabelText('bulk.auditNote.label')
    await user.type(note, 'Immutable reviewed note')
    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))
    await user.click(await screen.findByLabelText('bulk.preview.confirm'))

    const applyButton = screen.getByRole('button', { name: 'bulk.actions.apply' })
    fireEvent.click(applyButton)
    fireEvent.click(applyButton)

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith({
      targets: [
        {
          transactionId: 'split-income',
          splitId: 'real-split-a',
          referencedPurchaseId: 'confirmed-purchase',
          builtinRole: 'refund',
        },
      ],
      previewToken: 'review-token',
      auditNote: 'Immutable reviewed note',
    })
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('bulk.actions.applying')
    expect(allocation).toBeDisabled()
    expect(treatment).toBeDisabled()
    expect(reference).toBeDisabled()
    expect(note).toBeDisabled()
    expect(screen.getByLabelText('bulk.preview.confirm')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'bulk.actions.preview' })).toBeDisabled()

    fireEvent.click(allocation)
    fireEvent.change(treatment, { target: { value: 'builtin:purchase' } })
    fireEvent.change(reference, { target: { value: '' } })
    fireEvent.change(note, { target: { value: 'Changed while pending' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    const overlay = screen.getByRole('dialog').previousElementSibling
    expect(overlay).not.toBeNull()
    fireEvent.pointerDown(overlay!, { button: 0, pointerType: 'mouse' })
    fireEvent.click(overlay!)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByRole('dialog')).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(allocation).toBeChecked()
    expect(treatment).toHaveValue('builtin:refund')
    expect(reference).toHaveValue('confirmed-purchase')
    expect(note).toHaveValue('Immutable reviewed note')
    expect(mockApply).toHaveBeenCalledTimes(1)

    apply.resolve({
      ...previewResult(),
      batchId: 'batch-locked',
      items: [
        {
          ...previewResult().items[0],
          after: {
            id: 'locked-assignment-id',
            transaction_id: 'split-income',
            split_id: 'real-split-a',
            role: 'refund',
            referenced_purchase_id: 'confirmed-purchase',
            type_revision_id: null,
          },
        },
      ],
    })

    expect(await screen.findByText('locked-assignment-id')).toBeVisible()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(allocation).toBeDisabled()
    expect(treatment).toBeDisabled()
    expect(reference).toBeDisabled()
    expect(note).toBeDisabled()
    const done = screen.getByRole('button', { name: 'bulk.actions.done' })
    expect(done).toBeEnabled()
    await user.click(done)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('localizes fixed-role and generic preview guidance in Spanish while preserving custom names', async () => {
    translationState.language = 'es'
    const user = userEvent.setup()
    render(<ConsumptionBulkDialog open candidates={[candidates[0]]} onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Split income record/ }))
    await user.click((await screen.findAllByRole('checkbox'))[0])
    await user.selectOptions(
      screen.getByLabelText('bulk.treatment.override'),
      'custom:custom-loan:revision-7'
    )

    expect(
      screen.getByText(esConsumption.guidance.principal_recovery, { exact: false })
    ).toBeVisible()
    expect(screen.getAllByRole('option', { name: /Family loan return/ }).length).toBeGreaterThan(0)

    await user.selectOptions(
      screen.getByLabelText('bulk.treatment.override'),
      'builtin:asset_acquisition'
    )
    expect(
      screen.getByText(esConsumption.guidance.asset_acquisition, { exact: false })
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'bulk.actions.preview' }))
    expect(await screen.findByText(esConsumption.bulk.preview.guidance)).toBeVisible()
    expect(screen.queryByText('Review the server-resolved effects.')).not.toBeInTheDocument()
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
