import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Receivables } from '../receivables'

// ResizeObserver polyfill for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockCreate = vi.fn().mockResolvedValue(undefined)
const mockUpdate = vi.fn().mockResolvedValue(undefined)
const mockCancel = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
let mockReceivables: Array<Record<string, unknown>> = []
let mockFetchError: string | null = null
let mockIsLoading = false

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/receivable-store', () => ({
  useReceivableStore: () => ({
    receivables: mockReceivables,
    isLoading: mockIsLoading,
    fetchError: mockFetchError,
    fetch: mockFetch,
    create: mockCreate,
    update: mockUpdate,
    cancel: mockCancel,
    remove: mockRemove,
    getById: (id: string) => mockReceivables.find((r) => r.id === id),
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    title,
  }: {
    open: boolean
    onConfirm: () => void
    title: string
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}))

function makeReceivable(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'recv-1',
    payer: 'Acme Corp',
    amount: 500000,
    received_amount: 200000,
    currency: 'USD',
    due_date: '2026-12-31',
    project_reference: null,
    invoice_reference: null,
    status: 'partial',
    account_id: null,
    matched_transaction_id: null,
    notes: null,
    source: null,
    note: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    accountName: null,
    accountCurrency: null,
    isOverdue: false,
    remainingAmount: 300000,
    ...overrides,
  }
}

describe('Receivables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRemove.mockReset()
    mockReceivables = []
    mockFetchError = null
    mockIsLoading = false
  })

  it('renders title', () => {
    render(<Receivables />)
    expect(screen.getByText('title')).toBeInTheDocument()
  })

  describe('failure/retry boundary behavior', () => {
    it('shows ErrorState (not empty CTA) when initial fetch fails with empty dataset', () => {
      mockFetchError = 'Database connection failed'
      mockReceivables = []

      render(<Receivables />)

      expect(screen.getByText('error.loadDetailed')).toBeInTheDocument()
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()
      expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
    })

    it('shows empty state CTA (not ErrorState) when fetch succeeds with no receivables', () => {
      mockFetchError = null
      mockReceivables = []

      render(<Receivables />)

      expect(screen.getByText('empty.title')).toBeInTheDocument()
      expect(screen.getByText('empty.description')).toBeInTheDocument()
      expect(screen.queryByText('error.loadDetailed')).not.toBeInTheDocument()
    })

    it('calls fetch when retry button is clicked', async () => {
      const user = userEvent.setup()
      mockFetchError = 'Network error'
      mockReceivables = []

      render(<Receivables />)

      const retryButton = screen.getByRole('button', { name: /Try again/i })
      await user.click(retryButton)

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('shows ErrorBanner (not ErrorState) when fetch fails but has cached receivables', () => {
      mockFetchError = 'Refresh failed'
      mockReceivables = [makeReceivable()]

      render(<Receivables />)

      expect(screen.getByText('error.load')).toBeInTheDocument()
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0)
      expect(screen.queryByText('error.loadDetailed')).not.toBeInTheDocument()
    })

    it('shows loading skeleton when isLoading is true', () => {
      mockIsLoading = true
      mockReceivables = []
      mockFetchError = null

      render(<Receivables />)

      const skeletons = document.querySelectorAll('.skeleton')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('marks loading skeleton container with aria-busy', () => {
      mockIsLoading = true
      mockReceivables = []
      mockFetchError = null

      render(<Receivables />)

      const busyContainer = document.querySelector('[aria-busy="true"]')
      expect(busyContainer).toBeInTheDocument()
    })
  })

  describe('summary metrics', () => {
    it('renders outstanding, overdue, and received metrics', () => {
      mockReceivables = [makeReceivable()]

      render(<Receivables />)

      expect(screen.getByText('summary.outstanding')).toBeInTheDocument()
      expect(screen.getByText('summary.overdue')).toBeInTheDocument()
      expect(screen.getByText('summary.received')).toBeInTheDocument()
    })
  })

  describe('status filters', () => {
    it('renders all filter pills', () => {
      mockReceivables = [makeReceivable()]

      render(<Receivables />)

      expect(screen.getAllByText('filters.all').length).toBeGreaterThan(0)
      expect(screen.getAllByText('filters.open').length).toBeGreaterThan(0)
      expect(screen.getAllByText('filters.partial').length).toBeGreaterThan(0)
      expect(screen.getAllByText('filters.received').length).toBeGreaterThan(0)
      expect(screen.getAllByText('filters.overdue').length).toBeGreaterThan(0)
      expect(screen.getAllByText('filters.cancelled').length).toBeGreaterThan(0)
    })

    it('filters receivables by status when a pill is clicked', async () => {
      const user = userEvent.setup()
      mockReceivables = [
        makeReceivable({ id: 'recv-1', payer: 'Open Payer', status: 'open' }),
        makeReceivable({ id: 'recv-2', payer: 'Partial Payer', status: 'partial' }),
      ]

      render(<Receivables />)

      expect(screen.getByText('Open Payer')).toBeInTheDocument()
      expect(screen.getByText('Partial Payer')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /filters.open/ }))

      expect(screen.getByText('Open Payer')).toBeInTheDocument()
      expect(screen.queryByText('Partial Payer')).not.toBeInTheDocument()
    })
  })

  describe('delete action', () => {
    it('shows a specific error toast when deleting a receivable fails', async () => {
      const { toast } = await import('sonner')
      const user = userEvent.setup()
      mockRemove.mockRejectedValueOnce(new Error('Receivable delete DB error'))
      mockReceivables = [makeReceivable({ id: 'recv-delete-fail' })]

      render(<Receivables />)

      await user.click(screen.getByLabelText('actions.delete Acme Corp'))
      await user.click(screen.getByText('Confirm'))

      await waitFor(() => {
        expect(mockRemove).toHaveBeenCalledWith('recv-delete-fail')
        expect(toast.error).toHaveBeenCalledWith('Receivable delete DB error')
      })
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('cancel action', () => {
    it('calls cancel with the receivable id when confirmed', async () => {
      const user = userEvent.setup()
      mockReceivables = [makeReceivable({ id: 'recv-cancel-test' })]

      render(<Receivables />)

      await user.click(screen.getByLabelText('cancelReceivable Acme Corp'))
      await user.click(screen.getByText('Confirm'))

      await waitFor(() => {
        expect(mockCancel).toHaveBeenCalledWith('recv-cancel-test')
      })
    })
  })
})
