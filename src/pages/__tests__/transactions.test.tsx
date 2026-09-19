import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transactions } from '../transactions'
import type { TransactionPageResult, TransactionPageRow } from '@/lib/transaction-query'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>Confirm delete</button> : null,
}))
vi.mock('@/components/transactions/statement-import-dialog', () => ({
  StatementImportDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="statement-import-dialog" /> : null,
}))
vi.mock('@/components/transactions/legacy-import-identity-dialog', () => ({
  LegacyImportIdentityAction: ({
    onChanged,
  }: {
    transactionId: string
    onChanged?: () => void
  }) => (
    <button type="button" className="min-h-11" onClick={() => onChanged?.()}>
      identity.action
    </button>
  ),
}))

const mockOpenTransactionDialog = vi.fn()
const mockOpenRecurringDialog = vi.fn()
const mockRemove = vi.fn()
const mockGetSplits = vi.fn().mockResolvedValue([])
const mockUpdateReviewFields = vi.fn()
const mockFetchAccounts = vi.fn()
const mockFetchCategories = vi.fn()
const mockInvalidate = vi.fn()
const mockUseQuery = vi.fn()
const { mockReadConsumptionContext, mockSetConsumption, mockClearConsumption } = vi.hoisted(() => ({
  mockReadConsumptionContext: vi.fn(),
  mockSetConsumption: vi.fn(),
  mockClearConsumption: vi.fn(),
}))

vi.mock('@/lib/consumption-service', () => ({
  readConsumptionClassificationContext: mockReadConsumptionContext,
  setConsumptionClassification: mockSetConsumption,
  clearConsumptionClassification: mockClearConsumption,
}))

let accounts: unknown[] = []
let categories: unknown[] = []
let pageResult: TransactionPageResult

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openTransactionDialog: mockOpenTransactionDialog,
    openRecurringDialog: mockOpenRecurringDialog,
  }),
}))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    remove: mockRemove,
    getSplits: mockGetSplits,
    updateReviewFields: mockUpdateReviewFields,
  }),
}))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts,
    archivedAccounts: [],
    fetch: mockFetchAccounts,
  }),
}))
vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({ categories, fetch: mockFetchCategories }),
}))
vi.mock('@/hooks/use-transaction-page-query', () => ({
  useTransactionPageQuery: (request: unknown) => mockUseQuery(request),
}))
vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: (reason: string) => mockInvalidate(reason),
}))

function makeRow(overrides: Partial<TransactionPageRow> = {}): TransactionPageRow {
  return {
    id: 'tx-1',
    account_id: 'account-1',
    category_id: null,
    subcategory_id: null,
    type: 'expense',
    amount: 1234,
    currency: 'USD',
    description: 'Coffee',
    notes: null,
    date: '2026-03-01',
    tags: '[]',
    is_recurring: 0,
    transfer_to_account_id: null,
    status: 'posted',
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    account_name: 'Checking',
    has_splits: 0,
    is_consumption_unclassified: 1,
    ...overrides,
  }
}

function setRows(rows: TransactionPageRow[], total = rows.length) {
  pageResult = {
    rows,
    total,
    currencies: rows.length ? ['USD'] : [],
    reviewCounts: {
      all: 0,
      'needs-category': 0,
      pending: 0,
      placeholder: 0,
      staged: 0,
      unclassified: 0,
    },
    isLoading: false,
    error: null,
  } as TransactionPageResult
}

