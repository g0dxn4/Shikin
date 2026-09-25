import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionDialog } from '../transaction-dialog'
import type { TransactionPageRow } from '@/lib/transaction-query'
import { classificationCatalog } from '@shikin/finance-core'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    onConfirm,
    onOpenChange,
    isLoading,
  }: {
    open: boolean
    title: string
    onConfirm: () => void
    onOpenChange: (open: boolean) => void
    isLoading?: boolean
  }) =>
    open ? (
      <div data-testid="discard-confirm">
        <span>{title}</span>
        <button disabled={isLoading} onClick={onConfirm}>
          Confirm action
        </button>
        <button disabled={isLoading} onClick={() => onOpenChange(false)}>
          Cancel action
        </button>
      </div>
    ) : null,
}))

const { mockReadIdentity, mockPreviewIdentity, mockBindIdentity } = vi.hoisted(() => ({
  mockReadIdentity: vi.fn(),
  mockPreviewIdentity: vi.fn(),
  mockBindIdentity: vi.fn(),
}))
vi.mock('@/lib/import-identity-service', () => ({
  readLegacyImportIdentityTransaction: mockReadIdentity,
  previewLegacyImportIdentity: mockPreviewIdentity,
  bindLegacyImportIdentity: mockBindIdentity,
}))
const mockCloseTransactionDialog = vi.fn()
const mockOpenTransactionDialog = vi.fn()
const { mockReadConsumptionContext, mockSetConsumption } = vi.hoisted(() => ({
  mockReadConsumptionContext: vi.fn(),
  mockSetConsumption: vi.fn(),
}))
vi.mock('@/lib/consumption-service', () => ({
  readConsumptionClassificationContext: mockReadConsumptionContext,
  setConsumptionClassification: mockSetConsumption,
  clearConsumptionClassification: vi.fn(),
}))
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockCorrectMetadata = vi.fn()
const mockRemove = vi.fn()
const mockGetTransactionById = vi.fn()
const mockInvalidateTransactionPage = vi.fn()

let mockEditingTransactionId: string | null = null

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    transactionDialogOpen: true,
    editingTransactionId: mockEditingTransactionId,
    closeTransactionDialog: mockCloseTransactionDialog,
    openTransactionDialog: mockOpenTransactionDialog,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    add: mockAdd,
    addWithSplits: vi.fn(),
    update: mockUpdate,
    correctMetadata: mockCorrectMetadata,
    remove: mockRemove,
  }),
}))

vi.mock('@/lib/split-service', () => ({ getSplits: vi.fn().mockResolvedValue([]) }))

vi.mock('@/lib/transaction-query', () => ({
  getTransactionById: (id: string) => mockGetTransactionById(id),
}))

vi.mock('@/lib/transaction-fx', () => ({
  getLatestTransactionFxEvidence: vi.fn().mockResolvedValue(null),
  previewTransactionFxInput: vi.fn(),
}))

vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: (reason: string) => mockInvalidateTransactionPage(reason),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [{ id: 'acc-1', name: 'Checking', currency: 'USD' }],
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: [],
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
  }),
}))

const mockTransaction: TransactionPageRow = {
  id: 'tx-edit',
  account_id: 'acc-1',
  category_id: null,
  subcategory_id: null,
  type: 'expense',
  amount: 2500,
  currency: 'USD',
  description: 'Test expense',
  notes: null,
  date: '2024-06-15',
  tags: '',
  is_recurring: 0,
  transfer_to_account_id: null,
  created_at: '2024-06-15T00:00:00Z',
  updated_at: '2024-06-15T00:00:00Z',
  account_name: 'Checking',
  has_splits: 0,
}

