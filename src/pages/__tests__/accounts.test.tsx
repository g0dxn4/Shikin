import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { Accounts } from '../accounts'
import { useCurrencyStore } from '@/stores/currency-store'

function CurrentLocation() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderAccounts(path = '/accounts') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Accounts />
      <CurrentLocation />
    </MemoryRouter>
  )
}

async function chooseAccountAction(
  user: ReturnType<typeof userEvent.setup>,
  accountName: string,
  actionName: string
) {
  const card = screen.getByRole('article', { name: accountName })
  await user.click(within(card).getByRole('button', { name: `actions.more — ${accountName}` }))
  await user.click(within(card).getByRole('button', { name: actionName }))
}

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: (props: { children: React.ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('recharts', () => ({
  AreaChart: () => null,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: (namespace: string) => ({
    t: (key: string) =>
      key === 'action' && namespace === 'cardPayments' ? 'statements.action' : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/accounts/account-maintenance-dialog', () => ({
  AccountMaintenanceDialog: ({
    account,
    open,
    onOpenChange,
  }: {
    account: { name: string }
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role="dialog" aria-label={`Maintain ${account.name}`}>
        <span role="status">errors.savedRefreshFailed</span>
        <button onClick={() => onOpenChange(false)}>Close maintenance</button>
      </div>
    ) : null,
}))
vi.mock('@/components/accounts/card-statements-dialog', async () => {
  const { Dialog, DialogContent, DialogDescription, DialogTitle } =
    await import('@/components/ui/dialog')
  return {
    CardStatementsDialog: ({
      account,
      open,
      onOpenChange,
      onChanged,
    }: {
      account: { name: string }
      open: boolean
      onOpenChange: (open: boolean) => void
      onChanged: () => void
    }) => (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {open && (
          <DialogContent>
            <DialogTitle>{`Statements ${account.name}`}</DialogTitle>
            <DialogDescription>Statement actions</DialogDescription>
            <button onClick={onChanged}>Change statement</button>
            <button onClick={() => onOpenChange(false)}>Close statements</button>
          </DialogContent>
        )}
      </Dialog>
    ),
  }
})

vi.mock('@/components/shared/confirm-dialog', async () => {
  const { Dialog, DialogContent, DialogDescription, DialogTitle } =
    await import('@/components/ui/dialog')
  return {
    ConfirmDialog: ({
      open,
      onOpenChange,
      onConfirm,
      title,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      onConfirm: () => void
      title: string
    }) => (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {open ? (
          <DialogContent data-testid="confirm-dialog">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Confirmation</DialogDescription>
            <button onClick={() => onOpenChange(false)}>Cancel</button>
            <button onClick={onConfirm}>Confirm</button>
          </DialogContent>
        ) : null}
      </Dialog>
    ),
  }
})

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
const mockArchive = vi.fn()
const mockUnarchive = vi.fn()
const mockSetPrimary = vi.fn()
const mockOpenAccountDialog = vi.fn()
const mockAddTransaction = vi.fn()

let mockAccounts: unknown[] = []
let mockArchivedAccounts: unknown[] = []
let mockIsLoading = false
let mockFetchError: string | null = null
let mockBalanceHistory = new Map<string, Array<{ date: string; balance: number }>>()
const mockLoadBalanceHistory = vi.fn().mockResolvedValue([])

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openAccountDialog: mockOpenAccountDialog,
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: (selector?: (state: { fetch: typeof mockFetch }) => unknown) => {
    const state = {
      accounts: mockAccounts,
      isLoading: mockIsLoading,
      fetchError: mockFetchError,
      fetch: mockFetch,
      archivedAccounts: mockArchivedAccounts,
      archive: mockArchive,
      unarchive: mockUnarchive,
      setPrimary: mockSetPrimary,
      remove: mockRemove,
      balanceHistory: mockBalanceHistory,
      loadBalanceHistory: mockLoadBalanceHistory,
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: (selector?: (state: { add: typeof mockAddTransaction }) => unknown) => {
    const state = { add: mockAddTransaction }
    return selector ? selector(state) : state
  },
}))

const fxRate = (fromCurrency: string, toCurrency: string, rateDecimal: string) => ({
  id: `${fromCurrency}-${toCurrency}-${rateDecimal}`,
  fromCurrency,
  toCurrency,
  rateDecimal,
  effectiveFrom: '2000-01-01',
  supersedesRateId: null,
  createdAt: '2000-01-01T00:00:00Z',
  sourceNote: null,
})

describe('Accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRemove.mockReset()
    mockArchive.mockReset()
    mockUnarchive.mockReset()
    mockSetPrimary.mockReset()
    mockAddTransaction.mockReset()
    mockAccounts = []
    mockArchivedAccounts = []
    mockIsLoading = false
    mockFetchError = null
    mockBalanceHistory = new Map()
    mockLoadBalanceHistory.mockReset()
    mockLoadBalanceHistory.mockResolvedValue([])
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD', manualRates: [] })
  })

  it('calls fetch on mount', () => {
    renderAccounts()

    expect(mockFetch).toHaveBeenCalled()
  })

  it('renders loading state', () => {
    mockIsLoading = true

    const { container } = renderAccounts()

    // Loading state renders skeleton, not the account cards
    expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
    expect(container.querySelector('.skeleton')).toBeInTheDocument()
    expect(container.querySelector('[class*="xl:grid-cols-"]')).not.toBeInTheDocument()
    expect(container.querySelector('.metric-strip')).toBeInTheDocument()
  })

  it('keeps existing account cards mounted during background refresh', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 250000,
        account_mode: 'transactional',
      },
    ]
    mockIsLoading = true

    const { container } = renderAccounts()

    expect(screen.getByRole('article', { name: 'Checking' })).toBeInTheDocument()
    expect(container.querySelector('.skeleton')).not.toBeInTheDocument()
    await chooseAccountAction(user, 'Checking', 'action')
    expect(screen.getByRole('status')).toHaveTextContent('errors.savedRefreshFailed')
  })

  it('renders empty state with add button', () => {
    renderAccounts()

    expect(screen.getByText('empty.title')).toBeInTheDocument()
    expect(screen.getByText('empty.description')).toBeInTheDocument()
  })

  it('renders dedicated load error state instead of empty CTA', () => {
    mockFetchError = 'Accounts unavailable'

    renderAccounts()

    expect(screen.getByText('Couldn’t load your accounts')).toBeInTheDocument()
    expect(screen.getByText('Accounts unavailable')).toBeInTheDocument()
    expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
  })

  it('renders account cards with name, type badge, balance, and currency', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 250000 },
      { id: 'acc-2', name: 'Savings', type: 'savings', currency: 'EUR', balance: 100000 },
    ]

    renderAccounts()

    expect(screen.getAllByText('Checking').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Savings').length).toBeGreaterThan(0)
    const checking = screen.getByRole('article', { name: 'Checking' })
    const savings = screen.getByRole('article', { name: 'Savings' })
    expect(checking.parentElement).toBe(savings.parentElement)
    expect(checking.parentElement).toHaveClass('grid-cols-1', 'items-start', 'xl:grid-cols-2')
    expect(screen.getAllByText('$2,500.00').length).toBeGreaterThan(0)
    const checkingBalance = within(checking).getByText('$2,500.00')
    const checkingCurrency = within(checking).getByText('USD')
    expect(checkingBalance.parentElement).toBe(checkingCurrency.parentElement)
    expect(checkingBalance.parentElement).toHaveClass(
      'flex',
      'min-w-0',
      'flex-wrap',
      'items-baseline'
    )
    expect(checkingBalance.parentElement).not.toHaveClass('truncate', 'overflow-hidden')
    expect(checkingBalance).toHaveClass(
      'min-w-0',
      'max-w-full',
      'break-words',
      'text-xl',
      'min-[380px]:text-2xl'
    )
    expect(checkingBalance).not.toHaveClass('truncate')
    expect(within(savings).getByText('EUR').parentElement).toBe(
      within(savings).getByText('€1,000.00').parentElement
    )
  })

  it('tints cards from persisted color and identifies types without fabricated numbers', () => {
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'Everyday Checking',
        type: 'checking',
        currency: 'USD',
        balance: 250000,
        color: '#3d6ea8',
      },
      {
        id: 'acc-2',
        name: 'Emergency Savings',
        type: 'savings',
        currency: 'USD',
        balance: 100000,
        color: null,
      },
    ]

    renderAccounts()

    const checking = screen.getByRole('article', { name: 'Everyday Checking' })
    expect(checking.getAttribute('style')).toContain('#3d6ea8')
    expect(checking.getAttribute('style')).toContain('color-mix')
    expect(checking.querySelector('.account-type-mark')).toBeInTheDocument()
    expect(within(checking).getByRole('heading', { level: 3 })).toHaveClass('break-words')
    expect(within(checking).getByText('$2,500.00')).toHaveClass('break-words')
    expect(checking).not.toHaveTextContent(/\*\*\*\*|••••|1234/)

    const savings = screen.getByRole('article', { name: 'Emergency Savings' })
    expect(savings.querySelector('.account-type-mark')).toBeInTheDocument()
    expect(savings.getAttribute('style') ?? '').not.toContain('color-mix')
  })

  it('renders accounts on native panels without a promotional page header', () => {
    mockAccounts = [{ id: 'acc-1', name: 'Test', type: 'checking', currency: 'USD', balance: 0 }]

    const { container } = renderAccounts()

    expect(container.querySelector('.native-panel')).toBeInTheDocument()
    expect(container.querySelector('.page-toolbar')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('stacks the account collection above the asset mix while gridding cards at xl', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 250000 },
      { id: 'acc-2', name: 'Travel Card', type: 'credit_card', currency: 'USD', balance: -10000 },
    ]

    renderAccounts()
    const listHeading = screen.getByRole('heading', { name: 'list.title' })
    const mixHeading = screen.getByRole('heading', { name: 'mix.title' })

    expect(listHeading.closest('.native-panel')?.parentElement).toHaveClass('flex-col')
    expect(screen.getByRole('article', { name: 'Checking' }).parentElement).toHaveClass(
      'grid-cols-1',
      'items-start',
      'xl:grid-cols-2'
    )
    expect(
      listHeading.compareDocumentPosition(mixHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('mix.spendable')).toBeInTheDocument()
    expect(screen.getByText('mix.cardDebt')).toBeInTheDocument()
    // The mobile-safe action trigger remains a full-size labelled target.
    expect(screen.getByRole('button', { name: 'actions.more — Checking' })).toHaveClass('min-h-11')
    expect(screen.getByText('metrics.net')).toBeInTheDocument()
  })

  it('edit button calls openAccountDialog with id', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-edit', name: 'Editable', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Editable', 'actions.edit')

    expect(mockOpenAccountDialog).toHaveBeenCalledWith('acc-edit')
  })

  it('delete flow: click delete → confirm → remove → toast', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockRemove.mockResolvedValueOnce(undefined)

    mockAccounts = [
      { id: 'acc-del', name: 'Deletable', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Deletable', 'actions.delete')

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('acc-del')
      expect(toast.success).toHaveBeenCalledWith('toast.deleted')
    })
  })

  it('restores focus to the persistent account actions trigger after confirmation closes', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-focus', name: 'Focus Account', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts()

    const more = screen.getByRole('button', { name: 'actions.more — Focus Account' })
    await user.click(more)
    await user.click(screen.getByRole('button', { name: 'actions.delete' }))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(more).toHaveFocus())
  })

  it('shows a specific error toast when deleting an account fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockRemove.mockRejectedValueOnce(new Error('Account delete DB error'))

    mockAccounts = [
      {
        id: 'acc-delete-fail',
        name: 'Delete Fails',
        type: 'checking',
        currency: 'USD',
        balance: 0,
      },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Delete Fails', 'actions.delete')
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('acc-delete-fail')
      expect(toast.error).toHaveBeenCalledWith('Account delete DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('archives an active account from the account card actions', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockArchive.mockResolvedValueOnce(undefined)
    mockAccounts = [
      { id: 'acc-archive', name: 'Archive Me', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Archive Me', 'archiveAccount')

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockArchive).toHaveBeenCalledWith('acc-archive')
      expect(toast.success).toHaveBeenCalledWith('toast.archived')
    })
  })

  it('shows a specific error toast when archiving an account fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockArchive.mockRejectedValueOnce(new Error('Archive DB error'))
    mockAccounts = [
      {
        id: 'acc-archive-fail',
        name: 'Archive Fails',
        type: 'checking',
        currency: 'USD',
        balance: 0,
      },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Archive Fails', 'archiveAccount')
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockArchive).toHaveBeenCalledWith('acc-archive-fail')
      expect(toast.error).toHaveBeenCalledWith('Archive DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows a specific error toast when restoring an account fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockUnarchive.mockRejectedValueOnce(new Error('Restore DB error'))
    mockArchivedAccounts = [
      {
        id: 'acc-restore-fail',
        name: 'Restore Fails',
        type: 'checking',
        currency: 'USD',
        balance: 0,
      },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Restore Fails', 'unarchiveAccount')

    await waitFor(() => {
      expect(mockUnarchive).toHaveBeenCalledWith('acc-restore-fail')
      expect(toast.error).toHaveBeenCalledWith('Restore DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('uses an explicitly primary account for the hero card', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'High Balance', type: 'checking', currency: 'USD', balance: 500000 },
      {
        id: 'acc-2',
        name: 'Daily Checking',
        type: 'checking',
        currency: 'USD',
        balance: 10000,
        is_primary: 1,
      },
    ]

    renderAccounts()

    expect(screen.getAllByText('Daily Checking').length).toBeGreaterThan(0)
    expect(screen.getByText('actions.primaryBadge')).toBeInTheDocument()
  })

  it('sets a non-credit account as primary from its card action', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockSetPrimary.mockResolvedValueOnce(undefined)
    mockAccounts = [
      { id: 'acc-primary', name: 'Daily Checking', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Daily Checking', 'actions.setPrimary')

    await waitFor(() => {
      expect(mockSetPrimary).toHaveBeenCalledWith('acc-primary')
      expect(toast.success).toHaveBeenCalledWith('toast.primaryUpdated')
    })
  })

  it('shows a specific error toast when setting a primary account fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockSetPrimary.mockRejectedValueOnce(new Error('Primary DB error'))
    mockAccounts = [
      {
        id: 'acc-primary-fail',
        name: 'Primary Fails',
        type: 'checking',
        currency: 'USD',
        balance: 0,
      },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Primary Fails', 'actions.setPrimary')

    await waitFor(() => {
      expect(mockSetPrimary).toHaveBeenCalledWith('acc-primary-fail')
      expect(toast.error).toHaveBeenCalledWith('Primary DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('does not offer primary action on credit cards', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-card', name: 'Credit Card', type: 'credit_card', currency: 'USD', balance: -1000 },
    ]

    renderAccounts()

    const card = screen.getByRole('article', { name: 'Credit Card' })
    await user.click(within(card).getByRole('button', { name: 'actions.more — Credit Card' }))
    expect(
      within(card).queryByRole('button', { name: 'actions.setPrimary' })
    ).not.toBeInTheDocument()
  })

  it('shows credit limit and available by default, with dates and utilization on request', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      {
        id: 'acc-card',
        name: 'Travel Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -100000,
        credit_limit: 2700000,
        statement_closing_day: 15,
        payment_due_day: 5,
      },
    ]

    renderAccounts()

    const card = screen.getByRole('article', { name: 'Travel Card' })
    expect(within(card).getAllByRole('button')).toHaveLength(1)
    expect(within(card).getByText('credit.limit')).toBeInTheDocument()
    expect(within(card).getByText('credit.available')).toBeInTheDocument()
    expect(within(card).getByText('$27,000.00')).toBeInTheDocument()
    expect(within(card).getByText('$26,000.00')).toBeInTheDocument()
    expect(within(card).getByText('credit.limit').parentElement?.parentElement).toHaveClass(
      'grid-cols-2'
    )
    expect(within(card).getByText('credit.limit').parentElement?.parentElement).not.toHaveClass(
      'grid-cols-3'
    )
    expect(within(card).queryByText('utilization.label')).not.toBeInTheDocument()
    expect(within(card).queryByText(/C 15/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/D 5/)).not.toBeInTheDocument()
    await chooseAccountAction(user, 'Travel Card', 'credit.showDetails')
    expect(within(card).getByText('credit.limit')).toBeInTheDocument()
    expect(within(card).getByText('credit.available')).toBeInTheDocument()
    expect(within(card).getByText('$27,000.00')).toBeInTheDocument()
    expect(within(card).getByText('$26,000.00')).toBeInTheDocument()
    expect(screen.getByText(/C 15/)).toBeInTheDocument()
    expect(screen.getByText(/D 5/)).toBeInTheDocument()
    expect(within(card).getByText('utilization.label')).toBeInTheDocument()
    await chooseAccountAction(user, 'Travel Card', 'credit.hideDetails')
    expect(within(card).getByText('credit.limit')).toBeInTheDocument()
    expect(within(card).getByText('credit.available')).toBeInTheDocument()
    expect(within(card).queryByText('utilization.label')).not.toBeInTheDocument()
    expect(within(card).queryByText(/C 15/)).not.toBeInTheDocument()
  })

  it('omits the details toggle when a card has no credit details to display', async () => {
    mockAccounts = [
      {
        id: 'no-limit',
        name: 'No limit card',
        type: 'credit_card',
        currency: 'USD',
        balance: -100,
      },
    ]
    renderAccounts()
    const card = screen.getByRole('article', { name: 'No limit card' })
    expect(within(card).queryByText('credit.limit')).not.toBeInTheDocument()
    expect(within(card).queryByText('credit.available')).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'actions.more — No limit card' }))
    expect(screen.queryByRole('button', { name: 'credit.showDetails' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'statements.action' })).toBeInTheDocument()
  })

  it('records a credit card payment as a transfer from a cash account', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockAddTransaction.mockResolvedValueOnce(undefined)
    mockAccounts = [
      {
        id: 'acc-checking',
        name: 'Daily Checking',
        type: 'checking',
        currency: 'USD',
        balance: 50000,
        is_primary: 1,
      },
      {
        id: 'acc-card',
        name: 'Travel Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -10000,
        credit_limit: 100000,
      },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Travel Card', 'credit.pay')
    await user.clear(screen.getByLabelText('credit.amount'))
    await user.type(screen.getByLabelText('credit.amount'), '25')
    await user.click(screen.getByRole('button', { name: 'credit.confirmPayment' }))

    await waitFor(() => {
      expect(mockAddTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 25,
          type: 'transfer',
          accountId: 'acc-checking',
          transferToAccountId: 'acc-card',
          currency: 'USD',
          categoryId: null,
          description: 'credit.paymentDescriptionPrefix Travel Card',
          notes: null,
        })
      )
      expect(toast.success).toHaveBeenCalledWith('credit.paymentSuccess')
    })
  })

  it('shows a specific error toast when recording a credit card payment fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockAddTransaction.mockRejectedValueOnce(new Error('Payment DB error'))
    mockAccounts = [
      {
        id: 'acc-checking',
        name: 'Daily Checking',
        type: 'checking',
        currency: 'USD',
        balance: 50000,
        is_primary: 1,
      },
      {
        id: 'acc-card',
        name: 'Travel Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -10000,
        credit_limit: 100000,
      },
    ]

    renderAccounts()

    await chooseAccountAction(user, 'Travel Card', 'credit.pay')
    await user.clear(screen.getByLabelText('credit.amount'))
    await user.type(screen.getByLabelText('credit.amount'), '25')
    await user.click(screen.getByRole('button', { name: 'credit.confirmPayment' }))

    await waitFor(() => {
      expect(mockAddTransaction).toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('Payment DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps card maintenance attached to the selected account after the disclosure closes', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-a', name: 'Checking', type: 'checking', currency: 'USD', balance: 100 },
      { id: 'acc-b', name: 'Savings', type: 'savings', currency: 'USD', balance: 200 },
    ]
    renderAccounts()
    await chooseAccountAction(user, 'Savings', 'action')
    expect(screen.getByRole('dialog', { name: 'Maintain Savings' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Maintain Checking' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close maintenance' }))
    expect(screen.queryByRole('dialog', { name: 'Maintain Savings' })).not.toBeInTheDocument()
  })

  it('renders archived accounts behind a toggle', async () => {
    const user = userEvent.setup()
    mockAccounts = [{ id: 'acc-1', name: 'Active', type: 'checking', currency: 'USD', balance: 0 }]
    mockArchivedAccounts = [
      { id: 'acc-2', name: 'Old Account', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts()

    expect(screen.getByText('archived.title')).toBeInTheDocument()
    expect(screen.queryByText('Old Account')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /archived.show/i }))

    expect(screen.getByText('Old Account')).toBeInTheDocument()
    const archivedCard = screen.getByRole('article', { name: 'Old Account' })
    expect(within(archivedCard).getByText('archived.badge')).toBeInTheDocument()
    expect(within(archivedCard).getAllByRole('button')).toHaveLength(1)
    await user.click(
      within(archivedCard).getByRole('button', { name: 'actions.more — Old Account' })
    )
    expect(
      within(archivedCard).getByRole('button', { name: 'unarchiveAccount' })
    ).toBeInTheDocument()
    expect(
      within(archivedCard).queryByRole('button', { name: 'actions.setPrimary' })
    ).not.toBeInTheDocument()
    expect(archivedCard.parentElement).toHaveClass('grid-cols-1', 'items-start', 'xl:grid-cols-2')
  })

  it('shows archived accounts when there are no active accounts', () => {
    mockArchivedAccounts = [
      { id: 'acc-archived', name: 'Archived Only', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts()

    expect(screen.getByText('noActive.title')).toBeInTheDocument()
    expect(screen.getByText('Archived Only')).toBeInTheDocument()
    expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
  })

  it('keeps account actions in a labelled mobile-safe disclosure', async () => {
    const user = userEvent.setup()
    mockAccounts = [{ id: 'acc-1', name: 'Test', type: 'checking', currency: 'USD', balance: 0 }]

    renderAccounts()

    const card = screen.getByRole('article', { name: 'Test' })
    const more = within(card).getByRole('button', { name: 'actions.more — Test' })
    expect(more).toHaveClass('min-h-11')
    expect(within(card).queryByRole('button', { name: 'actions.edit' })).not.toBeInTheDocument()

    await user.click(more)
    // The ellipsis shares a row with the name: its expanded panel must not consume that width.
    expect(document.getElementById(more.getAttribute('aria-controls') ?? '')).toHaveClass(
      'absolute'
    )
    expect(within(card).getByRole('button', { name: 'actions.setPrimary' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'archiveAccount' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'actions.edit' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'actions.delete' })).toBeVisible()
  })

  it('shows a converted same-currency net instead of mixing display currencies', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 250000 },
      { id: 'acc-2', name: 'Savings', type: 'savings', currency: 'USD', balance: 100000 },
    ]

    renderAccounts()

    expect(screen.getByText('metrics.net')).toBeInTheDocument()
    expect(screen.getAllByText('$3,500.00').length).toBeGreaterThan(0)
  })

  it('reacts to deferred rates, preferred-currency switches, and invalid-rate updates', async () => {
    mockAccounts = [
      { id: 'acc-usd', name: 'Checking', type: 'checking', currency: 'USD', balance: 10000 },
      { id: 'acc-eur', name: 'Savings', type: 'savings', currency: 'EUR', balance: 10000 },
    ]

    renderAccounts()
    expect(screen.getByText('currency.missingRates')).toBeInTheDocument()

    act(() => useCurrencyStore.setState({ manualRates: [fxRate('EUR', 'USD', '2')] }))
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)

    act(() =>
      useCurrencyStore.setState({
        mainCurrency: 'EUR',
        preferredCurrency: 'EUR',
        manualRates: [fxRate('USD', 'EUR', '0.5')],
      })
    )
    expect(screen.getAllByText('€150.00').length).toBeGreaterThan(0)

    act(() =>
      useCurrencyStore.setState({
        manualRates: [fxRate('USD', 'EUR', '0')],
      })
    )
    expect(screen.getByText('currency.invalidData')).toBeInTheDocument()
    expect(screen.queryByText('€150.00')).not.toBeInTheDocument()
  })

  it('does not raw-sum mixed currencies when a rate is missing', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 250000 },
      { id: 'acc-2', name: 'Savings', type: 'savings', currency: 'EUR', balance: 100000 },
    ]

    renderAccounts()

    expect(screen.getAllByText('currency.unavailable').length).toBeGreaterThan(0)
    expect(screen.getByText('currency.missingRates')).toBeInTheDocument()
    expect(screen.queryByText('$3,500.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('$2,500.00').length).toBeGreaterThan(0)
    expect(screen.getByText('EUR')).toBeInTheDocument()
  })

  it('navigates from the disclosure to the encoded account ledger filter', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc&ledger', name: 'Daily Checking', type: 'checking', currency: 'USD', balance: 0 },
    ]
    renderAccounts()
    const card = screen.getByRole('article', { name: 'Daily Checking' })
    expect(within(card).getAllByRole('button')).toHaveLength(1)
    await chooseAccountAction(user, 'Daily Checking', 'viewTransactions')
    expect(screen.getByTestId('location')).toHaveTextContent('/transactions?account=acc%26ledger')
  })

  it('toggles balance history from the menu with focus returned to the ellipsis', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 0 },
      {
        id: 'acc-card',
        name: 'Travel Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -10000,
        credit_limit: 100000,
      },
    ]
    renderAccounts()
    const checking = screen.getByRole('article', { name: 'Checking' })
    const more = within(checking).getByRole('button', { name: 'actions.more — Checking' })
    expect(within(checking).getAllByRole('button')).toHaveLength(1)
    expect(within(checking).queryByText('history.none')).not.toBeInTheDocument()
    await user.click(more)
    expect(within(checking).getByRole('button', { name: 'history.show' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await user.click(within(checking).getByRole('button', { name: 'history.show' }))
    expect(more).toHaveFocus()
    expect(within(checking).getByText('history.none')).toBeInTheDocument()
    await user.click(more)
    expect(within(checking).getByRole('button', { name: 'history.hide' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await user.click(within(checking).getByRole('button', { name: 'history.hide' }))
    expect(within(checking).queryByText('history.none')).not.toBeInTheDocument()
    expect(mockLoadBalanceHistory).toHaveBeenCalledWith('acc-1', 6)
  })

  it('announces balance-history points in original minor units', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      {
        id: 'acc-checking',
        name: 'Everyday Checking',
        type: 'checking',
        currency: 'USD',
        balance: 4084885,
      },
      {
        id: 'acc-card',
        name: 'Travel Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -157277,
        credit_limit: 500000,
      },
    ]
    mockBalanceHistory = new Map([
      [
        'acc-checking',
        [
          { date: '2026-03-23', balance: 2578212 },
          { date: '2026-09-20', balance: 4084885 },
        ],
      ],
      [
        'acc-card',
        [
          { date: '2026-09-18', balance: -158277 },
          { date: '2026-09-20', balance: -157277 },
        ],
      ],
    ])

    renderAccounts()

    const checking = screen.getByRole('article', { name: 'Everyday Checking' })
    await chooseAccountAction(user, 'Everyday Checking', 'history.show')
    const checkingChart = within(checking).getByRole('img', {
      name: 'history.show for Everyday Checking',
    })
    expect(checkingChart).toHaveTextContent('Sep 20: $40,848.85')
    expect(checkingChart).toHaveTextContent('Mar 23: $25,782.12')
    expect(checkingChart).not.toHaveTextContent('$408.49')
    expect(checkingChart).not.toHaveTextContent('$257.82')

    const card = screen.getByRole('article', { name: 'Travel Card' })
    await chooseAccountAction(user, 'Travel Card', 'history.show')
    const cardChart = within(card).getByRole('img', { name: 'history.show for Travel Card' })
    expect(cardChart).toHaveTextContent('Sep 18: -$1,582.77')
    expect(cardChart).toHaveTextContent('Sep 20: -$1,572.77')
  })

  it('opens the target card statements dialog from the menu and refreshes after changes', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 0 },
      {
        id: 'acc-card',
        name: 'Travel Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -10000,
      },
    ]
    renderAccounts()
    await chooseAccountAction(user, 'Travel Card', 'statements.action')
    expect(screen.getByRole('dialog', { name: 'Statements Travel Card' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change statement' }))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Close statements' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'actions.more — Travel Card' })).toHaveFocus()
    )
    const checking = screen.getByRole('article', { name: 'Checking' })
    await user.click(within(checking).getByRole('button', { name: 'actions.more — Checking' }))
    expect(
      within(checking).queryByRole('button', { name: 'statements.action' })
    ).not.toBeInTheDocument()
  })

  it('keeps investment accounts out of liquidity figures until the separate list is opened', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 10000 },
      {
        id: 'acc-broker',
        name: 'Brokerage',
        type: 'investment',
        currency: 'USD',
        balance: 9_990_000,
        account_mode: 'transactional',
      },
    ]

    renderAccounts()

    expect(screen.getByText('list.investmentsSeparate')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Brokerage' })).not.toBeInTheDocument()
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('$99,900.00')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /list.investmentsShow/i }))
    const brokerage = screen.getByRole('article', { name: 'Brokerage' })
    expect(brokerage).toBeInTheDocument()
    expect(brokerage.parentElement).toHaveClass('grid-cols-1', 'items-start', 'xl:grid-cols-2')
    expect(screen.getByText('$99,900.00')).toBeInTheDocument()
    await user.click(within(brokerage).getByRole('button', { name: 'actions.more — Brokerage' }))
    expect(within(brokerage).getByRole('button', { name: 'action' })).toBeInTheDocument()
  })

  it('hides history maintenance on snapshot-only investment accounts', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      {
        id: 'acc-crypto',
        name: 'Hardware Wallet',
        type: 'crypto',
        currency: 'USD',
        balance: 5000,
        account_mode: 'snapshot_only',
      },
    ]

    renderAccounts()

    expect(await screen.findByRole('article', { name: 'Hardware Wallet' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'actions.more — Hardware Wallet' }))
    expect(screen.queryByRole('button', { name: 'action' })).not.toBeInTheDocument()
  })

  it('exposes archived investment accounts in the separate list, not the cash archive', async () => {
    mockArchivedAccounts = [
      {
        id: 'acc-old-broker',
        name: 'Old Brokerage',
        type: 'investment',
        currency: 'USD',
        balance: 0,
      },
    ]

    renderAccounts()

    expect(screen.getByText('noActive.title')).toBeInTheDocument()
    expect(screen.queryByText('archived.title')).not.toBeInTheDocument()
    const oldBrokerage = await screen.findByRole('article', { name: 'Old Brokerage' })
    expect(oldBrokerage.parentElement).toHaveClass('grid-cols-1', 'items-start', 'xl:grid-cols-2')
  })

  it('focuses an active cash account from the account query after load', async () => {
    mockAccounts = [
      { id: 'acc-active', name: 'Daily Checking', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts('/accounts?account=acc-active')

    const card = await screen.findByRole('article', { name: 'Daily Checking' })
    await waitFor(() => expect(card).toHaveFocus())
    expect(card).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('link.located')).toBeInTheDocument()
  })

  it('focuses a credit card from the account query', async () => {
    mockAccounts = [
      {
        id: 'acc-card',
        name: 'Travel Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -10000,
      },
    ]

    renderAccounts('/accounts?account=acc-card')

    const card = await screen.findByRole('article', { name: 'Travel Card' })
    await waitFor(() => expect(card).toHaveFocus())
    expect(card).toHaveAttribute('aria-current', 'true')
  })

  it('reveals and focuses a portfolio account from the account query', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 0 },
      {
        id: 'acc-broker',
        name: 'Brokerage',
        type: 'investment',
        currency: 'USD',
        balance: 0,
      },
    ]

    renderAccounts('/accounts?account=acc-broker')

    const card = await screen.findByRole('article', { name: 'Brokerage' })
    await waitFor(() => expect(card).toHaveFocus())
    expect(card).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /list.investmentsHide/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('reveals and focuses an archived cash account from the account query', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 0 },
    ]
    mockArchivedAccounts = [
      { id: 'acc-archived', name: 'Old Account', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts('/accounts?account=acc-archived')

    const card = await screen.findByRole('article', { name: 'Old Account' })
    await waitFor(() => expect(card).toHaveFocus())
    expect(card).toHaveAttribute('aria-current', 'true')
  })

  it('does not guess a different account when the linked id is unknown', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Daily Checking', type: 'checking', currency: 'USD', balance: 0 },
    ]

    renderAccounts('/accounts?account=Daily%20Checking')

    expect(await screen.findByRole('alert')).toHaveTextContent('link.unknown')
    const card = screen.getByRole('article', { name: 'Daily Checking' })
    expect(card).not.toHaveAttribute('aria-current')
    expect(card).not.toHaveFocus()
    expect(screen.queryByText('link.located')).not.toBeInTheDocument()
  })
})
