import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { classificationCatalog } from '@shikin/finance-core'
import { Transactions } from '../transactions'
import { transactionDateBounds } from '@/lib/transaction-date-presets'
import { formatMoney } from '@/lib/money'
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
let pageResult: TransactionPageResult & { isLoading: boolean; error: string | null }

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
  }
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
    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))
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
    expect(screen.getByRole('tab', { name: 'views.review' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('button', { name: 'review.filter (1)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('exposes timeline, ledger, and review as visible tabs without a display menu', async () => {
    const user = userEvent.setup()
    render(<Transactions />)

    const tablist = screen.getByRole('tablist', { name: 'views.label' })
    expect(tablist).toBeVisible()
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['views.timeline', 'views.ledger', 'views.review'])
    expect(screen.queryByText('views.display')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'views.label' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'views.timeline' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    tablist.focus()
    screen.getByRole('tab', { name: 'views.timeline' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'views.ledger' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'views.ledger' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'views.review' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'views.timeline' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('restores the stored display choice and writes it back when the tab changes', async () => {
    window.localStorage.setItem('shikin.transactions.view', 'ledger')
    const user = userEvent.setup()
    render(<Transactions />)

    expect(screen.getByRole('tab', { name: 'views.ledger' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.click(screen.getByRole('tab', { name: 'views.review' }))
    expect(window.location.search).toContain('view=review')
    expect(window.localStorage.getItem('shikin.transactions.view')).toBe('review')
    expect(screen.getByRole('tab', { name: 'views.review' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
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
    expect(screen.getByRole('tab', { name: 'views.ledger' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(window.localStorage.getItem('shikin.transactions.view')).toBe('ledger')
    expect(screen.queryByRole('button', { name: 'filters.clear' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'filters.showAdvanced' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('replaces the count cards with a ledger attention bar and keeps book currencies in the filter', () => {
    window.history.replaceState(null, '', '/transactions?view=ledger&currency=USD')
    setRows([makeRow({ amount: 1234 })], 10)
    pageResult.currencies = ['EUR', 'USD']
    pageResult.reviewCounts.all = 3

    render(<Transactions />)

    const summary = screen.getByLabelText('summary.attention')
    expect(summary).toHaveAttribute('data-kind', 'ledger-split')
    expect(summary).toHaveTextContent('summary.flagged')
    expect(summary).toHaveTextContent('3')
    expect(summary).toHaveTextContent('summary.otherMatching')
    expect(summary).toHaveTextContent('7')
    expect(summary).toHaveTextContent('summary.notVerified')
    expect(summary).not.toHaveTextContent('approved')
    expect(summary).not.toHaveTextContent('$')
    expect(summary).not.toHaveTextContent('12.34')
    expect(screen.queryByText('summary.currencies')).not.toBeInTheDocument()
    expect(screen.queryByText('summary.results')).not.toBeInTheDocument()
    const currency = screen.getByLabelText('filters.currency') as HTMLSelectElement
    expect(Array.from(currency.options).map((option) => option.value)).toEqual(
      expect.arrayContaining(['EUR', 'USD'])
    )
  })

  it('does not present review pending as a fraction of the base flagged count', () => {
    window.history.replaceState(null, '', '/transactions?view=review&reviewReason=pending')
    setRows([makeRow({ status: 'pending' })], 1)
    pageResult.reviewCounts = {
      all: 55,
      'needs-category': 10,
      pending: 1,
      placeholder: 4,
      staged: 2,
      unclassified: 40,
    }

    render(<Transactions />)

    const summary = screen.getByLabelText('summary.attention')
    expect(summary).toHaveAttribute('data-kind', 'review-reasons')
    expect(summary.querySelector('[data-testid="ledger-flagged-bar"]')).toBeNull()
    expect(summary).not.toHaveAttribute('data-total')
    expect(summary.textContent).not.toMatch(/1\s*\/\s*55|55\s*\/\s*1|\bof 55\b/)
    expect(summary).toHaveTextContent('summary.overlap')
    expect(screen.getByTestId('review-reason-pending')).toHaveTextContent('1')
    expect(screen.getByTestId('review-reason-pending')).not.toHaveTextContent('55')
    expect(screen.getByTestId('review-reason-unclassified')).toHaveTextContent('40')
    expect(screen.getByTestId('review-flagged-union')).toHaveTextContent('55')
    expect(summary).not.toHaveTextContent('57')
  })

  it('hides the review graphic while loading, in error, or when both counts are zero', () => {
    window.history.replaceState(null, '', '/transactions?view=ledger')
    setRows([makeRow()], 10)
    pageResult.reviewCounts.all = 3
    pageResult.isLoading = true
    const { rerender } = render(<Transactions />)
    expect(screen.queryByLabelText('summary.attention')).not.toBeInTheDocument()

    pageResult.isLoading = false
    pageResult.error = 'Could not load'
    rerender(<Transactions />)
    expect(screen.queryByLabelText('summary.attention')).not.toBeInTheDocument()

    pageResult.error = null
    pageResult.total = 0
    pageResult.reviewCounts.all = 0
    rerender(<Transactions />)
    expect(screen.queryByLabelText('summary.attention')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ledger-flagged-bar')).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))
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

  it('renders stored ledger identity, full amounts, and exception chips only when true', () => {
    window.history.replaceState(null, '', '/transactions?view=ledger')
    const note = 'Private ledger note that must stay collapsed'
    setRows([
      makeRow({
        id: 'clean',
        description: 'Plain coffee',
        amount: 1234,
        currency: 'USD',
        date: '2026-03-01',
        status: ' ' as never,
        category_name: 'Groceries',
        category_color: '#18783c',
        account_name: 'Checking',
        has_splits: 0,
        type: 'expense',
        ledger_treatment: 'normal',
        reporting_treatment: 'normal',
        is_placeholder: 1,
        placeholder_status: 'resolved',
        is_consumption_unclassified: 0,
        source: 'manual',
        notes: null,
        note: '   ',
        import_fingerprint: 'fp-hidden',
        import_content_fingerprint: 'content-fp-hidden',
        staging_batch_id: 'batch-hidden',
        import_external_id: 'ext-hidden',
      }),
      makeRow({
        id: 'flagged',
        description: 'Flagged payee',
        amount: 123456789012,
        currency: 'EUR',
        date: '2026-03-01T00:00:00Z',
        status: 'pending',
        type: 'transfer',
        account_name: 'Checking',
        transfer_to_account_name: 'Savings',
        category_name: 'Parent Category',
        category_color: '#ff00aa',
        has_splits: 1,
        ledger_treatment: 'staged_no_balance_impact',
        reporting_treatment: 'exclude_from_cashflow',
        is_placeholder: 1,
        placeholder_status: 'unresolved',
        is_consumption_unclassified: 1,
        source: 'bank_import',
        notes: note,
        import_fingerprint: 'fp-do-not-render',
        import_content_fingerprint: 'content-fp-do-not-render',
        staging_batch_id: 'batch-do-not-render',
        import_external_id: 'ext-do-not-render',
      }),
      makeRow({
        id: 'cleared',
        description: 'Paycheck',
        amount: 5000,
        currency: 'MXN',
        status: 'cleared',
        type: 'income',
        is_consumption_unclassified: 0,
        source: null,
        import_source: 'ofx',
        category_name: 'Salary',
      }),
      makeRow({
        id: 'linked',
        description: 'Linked record',
        matched_transaction_id: 'other',
        finalization_id: 'final',
        is_consumption_unclassified: 0,
      }),
    ])

    render(<Transactions />)

    expect(document.querySelector('table tfoot')).toBeNull()
    expect(document.body.textContent?.toLowerCase()).not.toContain('approved')
    for (const secret of [
      'fp-hidden',
      'content-fp-hidden',
      'batch-hidden',
      'ext-hidden',
      'fp-do-not-render',
      'content-fp-do-not-render',
      'batch-do-not-render',
      'ext-do-not-render',
    ]) {
      expect(document.body.textContent).not.toContain(secret)
    }

    expect(ledgerMounts('clean')).toHaveLength(2)
    expect(ledgerMounts('flagged')).toHaveLength(2)
    for (const mount of ledgerMounts('clean')) {
      expect(mount.className).toMatch(/hover:bg-muted/)
      expect(mount.className).toMatch(/focus-within:bg-muted/)
      expect(mount.className).not.toMatch(/accent|primary/)
      expect(mount).toHaveTextContent('2026-03-01')
      expect(mount).not.toHaveTextContent('Mar 1, 2026')
      expect(mount.querySelectorAll('[data-ledger-flag]')).toHaveLength(0)
      expect(within(mount).queryByText('review.reasons.staged')).not.toBeInTheDocument()
      expect(within(mount).queryByText('split.badge')).not.toBeInTheDocument()
      expect(within(mount).queryByText('types.transfer')).not.toBeInTheDocument()
      expect(within(mount).queryByText('review.reasons.placeholder')).not.toBeInTheDocument()
      expect(within(mount).queryByText('summary.reasons.unclassified')).not.toBeInTheDocument()
      expect(within(mount).queryByText('review.reason')).not.toBeInTheDocument()
      expect(within(mount).queryByText('correction.excluded')).not.toBeInTheDocument()
      expect(within(mount).queryByText('source.manual')).not.toBeInTheDocument()
      expect(within(mount).queryByText('detail.notes')).not.toBeInTheDocument()
      expect(within(mount).getByText('Groceries')).toBeInTheDocument()
      expect(within(mount).getByText(`-${formatMoney(1234, 'USD')}`)).toBeInTheDocument()
      expect(mount.querySelector('[data-ledger-status="posted"]')).toHaveClass(
        'text-xs',
        'border-border',
        'text-muted-foreground'
      )
      expect(mount.querySelector('[data-ledger-status="posted"]')?.className).not.toContain(
        'text-[10px]'
      )
      expect(mount.querySelector('[data-ledger-category-dot]')?.getAttribute('style')).toMatch(
        /#18783c|rgb\(24,\s*120,\s*60\)/i
      )
      const money = mount.querySelector('[data-ledger-money]')
      const region = mount.querySelector('[data-ledger-amount]')
      expect(region).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto')
      expect(money).toHaveClass('shrink-0', 'whitespace-nowrap', 'tabular-nums')
      expect(money?.className).not.toMatch(/overflow-x-auto|truncate|text-ellipsis|\bmin-w-0\b/)
      expect(money?.parentElement?.className).toContain('shrink-0')
      expect(money?.parentElement?.className).not.toContain('overflow-x-auto')
      expect(money?.parentElement?.className).not.toMatch(/\bmin-w-0\b/)
      expect(money).toHaveTextContent(formatMoney(1234, 'USD'))
      expect(money).toHaveTextContent('USD')
      expect(mount.querySelector('[data-ledger-figure]')).toHaveClass('text-foreground')
      expect(
        within(mount).queryByRole('button', { name: 'Edit Plain coffee' })
      ).not.toBeInTheDocument()
      expect(
        within(mount).queryByRole('button', { name: 'Delete Plain coffee' })
      ).not.toBeInTheDocument()
    }

    const eur = formatMoney(123456789012, 'EUR')
    for (const mount of ledgerMounts('flagged')) {
      expect(mount).toHaveTextContent('2026-03-01')
      expect(mount).not.toHaveTextContent('T00:00:00Z')
      expect(mount).not.toHaveTextContent('Mar 1, 2026')
      expect(mount.textContent).toContain('Checking → Savings')
      expect(within(mount).getByText('review.reasons.staged')).toBeInTheDocument()
      expect(within(mount).getByText('review.reasons.placeholder')).toBeInTheDocument()
      expect(within(mount).getByText('split.badge')).toBeInTheDocument()
      expect(within(mount).getByText('types.transfer')).toBeInTheDocument()
      expect(within(mount).getByText('summary.reasons.unclassified')).toBeInTheDocument()
      expect(mount.querySelector('[data-ledger-flag="unclassified"]')).toHaveAttribute(
        'title',
        'review.reason'
      )
      expect(within(mount).getByText('review.reason')).toBeInTheDocument()
      expect(within(mount).getByText('correction.excluded')).toBeInTheDocument()
      expect(within(mount).getByText('bank import')).toBeInTheDocument()
      expect(within(mount).queryByText('Parent Category')).not.toBeInTheDocument()
      expect(mount.querySelector('[data-ledger-category-dot]')).toBeNull()
      expect(mount.querySelector('[data-ledger-flag="source"]')).toHaveAttribute(
        'title',
        'bank_import'
      )
      expect(mount.querySelector('[data-ledger-status="pending"]')).toHaveClass(
        'text-xs',
        'border-warning/50',
        'text-warning'
      )
      const figure = mount.querySelector('[data-ledger-figure]')
      expect(figure).toHaveClass('text-muted-foreground')
      expect(figure).toHaveTextContent(eur)
      expect(figure?.textContent?.startsWith('-') || figure?.textContent?.startsWith('+')).toBe(
        false
      )
      const money = mount.querySelector('[data-ledger-money]')
      expect(money).toHaveTextContent(eur)
      expect(money).toHaveTextContent('EUR')
      expect(money?.textContent).not.toMatch(/\bUSD\b|[KMB]|million/i)
      expect(money).toHaveClass('shrink-0', 'whitespace-nowrap', 'tabular-nums')
      expect(money?.className).not.toMatch(/overflow-x-auto|truncate|text-ellipsis/)
      const details = within(mount).getByText('detail.notes').closest('details')
      expect(details).not.toHaveAttribute('open')
      expect(details).toHaveTextContent(note)
      const payee = within(mount).getByTitle('Flagged payee')
      expect(payee.tagName).toBe('BUTTON')
      expect(payee.textContent).not.toContain(note)
      expect(payee.querySelector('span')).toHaveClass('line-clamp-2')
    }

    for (const mount of ledgerMounts('cleared')) {
      expect(mount.querySelector('[data-ledger-status="cleared"]')).toHaveClass(
        'text-xs',
        'border-success/50',
        'text-success'
      )
      expect(mount.querySelector('[data-ledger-figure]')).toHaveClass('text-success')
      expect(within(mount).getByText(`+${formatMoney(5000, 'MXN')}`)).toBeInTheDocument()
      expect(mount.querySelector('[data-ledger-money]')).toHaveTextContent('MXN')
      expect(mount.querySelectorAll('[data-ledger-flag]')).toHaveLength(1)
      expect(mount.querySelector('[data-ledger-flag="source"]')).toHaveTextContent('ofx')
      expect(within(mount).queryByText('source.manual')).not.toBeInTheDocument()
    }

    for (const mount of ledgerMounts('linked')) {
      expect(
        within(mount).queryByRole('button', { name: 'Edit Linked record' })
      ).not.toBeInTheDocument()
      expect(
        within(mount).queryByRole('button', { name: 'Delete Linked record' })
      ).not.toBeInTheDocument()
    }

    const mobile = document.querySelector(
      '[data-ledger-row="clean"][data-ledger-mount="mobile"]'
    ) as HTMLElement
    const payee = within(mobile).getByRole('button', { name: /Plain coffee/ })
    expect(payee).toHaveClass(
      'min-h-11',
      'min-w-0',
      'w-full',
      'focus-visible:ring-2',
      'focus-visible:outline-none'
    )
    expect(payee.className).toContain('safe-area-inset-bottom')
    expect(payee.className).not.toContain('text-accent')
    expect(payee).toHaveAttribute('title', 'Plain coffee')
    const editableMobile = document.querySelector(
      '[data-ledger-row="cleared"][data-ledger-mount="mobile"]'
    ) as HTMLElement
    expect(within(editableMobile).getByRole('button', { name: 'Edit Paycheck' })).toHaveClass(
      'min-h-11',
      'md:h-8'
    )
    expect(
      within(editableMobile).getByRole('button', { name: 'Delete Paycheck' }).className
    ).toContain('safe-area-inset-bottom')
    expect(document.querySelector('[data-ledger-list="mobile"]')?.className).toContain(
      'safe-area-inset-bottom'
    )
  })

  it('keeps ledger sort headers focusable without dropping filters or the ledger view', async () => {
    window.history.replaceState(
      null,
      '',
      '/transactions?view=ledger&account=account-2&page=2&search=coffee'
    )
    setRows([makeRow({ is_consumption_unclassified: 0 })], 80)
    const user = userEvent.setup()
    render(<Transactions />)

    const dateHeader = screen.getByRole('columnheader', { name: 'ledger.date' })
    expect(dateHeader).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'ledger.description' })).toHaveAttribute(
      'aria-sort',
      'none'
    )
    expect(screen.getByRole('columnheader', { name: 'ledger.amount' })).toHaveAttribute(
      'aria-sort',
      'none'
    )
    const sortButton = within(dateHeader).getByRole('button')
    expect(sortButton).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:outline-none'
    )
    await user.click(sortButton)
    expect(window.location.search).toContain('view=ledger')
    expect(window.location.search).toContain('account=account-2')
    expect(window.location.search).toContain('search=coffee')
    expect(window.location.search).toContain('direction=asc')
    expect(window.location.search).not.toContain('page=2')
    expect(screen.getByRole('columnheader', { name: 'ledger.date' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
  })

  it('does not apply review J/K navigation in the ledger, including on action buttons', async () => {
    setRows([
      makeRow({ id: 'alpha', description: 'Alpha', is_consumption_unclassified: 0 }),
      makeRow({ id: 'beta', description: 'Beta', is_consumption_unclassified: 0 }),
    ])
    const user = userEvent.setup()
    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))

    const edit = screen.getAllByRole('button', { name: 'Edit Alpha' })[0]
    edit.focus()
    fireEvent.keyDown(edit, { key: 'j' })
    fireEvent.keyDown(document, { key: 'j' })
    fireEvent.keyDown(document, { key: 'k' })
    expect(edit).toHaveFocus()
    expect(mockOpenTransactionDialog).not.toHaveBeenCalled()
  })

  it('opens the ledger editor once from the pencil without a bubbled second open', async () => {
    setRows([makeRow({ id: 'pencil', description: 'Pencil row', is_consumption_unclassified: 0 })])
    const user = userEvent.setup()
    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))

    const edit = screen.getAllByRole('button', { name: 'Edit Pencil row' })[0]
    edit.focus()
    expect(mockOpenTransactionDialog).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(mockOpenTransactionDialog).toHaveBeenCalledTimes(1)
    expect(mockOpenTransactionDialog).toHaveBeenCalledWith('pencil')
  })

  it('keeps ledger delete behind confirmation and does not open edit from the action', async () => {
    setRows([
      makeRow({
        id: 'ledger-delete',
        description: 'Ledger delete',
        is_consumption_unclassified: 0,
      }),
    ])
    const user = userEvent.setup()
    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.ledger' }))

    const remove = screen.getAllByRole('button', { name: 'Delete Ledger delete' })[0]
    remove.focus()
    expect(mockOpenTransactionDialog).not.toHaveBeenCalled()
    await user.click(remove)
    expect(mockOpenTransactionDialog).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    await user.click(screen.getByText('Confirm delete'))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('ledger-delete'))
  })

  it('pushes one history entry per filter under StrictMode and applies the first Back', async () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const user = userEvent.setup()
    render(
      <StrictMode>
        <Transactions />
      </StrictMode>
    )
    expect(pushState).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'types.expense' }))
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(window.location.search).toContain('type=expense')

    pushState.mockClear()
    await act(async () => {
      window.history.back()
    })
    await waitFor(() => expect(window.location.search).not.toContain('type=expense'))
    expect(pushState).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'types.expense' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    pushState.mockClear()
    replaceState.mockClear()
    await user.type(screen.getByLabelText('filters.search'), 'a')
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalled()
    expect(window.location.search).toContain('search=a')

    setRows([makeRow({ description: 'Round trip' })], 80)
    window.history.replaceState(
      null,
      '',
      '/transactions?search=cafe&type=income&account=account-9&category=food&dateFrom=2026-01-01&dateTo=2026-02-01&datePreset=custom&status=pending&currency=EUR&view=ledger&page=2&pageSize=25&sort=amount&direction=asc'
    )
    pushState.mockClear()
    replaceState.mockClear()
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
    expect(mockUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: 'cafe',
        type: 'income',
        account: 'account-9',
        category: 'food',
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01',
        status: 'pending',
        currency: 'EUR',
        sort: 'amount',
        direction: 'asc',
        page: 2,
        pageSize: 25,
      })
    )
    expect(screen.getByRole('tab', { name: 'views.ledger' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(window.location.search).toContain('pageSize=25')
    expect(window.location.search).toContain('direction=asc')
  })

  it('keeps the review inspector on the active row only', async () => {
    setRows([
      makeRow({ id: 'first', description: 'First' }),
      makeRow({ id: 'second', description: 'Second' }),
    ])
    pageResult.reviewCounts.all = 2
    const user = userEvent.setup()
    render(<Transactions />)
    await user.click(screen.getByRole('tab', { name: 'views.review' }))

    expect(document.querySelectorAll('[data-review-inspector]')).toHaveLength(1)
    expect(document.getElementById('review-category-first')).toBeInTheDocument()
    expect(document.getElementById('review-category-second')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Second'))
    expect(document.querySelectorAll('[data-review-inspector]')).toHaveLength(1)
    expect(document.getElementById('review-category-second')).toBeInTheDocument()
    expect(document.getElementById('review-category-first')).not.toBeInTheDocument()
  })

  it('shows true pending, staged, and source flags without approved or page aggregates', () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      makeRow({
        id: `row-${index}`,
        description: `Row ${index}`,
        amount: 100,
        currency: 'USD',
        date: '2026-04-02',
        is_consumption_unclassified: 0,
        ...(index === 0
          ? {
              status: 'pending' as const,
              ledger_treatment: 'staged_no_balance_impact' as const,
              source: 'bank_import',
              type: 'transfer' as const,
              transfer_to_account_name: 'Savings',
            }
          : {}),
      })
    )
    setRows(rows, 74)
    render(<Transactions />)

    expect(document.querySelectorAll('.native-panel')).toHaveLength(1)
    expect(document.querySelectorAll('article')).toHaveLength(50)
    expect(document.body.textContent?.toLowerCase()).not.toContain('approved')
    expect(document.body.textContent).not.toContain(formatMoney(50 * 100, 'USD'))
    expect(screen.queryByText('summary.results')).not.toBeInTheDocument()
    expect(screen.queryByText('summary.currencies')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('2026-04-02')).toBeInTheDocument()
    expect(screen.getAllByText('status.pending').length).toBeGreaterThan(0)
    expect(screen.getAllByText('review.reasons.staged').length).toBeGreaterThan(0)
    expect(screen.getByText('bank import')).toBeInTheDocument()
    expect(screen.queryByText('source.manual')).not.toBeInTheDocument()
    expect(screen.getAllByText(`-${formatMoney(100, 'USD')}`).length).toBeGreaterThan(0)
  })

  it('opens review from the flagged count without dropping the current filters', async () => {
    window.history.replaceState(null, '', '/transactions?account=account-2&type=expense&page=2')
    setRows([makeRow({ is_consumption_unclassified: 0 })], 74)
    pageResult.reviewCounts.all = 55
    const user = userEvent.setup()
    render(<Transactions />)

    await user.click(screen.getByRole('button', { name: /55/ }))
    expect(window.location.search).toContain('view=review')
    expect(window.location.search).toContain('account=account-2')
    expect(window.location.search).toContain('type=expense')
    expect(window.location.search).not.toContain('page=2')
    expect(screen.getByRole('tab', { name: 'views.review' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})

function ledgerMounts(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-ledger-row="${id}"]`))
}
