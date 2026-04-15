import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Accounts } from '../accounts'

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

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
const mockOpenAccountDialog = vi.fn()

let mockAccounts: unknown[] = []
let mockIsLoading = false
let mockFetchError: string | null = null

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openAccountDialog: mockOpenAccountDialog,
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: mockAccounts,
    isLoading: mockIsLoading,
    fetchError: mockFetchError,
    fetch: mockFetch,
    remove: mockRemove,
    balanceHistory: new Map(),
    loadBalanceHistory: vi.fn().mockResolvedValue([]),
  }),
}))

describe('Accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccounts = []
    mockIsLoading = false
    mockFetchError = null
  })

  it('calls fetch on mount', () => {
    render(<Accounts />)

    expect(mockFetch).toHaveBeenCalled()
  })

  it('renders loading state', () => {
    mockIsLoading = true

    const { container } = render(<Accounts />)

    // Loading state renders skeleton, not the account cards
    expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
    expect(container.querySelector('.skeleton')).toBeInTheDocument()
  })

  it('renders empty state with add button', () => {
    render(<Accounts />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
    expect(screen.getByText('empty.description')).toBeInTheDocument()
  })

  it('renders dedicated load error state instead of empty CTA', () => {
    mockFetchError = 'Accounts unavailable'

    render(<Accounts />)

    expect(screen.getByText('Couldn’t load your accounts')).toBeInTheDocument()
    expect(screen.getByText('Accounts unavailable')).toBeInTheDocument()
    expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
  })

  it('renders account cards with name, type badge, balance, and currency', () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 250000 },
      { id: 'acc-2', name: 'Savings', type: 'savings', currency: 'EUR', balance: 100000 },
    ]

    render(<Accounts />)

    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.getByText('Savings')).toBeInTheDocument()
    expect(screen.getByText('$2,500.00')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(screen.getByText('EUR')).toBeInTheDocument()
  })

  it('cards have hover:translate-y-[-2px] class', () => {
    mockAccounts = [{ id: 'acc-1', name: 'Test', type: 'checking', currency: 'USD', balance: 0 }]

    const { container } = render(<Accounts />)

    const card = container.querySelector('.hover\\:translate-y-\\[-2px\\]')
    expect(card).toBeInTheDocument()
  })

  it('edit button calls openAccountDialog with id', async () => {
    const user = userEvent.setup()
    mockAccounts = [
      { id: 'acc-edit', name: 'Editable', type: 'checking', currency: 'USD', balance: 0 },
    ]

    const { container } = render(<Accounts />)

    const buttons = container.querySelectorAll('.group button')
    // First button in the hover group is edit
    await user.click(buttons[0])

    expect(mockOpenAccountDialog).toHaveBeenCalledWith('acc-edit')
  })

  it('delete flow: click delete → confirm → remove → toast', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockRemove.mockResolvedValueOnce(undefined)

    mockAccounts = [
      { id: 'acc-del', name: 'Deletable', type: 'checking', currency: 'USD', balance: 0 },
    ]

    const { container } = render(<Accounts />)

    const buttons = container.querySelectorAll('.group button')
    // Second button in the hover group is delete
    await user.click(buttons[1])

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('acc-del')
      expect(toast.success).toHaveBeenCalledWith('toast.deleted')
    })
  })

  it('hover-reveal actions have opacity-0 class', () => {
    mockAccounts = [{ id: 'acc-1', name: 'Test', type: 'checking', currency: 'USD', balance: 0 }]

    const { container } = render(<Accounts />)

    const hoverDiv = container.querySelector('.opacity-0.group-hover\\:opacity-100')
    expect(hoverDiv).toBeInTheDocument()
  })
})