describe('TransactionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCorrectMetadata.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)
    mockEditingTransactionId = null
    mockGetTransactionById.mockResolvedValue(mockTransaction)
    mockReadConsumptionContext.mockResolvedValue({
      transaction: mockTransaction,
      allocations: [
        {
          transactionId: 'tx-edit',
          splitId: null,
          amountCentavos: 2500,
          categoryId: null,
          categoryName: null,
          classification: null,
        },
      ],
      purchaseOptions: [],
      classificationTypes: classificationCatalog([], []),
    })
    mockSetConsumption.mockResolvedValue({ id: 'classification' })
    mockReadIdentity.mockResolvedValue({ ...mockTransaction, status: 'posted' })
    mockPreviewIdentity.mockResolvedValue({
      previewToken: 'token',
      binding: { importSource: 'bank', importExternalId: 'abc' },
    })
    mockBindIdentity.mockResolvedValue({ refreshIncomplete: false })
  })

  it('inspects the fetched row, protects workflow rows and permits ordinary transfers', async () => {
    mockEditingTransactionId = 'tx-edit'
    mockGetTransactionById.mockResolvedValueOnce({
      ...mockTransaction,
      transaction_kind: 'reconciliation_bridge',
      source: 'statement',
      status: 'pending',
    })
    const { unmount } = render(<TransactionDialog />)
    expect(await screen.findByText('review.protected.workflow')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'detail.readOnlyTitle' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'detail.readOnlyTitle' })).toHaveClass(
      'pr-8',
      'break-words'
    )
    expect(screen.getByText('Test expense')).toBeVisible()
    expect(screen.getByText('review.protected.workflow')).toBeVisible()
    expect(screen.getByText('statement')).toBeVisible()
    expect(screen.getByText('tx-edit')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'deleteTransaction' })).not.toBeInTheDocument()
    unmount()
    mockGetTransactionById.mockResolvedValueOnce({
      ...mockTransaction,
      type: 'transfer',
      transfer_to_account_id: 'acc-2',
    })
    render(<TransactionDialog />)
    expect(await screen.findByRole('button', { name: 'actions.save' })).toBeInTheDocument()
  })

  it('keeps ordinary inspection collapsed until requested', async () => {
    mockEditingTransactionId = 'tx-edit'
    render(<TransactionDialog />)
    const summary = await screen.findByText('detail.details')
    expect(summary).toBeVisible()
    expect(screen.getByText('ledger.source')).not.toBeVisible()
    await userEvent.setup().click(summary)
    expect(screen.getByText('ledger.source')).toBeVisible()
  })

  it.each([
    ['archived', { is_archived: 1 }],
    ['matched', { matched_transaction_id: 'other' }],
    ['receivable', { is_receivable_payment: 1 }],
    ['reconciliation', { is_reconciliation_adjustment: 1 }],
    ['completed placeholder', { is_placeholder: 1, placeholder_status: 'completed' }],
  ])('offers inspection but no generic form or delete for %s rows', async (_, patch) => {
    mockEditingTransactionId = 'tx-edit'
    mockGetTransactionById.mockResolvedValueOnce({ ...mockTransaction, ...patch })
    render(<TransactionDialog />)
    expect(await screen.findByText('tx-edit')).toBeVisible()
    expect(screen.getByText('Test expense')).toBeVisible()
    expect(screen.getByText('ledger.source')).toBeVisible()
    expect(screen.getByText('25.00', { exact: false })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'detail.readOnlyTitle' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'deleteTransaction' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'actions.classify' })).not.toBeInTheDocument()
  })

  it('keeps long references and source evidence inside the minimum-width detail track', async () => {
    const reference = '01JQFG5F2SPAYN0TM2BC3YW93G'
    mockEditingTransactionId = reference
    mockGetTransactionById.mockResolvedValueOnce({
      ...mockTransaction,
      id: reference,
      source: 'a-very-long-unbroken-source-reference-with-no-spaces',
      is_receivable_payment: 1,
    })
    render(<TransactionDialog />)
    const value = await screen.findByText(reference)
    expect(value).toBeVisible()
    expect(value).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
    expect(value.parentElement).toHaveClass('grid-cols-[110px_minmax(0,1fr)]')
    expect(screen.getByText('a-very-long-unbroken-source-reference-with-no-spaces')).toBeVisible()
  })

  it('keeps split/finalized financial fields locked and uses metadata correction', async () => {
    mockEditingTransactionId = 'tx-edit'
    mockGetTransactionById.mockResolvedValueOnce({
      ...mockTransaction,
      has_splits: 1,
      is_finalized_statement: 1,
    })
    render(<TransactionDialog />)
    const save = await screen.findByRole('button', { name: 'actions.save' })
    await userEvent.setup().click(save)
    await waitFor(() => expect(mockCorrectMetadata).toHaveBeenCalled())
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not expose secondary mutations for a dirty form', async () => {
    mockEditingTransactionId = 'tx-edit'
    render(<TransactionDialog />)
    const user = userEvent.setup()
    await user.click(await screen.findByText('detail.details'))
    expect(screen.getByRole('button', { name: 'deleteTransaction' })).toBeEnabled()
    await user.type(screen.getByLabelText('form.description'), ' changed')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'deleteTransaction' })).toBeDisabled()
    )
    expect(screen.getByText('dialog.saveOrDiscard')).toBeInTheDocument()
  })

  it('confirms deletion, invalidates on success, and retains the dialog after failure', async () => {
    mockEditingTransactionId = 'tx-edit'
    mockRemove.mockRejectedValueOnce(new Error('Denied'))
    render(<TransactionDialog />)
    const user = userEvent.setup()
    await user.click(await screen.findByText('detail.details'))
    await user.click(screen.getByRole('button', { name: 'deleteTransaction' }))
    fireEvent.click(screen.getByText('Confirm action'))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('tx-edit'))
    expect(mockCloseTransactionDialog).not.toHaveBeenCalled()
    expect(mockInvalidateTransactionPage).not.toHaveBeenCalledWith('delete')
    fireEvent.click(screen.getByText('Confirm action'))
    await waitFor(() => expect(mockInvalidateTransactionPage).toHaveBeenCalledWith('delete'))
    expect(mockCloseTransactionDialog).toHaveBeenCalled()
  })

  it('keeps classification nested under the dialog and returns focus to its launcher after save', async () => {
    mockEditingTransactionId = 'tx-edit'
    render(<TransactionDialog />)
    const user = userEvent.setup()
    await user.click(await screen.findByText('detail.details'))
    const classify = screen.getByRole('button', { name: 'actions.classify' })
    await user.click(classify)
    expect(await screen.findByRole('dialog', { name: 'dialog.title' })).toBeInTheDocument()
    await user.selectOptions(await screen.findByLabelText('fields.role'), 'builtin:purchase')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() => expect(mockSetConsumption).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'actions.done' }))
    await waitFor(() => expect(classify).toHaveFocus())
    expect(mockInvalidateTransactionPage).toHaveBeenCalledWith('review')
    expect(mockGetTransactionById).toHaveBeenCalledTimes(2)
  })

  it('uses the fetched identity projections, not missing cache fields, for legacy binding eligibility', async () => {
    mockEditingTransactionId = 'tx-edit'
    mockGetTransactionById.mockResolvedValueOnce({
      ...mockTransaction,
      import_source: null,
      import_external_id: null,
      import_fingerprint: null,
      import_content_fingerprint: null,
    })
    render(<TransactionDialog />)
    await userEvent.setup().click(await screen.findByText('detail.details'))
    expect(screen.getByRole('button', { name: 'identity.action' })).toBeInTheDocument()
  })

  it('offers legacy binding on a protected standard row only when full identity projections are unbound', async () => {
    mockEditingTransactionId = 'tx-edit'
    const protectedRow = { ...mockTransaction, is_receivable_payment: 1 }
    mockGetTransactionById.mockResolvedValueOnce({
      ...protectedRow,
      import_source: null,
      import_external_id: null,
      import_fingerprint: null,
      import_content_fingerprint: null,
    })
    const { unmount } = render(<TransactionDialog />)
    expect(await screen.findByRole('button', { name: 'identity.action' })).toBeVisible()
    expect(screen.getByText('review.protected.receivable')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'actions.classify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'deleteTransaction' })).not.toBeInTheDocument()
    unmount()
    mockGetTransactionById.mockResolvedValueOnce(protectedRow)
    render(<TransactionDialog />)
    expect(await screen.findByText('review.protected.receivable')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'identity.action' })).not.toBeInTheDocument()
  })

  it('binds a protected identity and restores focus to the read-only inspection after the launcher disappears', async () => {
    mockEditingTransactionId = 'tx-edit'
    const eligible = {
      ...mockTransaction,
      is_receivable_payment: 1,
      import_source: null,
      import_external_id: null,
      import_fingerprint: null,
      import_content_fingerprint: null,
    }
    mockGetTransactionById
      .mockResolvedValueOnce(eligible)
      .mockResolvedValue({ ...eligible, import_source: 'bank', import_external_id: 'abc' })
    render(<TransactionDialog />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'identity.action' }))
    await user.type(await screen.findByLabelText('identity.sourceNamespace'), 'bank')
    await user.type(screen.getByLabelText('identity.externalId'), 'abc')
    await user.click(screen.getByText('identity.verifiedConfirmation'))
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    await user.click(await screen.findByRole('button', { name: 'identity.confirm' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'identity.action' })).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(document.querySelector('[data-transaction-details-readonly]')).toHaveFocus()
    )
  })

  it('binds an eligible legacy identity through nested review then refreshes by ID', async () => {
    mockEditingTransactionId = 'tx-edit'
    const eligible = {
      ...mockTransaction,
      import_source: null,
      import_external_id: null,
      import_fingerprint: null,
      import_content_fingerprint: null,
    }
    mockGetTransactionById
      .mockResolvedValueOnce(eligible)
      .mockResolvedValue({ ...eligible, import_source: 'bank', import_external_id: 'abc' })
    render(<TransactionDialog />)
    const user = userEvent.setup()
    await user.click(await screen.findByText('detail.details'))
    await user.click(screen.getByRole('button', { name: 'identity.action' }))
    expect(await screen.findByRole('heading', { name: 'identity.title' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('identity.sourceNamespace'), 'bank')
    await user.type(screen.getByLabelText('identity.externalId'), 'abc')
    await user.click(screen.getByText('identity.verifiedConfirmation'))
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    await user.click(await screen.findByRole('button', { name: 'identity.confirm' }))
    await waitFor(() =>
      expect(mockBindIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: 'tx-edit', previewToken: 'token' })
      )
    )
    await waitFor(() => expect(mockGetTransactionById).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'identity.action' })).not.toBeInTheDocument()
    )
    expect(mockInvalidateTransactionPage).toHaveBeenCalledWith('review')
  })

  it('ignores stale by-ID lookup results after switching an unmodified session', async () => {
    let resolveOld!: (row: TransactionPageRow) => void
    mockEditingTransactionId = 'tx-edit'
    mockGetTransactionById
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValueOnce({ ...mockTransaction, id: 'new-id', description: 'New record' })
    const { rerender } = render(<TransactionDialog />)
    await waitFor(() => expect(mockGetTransactionById).toHaveBeenCalledWith('tx-edit'))
    mockEditingTransactionId = 'new-id'
    rerender(<TransactionDialog />)
    expect(await screen.findByDisplayValue('New record')).toBeInTheDocument()
    await act(async () => resolveOld(mockTransaction))
    expect(screen.queryByDisplayValue('Test expense')).not.toBeInTheDocument()
  })

  it('blocks a dirty session replacement until discard is confirmed', async () => {
    mockEditingTransactionId = 'tx-edit'
    const { rerender } = render(<TransactionDialog />)
    await userEvent.setup().type(await screen.findByLabelText('form.description'), ' changed')
    mockEditingTransactionId = 'another-row'
    rerender(<TransactionDialog />)
    await waitFor(() => expect(mockOpenTransactionDialog).toHaveBeenCalledWith('tx-edit'))
    expect(screen.getByText('dialog.discardTitle')).toBeInTheDocument()
    expect(mockGetTransactionById).not.toHaveBeenCalledWith('another-row')
    expect(screen.getByLabelText('form.description')).toHaveValue('Test expense changed')
  })

  it('forgets an abandoned dirty switch before a later independent close', async () => {
    mockEditingTransactionId = 'tx-edit'
    const { rerender } = render(<TransactionDialog />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('form.description'), ' changed')
    mockEditingTransactionId = 'another-row'
    rerender(<TransactionDialog />)
    await screen.findByText('dialog.discardTitle')
    mockEditingTransactionId = 'tx-edit' // the store restored the current session
    rerender(<TransactionDialog />)
    fireEvent.click(screen.getByText('Cancel action'))
    await waitFor(() =>
      expect(screen.getByLabelText('form.description')).toHaveValue('Test expense changed')
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByText('Confirm action'))
    expect(mockCloseTransactionDialog).toHaveBeenCalled()
    expect(mockOpenTransactionDialog).not.toHaveBeenCalledWith('another-row')
  })

  it('honors an explicitly confirmed dirty switch to another row', async () => {
    mockEditingTransactionId = 'tx-edit'
    const { rerender } = render(<TransactionDialog />)
    await userEvent.setup().type(await screen.findByLabelText('form.description'), ' changed')
    mockEditingTransactionId = 'another-row'
    rerender(<TransactionDialog />)
    await screen.findByText('dialog.discardTitle')
    mockEditingTransactionId = 'tx-edit'
    rerender(<TransactionDialog />)
    mockGetTransactionById.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'another-row'
          ? { ...mockTransaction, id, description: 'Other row' }
          : mockTransaction
      )
    )
    fireEvent.click(screen.getByText('Confirm action'))
    mockEditingTransactionId = 'another-row'
    rerender(<TransactionDialog />)
    expect(await screen.findByDisplayValue('Other row')).toBeInTheDocument()
    expect(mockOpenTransactionDialog).toHaveBeenCalledWith('another-row')
    expect(mockCloseTransactionDialog).not.toHaveBeenCalled()
  })

  it('starts a clean create form after a clean edit-to-new switch', async () => {
    mockEditingTransactionId = 'tx-edit'
    const { rerender } = render(<TransactionDialog />)
    expect(await screen.findByDisplayValue('Test expense')).toBeInTheDocument()
    mockEditingTransactionId = null
    rerender(<TransactionDialog />)
    await waitFor(() => expect(screen.getByText('addTransaction')).toBeInTheDocument())
    expect(screen.getByLabelText('form.description')).toHaveValue('')
    expect(screen.getByLabelText('form.amount')).toHaveValue(null)
  })

  it('starts a clean create form after confirming a dirty edit-to-new switch', async () => {
    mockEditingTransactionId = 'tx-edit'
    const { rerender } = render(<TransactionDialog />)
    await userEvent.setup().type(await screen.findByLabelText('form.description'), ' changed')
    mockEditingTransactionId = null
    rerender(<TransactionDialog />)
    await screen.findByText('dialog.discardTitle')
    mockEditingTransactionId = 'tx-edit' // store restores the dirty edit while confirming
    rerender(<TransactionDialog />)
    fireEvent.click(screen.getByText('Confirm action'))
    mockEditingTransactionId = null
    rerender(<TransactionDialog />)
    await waitFor(() => expect(screen.getByText('addTransaction')).toBeInTheDocument())
    expect(screen.getByLabelText('form.description')).toHaveValue('')
    expect(screen.getByLabelText('form.amount')).toHaveValue(null)
    expect(mockOpenTransactionDialog).toHaveBeenCalledWith(undefined)
  })

  it('does not retain a blocked child switch as a later discard target', async () => {
    mockEditingTransactionId = 'tx-edit'
    const { rerender } = render(<TransactionDialog />)
    const user = userEvent.setup()
    await user.click(await screen.findByText('detail.details'))
    await user.click(screen.getByRole('button', { name: 'actions.classify' }))
    expect(await screen.findByRole('dialog', { name: 'dialog.title' })).toBeInTheDocument()
    mockEditingTransactionId = 'another-row'
    rerender(<TransactionDialog />)
    mockEditingTransactionId = 'tx-edit'
    rerender(<TransactionDialog />)
    const parentClose = document.querySelector<HTMLElement>('[role="dialog"] > button')
    if (!parentClose) throw new Error('Expected parent close button')
    fireEvent.click(parentClose) // a close request while the child is open is ignored
    expect(mockCloseTransactionDialog).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'actions.done' }))
    await user.type(screen.getByLabelText('form.description'), ' changed')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByText('Confirm action'))
    expect(mockCloseTransactionDialog).toHaveBeenCalled()
    expect(mockOpenTransactionDialog).not.toHaveBeenCalledWith('another-row')
  })

  it('prevents dialog closure while mutation is in flight', async () => {
    let resolveUpdate: () => void = () => {}
    mockUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve
        })
    )

    // Use edit mode so form is pre-filled with valid data
    mockEditingTransactionId = 'tx-edit'
    render(<TransactionDialog />)

    // Submit only after the bounded by-ID lookup has loaded the current row.
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'actions.save' }))

    // Verify the button shows loading state (dialog should stay open)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '...' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(mockCloseTransactionDialog).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdate()
    })
  })

  it('asks before closing when the form has unsaved changes', async () => {
    const user = userEvent.setup()

    render(<TransactionDialog />)

    await user.type(screen.getByLabelText('form.description'), 'Dirty transaction')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByTestId('discard-confirm')).toBeInTheDocument()
    expect(mockCloseTransactionDialog).not.toHaveBeenCalled()

    await act(async () => {
      screen.getByText('Confirm action').click()
    })

    expect(mockCloseTransactionDialog).toHaveBeenCalled()
  })

  it('renders dialog with create mode title', () => {
    render(<TransactionDialog />)

    expect(screen.getByText('addTransaction')).toBeInTheDocument()
    expect(screen.getByText('dialog.addDescription')).toBeInTheDocument()
  })

  it('renders DialogContent with overflow classes', () => {
    render(<TransactionDialog />)

    // Dialog renders in a portal, query the whole document
    const content = document.querySelector('.overflow-y-auto')
    expect(content).toBeInTheDocument()
  })

  it('calls add and shows success toast on create submit (edit mode pre-filled)', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockAdd.mockResolvedValueOnce(undefined)

    // Use edit mode so form is pre-filled with valid data
    mockEditingTransactionId = 'tx-edit'
    mockUpdate.mockResolvedValueOnce(undefined)

    render(<TransactionDialog />)

    await user.click(await screen.findByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('tx-edit', expect.any(Object))
      expect(toast.success).toHaveBeenCalledWith('toast.updated')
      expect(mockCloseTransactionDialog).toHaveBeenCalled()
      expect(mockInvalidateTransactionPage).toHaveBeenCalledWith('edit')
    })
  })

  it('loads a page-2 edit target by ID while the global transaction store is empty', async () => {
    let resolveLookup!: (transaction: TransactionPageRow) => void
    mockEditingTransactionId = 'page-2-row'
    mockGetTransactionById.mockImplementationOnce(
      () => new Promise((resolve) => (resolveLookup = resolve))
    )

    render(<TransactionDialog />)

    expect(mockGetTransactionById).toHaveBeenCalledWith('page-2-row')
    expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument()

    await act(async () =>
      resolveLookup({ ...mockTransaction, id: 'page-2-row', description: 'Actual page two row' })
    )

    expect(await screen.findByDisplayValue('Actual page two row')).toBeInTheDocument()
  })

  it('does not render or enable an editable default form when lookup returns not found', async () => {
    mockEditingTransactionId = 'missing-row'
    mockGetTransactionById.mockResolvedValueOnce(null)

    render(<TransactionDialog />)

    expect(await screen.findByText('dialog.notFound')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument()
  })

  it('invalidates filtered page queries after a new transaction succeeds', async () => {
    const user = userEvent.setup()
    mockAdd.mockResolvedValueOnce(undefined)

    render(<TransactionDialog />)

    await user.type(screen.getByLabelText('form.amount'), '12.34')
    await user.type(screen.getByLabelText('form.description'), 'New matching record')
    const nativeAccountSelect = [...document.querySelectorAll('select')].find((select) =>
      [...select.options].some((option) => option.text === 'Checking')
    )
    if (!nativeAccountSelect) throw new Error('Expected account select')
    fireEvent.change(nativeAccountSelect, { target: { value: 'acc-1' } })
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => expect(mockAdd).toHaveBeenCalled())
    expect(mockInvalidateTransactionPage).toHaveBeenCalledWith('add')
  })

  it('shows error toast when update throws', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()

    mockEditingTransactionId = 'tx-edit'
    mockUpdate.mockRejectedValueOnce(new Error('DB error'))

    render(<TransactionDialog />)

    await user.click(await screen.findByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('DB error')
    })
  })
})
