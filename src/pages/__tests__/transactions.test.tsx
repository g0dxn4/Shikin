import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { classificationCatalog } from '@shikin/finance-core'
import { Transactions } from '../transactions'
import { transactionDateBounds } from '@/lib/transaction-date-presets'
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
const {
  mockReadConsumptionContext,
  mockSetConsumption,
  mockClearConsumption,
  mockListClassificationTypes,
  mockPreviewClassifications,
  mockApplyClassifications,
} = vi.hoisted(() => ({
  mockReadConsumptionContext: vi.fn(),
  mockSetConsumption: vi.fn(),
  mockClearConsumption: vi.fn(),
  mockListClassificationTypes: vi.fn(),
  mockPreviewClassifications: vi.fn(),
  mockApplyClassifications: vi.fn(),
}))

vi.mock('@/lib/consumption-service', () => ({
  readConsumptionClassificationContext: mockReadConsumptionContext,
  setConsumptionClassification: mockSetConsumption,
  clearConsumptionClassification: mockClearConsumption,
}))
vi.mock('@/lib/classification-type-service', () => ({
  listClassificationTypes: mockListClassificationTypes,
  previewConsumptionClassifications: mockPreviewClassifications,
  applyConsumptionClassifications: mockApplyClassifications,
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
      classificationTypes: classificationCatalog([], []),
    })
    mockSetConsumption.mockResolvedValue({
      id: 'classification',
      transaction_id: 'tx-1',
      split_id: null,
      role: 'purchase',
      referenced_purchase_id: null,
    })
    mockClearConsumption.mockResolvedValue(true)
    mockListClassificationTypes.mockResolvedValue({
      definitions: [],
      types: [],
      revisions: [],
    })
    setRows([])
    mockUseQuery.mockImplementation(() => pageResult)
  })

  it('uses the local page query and renders compact native actions without a duplicate h1', () => {
    render(<Transactions />)

    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 }))
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'addTransaction' })[0]).toBeVisible()
    expect(screen.getByRole('button', { name: 'actions.more' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'import.button' })).not.toBeInTheDocument()
    expect(screen.getByText('empty.title')).toBeVisible()
  })

  it('keeps secondary launchers in More actions with native disclosure keyboard behavior', async () => {
    setRows([makeRow()])
    const user = userEvent.setup()
    render(<Transactions />)

    const more = screen.getByRole('button', { name: 'actions.more' })
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'import.button' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'bulk.actions.open' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'recurring.addRule' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(more).toHaveFocus()
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'import.button' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'filters.hideAdvanced (3)' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByLabelText('filters.account')).toBeVisible()
    await user.selectOptions(screen.getByLabelText('views.label'), 'ledger')
    expect(window.location.search).toContain('account=account-2')
    expect(window.location.search).toContain('view=ledger')
  })

  it('summarizes and removes active advanced filters when their mobile controls are collapsed', async () => {
    window.history.replaceState(
      null,
      '',
      '/transactions?account=account-2&status=pending&currency=USD'
    )
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByRole('button', { name: 'filters.hideAdvanced (3)' }))
    expect(screen.getByLabelText('filters.activeAdvanced')).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'filters.remove filters.account: account-2' })
    )
    expect(window.location.search).not.toContain('account=account-2')
    expect(window.location.search).toContain('status=pending')
    expect(screen.getByRole('button', { name: 'filters.showAdvanced (2)' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('opens the full unclassified review queue from its URL', () => {
    window.history.replaceState(null, '', '/transactions?reviewReason=unclassified')
    setRows([makeRow()])
    pageResult.reviewCounts.unclassified = 1

    render(<Transactions />)

    expect(mockUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ reviewReason: 'unclassified' })
    )
    expect(screen.getByLabelText('views.label')).toHaveValue('review')
    expect(screen.getByRole('button', { name: 'review.filter (1)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('exposes timeline, ledger, and review as an explicit display menu', () => {
    render(<Transactions />)

    const display = screen.getByLabelText('views.label') as HTMLSelectElement
    expect(display).toBeVisible()
    expect(Array.from(display.options).map((option) => option.value)).toEqual([
      'timeline',
      'ledger',
      'review',
    ])
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('restores the stored display choice and writes it back when the menu changes', async () => {
    window.localStorage.setItem('shikin.transactions.view', 'ledger')
    const user = userEvent.setup()
    render(<Transactions />)

    const display = screen.getByLabelText('views.label')
    expect(display).toHaveValue('ledger')

    await user.selectOptions(display, 'review')
    expect(window.location.search).toContain('view=review')
    expect(window.localStorage.getItem('shikin.transactions.view')).toBe('review')
    expect(display).toHaveValue('review')
  })

  it('keeps the display choice when resetting compact active filters', async () => {
    window.history.replaceState(
      null,
      '',
      '/transactions?view=ledger&type=expense&account=account-2&search=coffee'
    )
    setRows([makeRow()])
    const user = userEvent.setup()
    render(<Transactions />)

    expect(screen.getByRole('button', { name: 'filters.hideAdvanced (1)' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    const clear = screen.getByRole('button', { name: 'filters.clear' })
    expect(clear).toHaveTextContent('3')
    expect(screen.queryByText('filters.clear')).not.toBeInTheDocument()

    await user.click(clear)
    expect(window.location.search).toContain('view=ledger')
    expect(window.location.search).not.toContain('type=expense')
    expect(window.location.search).not.toContain('account=account-2')
    expect(window.location.search).not.toContain('search=coffee')
    expect(screen.getByLabelText('views.label')).toHaveValue('ledger')
    expect(window.localStorage.getItem('shikin.transactions.view')).toBe('ledger')
    expect(screen.queryByRole('button', { name: 'filters.clear' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'filters.showAdvanced' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('uses a single compact mobile row for matching, review, and currency stats', () => {
    render(<Transactions />)

    const summary = screen.getByLabelText('summary.label')
    expect(summary).toHaveAttribute('data-mobile-layout', 'compact')
    expect(summary).toHaveClass('!grid-cols-3')
    expect(summary.children).toHaveLength(3)
    expect(summary.firstElementChild).toHaveClass('p-2.5')
  })

  it('keeps custom date labels usable and titles long selected filter values', async () => {
    accounts = [
      {
        id: 'long-account',
        name: 'Very Long Everyday Checking Account Name',
        currency: 'USD',
        is_archived: 0,
      },
    ]
    const user = userEvent.setup()
    render(<Transactions />)

    await user.selectOptions(screen.getByLabelText('filters.dateRange'), 'custom')
    expect(screen.getByLabelText('filters.from')).toBeVisible()
    expect(screen.getByLabelText('filters.to')).toBeVisible()

    const account = screen.getByLabelText('filters.account')
    await user.selectOptions(account, 'long-account')
    expect(account).toHaveAttribute('title', 'Very Long Everyday Checking Account Name')
    expect(account).toHaveClass('max-w-full')
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

    await user.selectOptions(screen.getByLabelText('views.label'), 'ledger')
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

    await user.selectOptions(screen.getByLabelText('views.label'), 'review')
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
    await user.selectOptions(screen.getByLabelText('views.label'), 'review')

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

  it('opens bulk classification for only the visible page and restores its toolbar opener focus', async () => {
    setRows(
      [
        makeRow({ id: 'visible-one', description: 'Visible first row' }),
        makeRow({ id: 'visible-two', description: 'Visible second row', currency: 'EUR' }),
      ],
      72
    )
    const user = userEvent.setup()
    render(<Transactions />)

    const opener = screen.getByRole('button', { name: 'actions.more' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'bulk.actions.open' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Visible first row')
    expect(dialog).toHaveTextContent('Visible second row')
    expect(dialog).not.toHaveTextContent('72 transactions')
    expect(mockReadConsumptionContext).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
    expect(window.location.search).toBe('')
    expect(window.localStorage.getItem('shikin.transactions.view')).toBe('timeline')
  })

  it('opens the same global edit session from timeline row and pencil', async () => {
    setRows([makeRow({ id: 'page-2-row', description: 'Page two record' })], 75)
    const user = userEvent.setup()
    render(<Transactions />)
    await user.click(screen.getByRole('button', { name: /^Page two record/ }))
    await user.click(screen.getByRole('button', { name: 'Edit Page two record' }))
    expect(mockOpenTransactionDialog).toHaveBeenNthCalledWith(1, 'page-2-row')
    expect(mockOpenTransactionDialog).toHaveBeenNthCalledWith(2, 'page-2-row')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the same edit session from desktop and mobile ledger descriptions and pencil', async () => {
    setRows([makeRow({ id: 'ledger-row', description: 'Ledger coffee' })])
    const user = userEvent.setup()
    render(<Transactions />)
    await user.selectOptions(screen.getByLabelText('views.label'), 'ledger')
    const descriptions = Array.from(document.querySelectorAll('button')).filter(
      (button) =>
        button.textContent?.includes('Ledger coffee') && !button.getAttribute('aria-label')
    )
    expect(descriptions).toHaveLength(2)
    expect(descriptions[1]).toHaveClass('min-h-11', 'min-w-0', 'w-full')
    for (const button of descriptions) await user.click(button)
    for (const button of screen.getAllByRole('button', { name: 'Edit Ledger coffee' }))
      await user.click(button)
    expect(mockOpenTransactionDialog).toHaveBeenCalledTimes(4)
    for (const call of mockOpenTransactionDialog.mock.calls) expect(call).toEqual(['ledger-row'])
  })

  it('selects actual calendar windows and retains legacy URL labels and custom filters', async () => {
    setRows([makeRow()])
    const user = userEvent.setup()
    render(<Transactions />)
    const date = screen.getByLabelText('filters.dateRange') as HTMLSelectElement
    for (const preset of ['this-month', 'three-months', 'six-months', 'this-year', 'all']) {
      await user.selectOptions(date, preset)
      expect(date.value).toBe(preset)
      expect(mockUseQuery).toHaveBeenLastCalledWith(
        expect.objectContaining(
          transactionDateBounds(preset as Parameters<typeof transactionDateBounds>[0])
        )
      )
    }
    const legacy = transactionDateBounds('90-days')
    window.history.replaceState(
      null,
      '',
      `/transactions?dateFrom=${legacy.dateFrom}&dateTo=${legacy.dateTo}`
    )
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(date.value).toBe('90-days')
    expect(window.location.search).not.toContain('datePreset=')
    await user.selectOptions(date, 'custom')
    expect(screen.getByLabelText('filters.from')).toBeInTheDocument()
  })
})
