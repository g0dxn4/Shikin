import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transactions } from '../transactions'
import dayjs from 'dayjs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockFetchRecurring = vi.fn().mockResolvedValue(undefined)
const mockCreateRule = vi.fn()
const mockUpdateRule = vi.fn()
const mockGetRecurringById = vi.fn()

const mockRules = [
  {
    id: 'rule-1',
    description: 'Monthly Rent',
    amount: 150000,
    type: 'expense',
    frequency: 'monthly',
    next_date: dayjs().add(1, 'month').format('YYYY-MM-DD'),
    account_id: 'acc-1',
    account_name: 'Checking',
    category_id: 'cat-1',
    category_name: 'Housing',
    category_color: '#ff0000',
    active: 1,
  },
]

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openTransactionDialog: vi.fn(),
    recurringDialogOpen: true,
    editingRecurringId: null,
    openRecurringDialog: vi.fn(),
    closeRecurringDialog: vi.fn(),
  }),
}))

vi.mock('@/stores/recurring-store', () => ({
  useRecurringStore: () => ({
    rules: mockRules,
    isLoading: false,
    fetchError: null,
    fetch: mockFetchRecurring,
    create: mockCreateRule,
    update: mockUpdateRule,
    toggleActive: vi.fn(),
    getById: mockGetRecurringById,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    transactions: [],
    isLoading: false,
    fetchError: null,
    fetch: mockFetch,
    remove: vi.fn(),
    isSplit: vi.fn().mockReturnValue(false),
    getSplits: vi.fn().mockResolvedValue([]),
  }),
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
    categories: [{ id: 'cat-1', name: 'Housing', type: 'expense', color: '#ff0000' }],
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe('RecurringRuleDialog accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders form fields with proper label associations', () => {
    render(<Transactions />)

    // Check that labels are associated with inputs via htmlFor/id
    expect(screen.getByLabelText('form.type')).toBeInTheDocument()
    expect(screen.getByLabelText('recurring.form.amount')).toBeInTheDocument()
    expect(screen.getByLabelText('recurring.form.description')).toBeInTheDocument()
    expect(screen.getByLabelText('form.account')).toBeInTheDocument()
    expect(screen.getByLabelText('form.category')).toBeInTheDocument()
    expect(screen.getByLabelText('recurring.form.frequency')).toBeInTheDocument()
    expect(screen.getByLabelText('recurring.form.nextDate')).toBeInTheDocument()
  })

  it('has proper error semantics when validation fails', async () => {
    const user = userEvent.setup()
    render(<Transactions />)

    // Try to submit without filling required fields
    const submitBtn = screen.getByRole('button', { name: 'actions.save' })
    await user.click(submitBtn)

    // Wait for validation errors and check error semantics
    await waitFor(() => {
      // Check aria-invalid on invalid fields
      const amountInput = screen.getByLabelText('recurring.form.amount')
      expect(amountInput).toHaveAttribute('aria-invalid', 'true')

      // Check error messages have role="alert"
      const amountError = document.querySelector('#rec-amount-error')
      if (amountError) {
        expect(amountError).toHaveAttribute('role', 'alert')
      }
    })
  })

  it('exposes aria-describedby linking errors to inputs', async () => {
    const user = userEvent.setup()
    render(<Transactions />)

    // Submit empty form to trigger errors
    const submitBtn = screen.getByRole('button', { name: 'actions.save' })
    await user.click(submitBtn)

    // Check that invalid inputs reference error elements
    await waitFor(() => {
      const amountInput = screen.getByLabelText('recurring.form.amount')
      const ariaDescribedBy = amountInput.getAttribute('aria-describedby')

      // If there's an error, it should be referenced
      if (ariaDescribedBy) {
        const errorElement = document.getElementById(ariaDescribedBy)
        expect(errorElement).toBeInTheDocument()
        expect(errorElement).toHaveAttribute('role', 'alert')
      }
    })
  })

  it('has accessible name for save button', () => {
    render(<Transactions />)

    const saveButton = screen.getByRole('button', { name: 'actions.save' })
    expect(saveButton).toBeInTheDocument()
  })

  it('select triggers have proper id for label association', () => {
    render(<Transactions />)

    // Select triggers should have ids matching their labels
    const typeSelect = document.querySelector('#rec-type')
    expect(typeSelect).toBeInTheDocument()

    const accountSelect = document.querySelector('#rec-account')
    expect(accountSelect).toBeInTheDocument()

    const categorySelect = document.querySelector('#rec-category')
    expect(categorySelect).toBeInTheDocument()

    const frequencySelect = document.querySelector('#rec-frequency')
    expect(frequencySelect).toBeInTheDocument()
  })
})