describe('Transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/transactions')
    window.localStorage.clear()
    accounts = []
    categories = []
    mockFetchAccounts.mockResolvedValue(undefined)
    mockFetchCategories.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)
    mockUpdateReviewFields.mockResolvedValue(undefined)
    mockReadConsumptionContext.mockResolvedValue({
      transaction: makeRow(),
      allocations: [
        {
          transactionId: 'tx-1',
          splitId: null,
          amountCentavos: 1234,
          categoryId: null,
          categoryName: null,
          classification: null,
        },
      ],
      purchaseOptions: [],
    })
    mockSetConsumption.mockResolvedValue({
      id: 'classification',
      transaction_id: 'tx-1',
      split_id: null,
      role: 'purchase',
      referenced_purchase_id: null,
    })
    mockClearConsumption.mockResolvedValue(true)
    setRows([])
    mockUseQuery.mockImplementation(() => pageResult)
  })

  it('uses the local page query and renders compact native actions without a duplicate h1', () => {
    render(<Transactions />)

    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 }))
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'addTransaction' })[0]).toBeVisible()
    expect(screen.getByText('empty.title')).toBeVisible()
  })

  it('reads drill-down filters from the URL and preserves them across view changes', async () => {
    window.history.replaceState(
      null,
      '',
      '/transactions?account=account-2&category=food&dateFrom=2026-01-01&status=posted'
    )
    setRows([makeRow()])
    const user = userEvent.setup()

    render(<Transactions />)

    expect(mockUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        account: 'account-2',
        category: 'food',
        dateFrom: '2026-01-01',
        status: 'posted',
      })
    )
    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))
    expect(window.location.search).toContain('account=account-2')
    expect(window.location.search).toContain('view=ledger')
  })

  it('opens the full unclassified review queue from its URL', () => {
    window.history.replaceState(null, '', '/transactions?reviewReason=unclassified')
    setRows([makeRow()])
    pageResult.reviewCounts.unclassified = 1

    render(<Transactions />)

    expect(mockUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ reviewReason: 'unclassified' })
    )
    expect(screen.getByRole('tab', { name: 'views.review' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('button', { name: 'review.filter (1)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('supports numbered previous/next paging and selectable page sizes', async () => {
    setRows([makeRow()], 130)
    const user = userEvent.setup()
    render(<Transactions />)

    const pageButtons = screen.getAllByRole('button', { name: 'pagination.page' })
    await user.click(pageButtons[pageButtons.length - 1])
    await waitFor(() =>
      expect(mockUseQuery).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
    )
    await user.selectOptions(screen.getByLabelText('pagination.rows'), '25')
    expect(mockUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, pageSize: 25 })
    )
  })

  it('keeps transfer destination account context and split category protections visible', async () => {
    accounts = [
      { id: 'source', name: 'Checking', currency: 'USD', is_archived: 0 },
      { id: 'destination', name: 'Savings', currency: 'USD', is_archived: 0 },
    ]
    setRows([
      makeRow({
        id: 'transfer',
        type: 'transfer',
        account_id: 'source',
        transfer_to_account_id: 'destination',
        transfer_to_account_name: 'Savings',
      }),
      makeRow({ id: 'split', description: 'Split purchase', has_splits: 1 }),
    ])
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))
    expect(screen.getAllByText(/Checking → Savings/).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Edit Split purchase').length).toBeGreaterThan(0)
  })

  it('retains inline review eligibility and currency/account protections', async () => {
    accounts = [
      {
        id: 'account-1',
        name: 'Checking',
        currency: 'USD',
        is_archived: 0,
        account_mode: 'transactional',
      },
      { id: 'eur', name: 'Euro', currency: 'EUR', is_archived: 0, account_mode: 'transactional' },
      {
        id: 'snapshot',
        name: 'Snapshot',
        currency: 'USD',
        is_archived: 0,
        account_mode: 'snapshot_only',
      },
    ]
    categories = [{ id: 'food', name: 'Food', type: 'expense' }]
    setRows([makeRow({ category_id: null, status: ' ' as never })])
    pageResult.reviewCounts = {
      all: 1,
      'needs-category': 1,
      pending: 0,
      placeholder: 0,
      staged: 0,
      unclassified: 1,
    }
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByRole('tab', { name: 'views.review' }))
    const accountSelect = screen.getByLabelText('review.account') as HTMLSelectElement
    expect(Array.from(accountSelect.options).map((option) => option.value)).toEqual(['account-1'])
    await user.selectOptions(screen.getByLabelText('review.category'), 'food')
    await waitFor(() =>
      expect(mockUpdateReviewFields).toHaveBeenCalledWith('tx-1', { categoryId: 'food' })
    )
    expect(mockInvalidate).toHaveBeenCalledWith('review')
  })

  it('preserves J/K review keyboard navigation outside controls', async () => {
    setRows([
      makeRow({ id: 'first', description: 'First' }),
      makeRow({ id: 'second', description: 'Second' }),
    ])
    pageResult.reviewCounts.all = 2
    const user = userEvent.setup()
    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.review' }))

    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Second'))
  })

  it('invalidates the complete page query only after successful deletion', async () => {
    setRows([makeRow({ id: 'delete-me', description: 'Delete me' })])
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByLabelText('Delete Delete me'))
    await user.click(screen.getByText('Confirm delete'))

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('delete-me'))
    expect(mockInvalidate).toHaveBeenCalledWith('delete')
  })

  it('clamps to the previous page after deleting the last row on the last page', async () => {
    window.history.replaceState(null, '', '/transactions?page=2&pageSize=25')
    setRows([makeRow({ id: 'last-row' })], 26)
    const { rerender } = render(<Transactions />)

    setRows([], 25)
    rerender(<Transactions />)

    await waitFor(() => expect(window.location.search).not.toContain('page=2'))
    expect(mockUseQuery).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
  })

  it('opens allocation classification from transaction details and refreshes full query counts', async () => {
    setRows([makeRow()])
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByRole('button', { name: /^Coffee/ }))
    await user.click(screen.getByRole('button', { name: 'actions.classify' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('dialog.title')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(mockSetConsumption).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        splitId: null,
        role: 'purchase',
        referencedPurchaseId: null,
      })
    )
    expect(mockInvalidate).toHaveBeenCalledWith('review')
  })

  it('opens native transaction details while preserving edit actions', async () => {
    setRows([makeRow({ id: 'page-2-row', description: 'Page two record' })], 75)
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByRole('button', { name: /^Page two record/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Page two record')
    await user.click(screen.getByRole('button', { name: 'editTransaction' }))
    expect(mockOpenTransactionDialog).toHaveBeenCalledWith('page-2-row')
  })

  it('mounts legacy import identity for eligible unbound rows and closes stale details after change', async () => {
    setRows([
      makeRow({
        id: 'eligible',
        description: 'Eligible coffee',
        import_source: null,
        import_external_id: null,
        import_fingerprint: null,
        import_content_fingerprint: null,
        transaction_kind: 'standard',
        is_archived: 0,
      }),
    ])
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByRole('button', { name: /^Eligible coffee/ }))
    const action = screen.getByRole('button', { name: 'identity.action' })
    expect(action).toBeVisible()
    expect(action).toHaveClass('min-h-11')
    await user.click(action)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Eligible coffee' })).not.toBeInTheDocument()
    )
  })

  it('hides legacy import identity unless the page row is an eligible active ordinary unbound row', async () => {
    setRows([
      makeRow({ id: 'missing', description: 'Missing projection' }),
      makeRow({
        id: 'bound',
        description: 'Already bound',
        import_source: 'Bank',
        import_external_id: 'x',
        import_fingerprint: '{id}',
      }),
      makeRow({
        id: 'bridge',
        description: 'Bridge row',
        import_source: null,
        import_external_id: null,
        import_fingerprint: null,
        transaction_kind: 'reconciliation_bridge',
      }),
      makeRow({
        id: 'immutable',
        description: 'Immutable import',
        import_source: null,
        import_external_id: null,
        import_fingerprint: null,
        import_content_fingerprint: 'sha256:abc',
      }),
      makeRow({
        id: 'archived',
        description: 'Archived row',
        import_source: null,
        import_external_id: null,
        import_fingerprint: null,
        is_archived: 1,
      }),
    ])
    const user = userEvent.setup()
    render(<Transactions />)

    for (const name of [
      /^Missing projection/,
      /^Already bound/,
      /^Bridge row/,
      /^Immutable import/,
      /^Archived row/,
    ]) {
      await user.click(screen.getByRole('button', { name }))
      expect(screen.queryByRole('button', { name: 'identity.action' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  })
})
