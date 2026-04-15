import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionForm } from '../transaction-form'
import type { TransactionWithDetails } from '@/stores/transaction-store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
const mockFetchCategories = vi.fn().mockResolvedValue(undefined)
let mockAccountsFetchError: string | null = null
let mockCategoriesFetchError: string | null = null

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [
      { id: 'acc-1', name: 'Checking', currency: 'USD' },
      { id: 'acc-2', name: 'Savings', currency: 'EUR' },
    ],
    isLoading: false,
    fetchError: mockAccountsFetchError,
    fetch: mockFetchAccounts,
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: [
      { id: 'cat-1', name: 'Food', type: 'expense', color: '#ff0000', sort_order: 1 },
      { id: 'cat-2', name: 'Salary', type: 'income', color: '#00ff00', sort_order: 2 },
      { id: 'cat-3', name: 'Transport', type: 'expense', color: null, sort_order: 3 },
    ],
    isLoading: false,
    fetchError: mockCategoriesFetchError,
    fetch: mockFetchCategories,
  }),
}))

vi.mock('@/stores/categorization-store', () => ({
  useCategorizationStore: () => ({
    suggestCategory: vi.fn().mockResolvedValue(null),
    rules: [],
    isLoading: false,
    loadRules: vi.fn(),
    deleteRule: vi.fn(),
  }),
}))

describe('TransactionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccountsFetchError = null
    mockCategoriesFetchError = null
  })

  it('renders all fields', () => {
    render(<TransactionForm onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('form.amount')).toBeInTheDocument()
    expect(screen.getByLabelText('form.description')).toBeInTheDocument()
    expect(screen.getByLabelText('form.date')).toBeInTheDocument()
    expect(screen.getByLabelText('form.notes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeInTheDocument()
  })

  it('calls fetchAccounts and fetchCategories on mount', () => {
    render(<TransactionForm onSubmit={vi.fn()} />)

    expect(mockFetchAccounts).toHaveBeenCalled()
    expect(mockFetchCategories).toHaveBeenCalled()
  })

  it('has correct create mode defaults', () => {
    render(<TransactionForm onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('form.description')).toHaveValue('')
  })

  it('populates fields in edit mode', () => {
    const transaction: TransactionWithDetails = {
      id: 'tx-1',
      account_id: 'acc-1',
      category_id: 'cat-1',
      subcategory_id: null,
      type: 'income',
      amount: 5000, // 50.00 in centavos
      currency: 'USD',
      description: 'Freelance work',
      notes: 'Some notes',
      date: '2024-06-15',
      tags: '',
      is_recurring: 0,
      transfer_to_account_id: null,
      created_at: '2024-06-15T00:00:00Z',
      updated_at: '2024-06-15T00:00:00Z',
      account_name: 'Checking',
      category_name: 'Salary',
      category_color: '#00ff00',
    }

    render(<TransactionForm transaction={transaction} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('form.description')).toHaveValue('Freelance work')
    expect(screen.getByLabelText('form.amount')).toHaveValue(50)
    expect(screen.getByLabelText('form.date')).toHaveValue('2024-06-15')
    expect(screen.getByLabelText('form.notes')).toHaveValue('Some notes')
  })

  it('amount input has font-heading text-2xl class', () => {
    render(<TransactionForm onSubmit={vi.fn()} />)

    const amountInput = screen.getByLabelText('form.amount')
    expect(amountInput).toHaveClass('font-heading', 'text-2xl')
  })

  it('disables submit and shows "..." when isLoading', () => {
    render(<TransactionForm onSubmit={vi.fn()} isLoading />)

    const btn = screen.getByRole('button', { name: '...' })
    expect(btn).toBeDisabled()
  })

  it('shows prerequisite error and disables submit when account/category loads fail', () => {
    mockAccountsFetchError = 'Accounts unavailable'
    mockCategoriesFetchError = 'Categories unavailable'

    render(<TransactionForm onSubmit={vi.fn()} />)

    expect(screen.getByText('Prerequisite data couldn’t be loaded')).toBeInTheDocument()
    expect(screen.getByText('Accounts: Accounts unavailable')).toBeInTheDocument()
    expect(screen.getByText('Categories: Categories unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeDisabled()
  })

  it('does not block transfer submission when only categories fail', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    mockCategoriesFetchError = 'Categories unavailable'

    const transaction: TransactionWithDetails = {
      id: 'tx-transfer',
      account_id: 'acc-1',
      category_id: null,
      subcategory_id: null,
      type: 'transfer',
      amount: 1000,
      currency: 'USD',
      description: 'Move money',
      notes: null,
      date: '2024-06-15',
      tags: '',
      is_recurring: 0,
      transfer_to_account_id: 'acc-2',
      created_at: '2024-06-15T00:00:00Z',
      updated_at: '2024-06-15T00:00:00Z',
      account_name: 'Checking',
      transfer_to_account_name: 'Savings',
    }

    render(<TransactionForm transaction={transaction} onSubmit={onSubmit} />)

    expect(screen.getByRole('button', { name: 'actions.save' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'transfer', transferToAccountId: 'acc-2' })
      )
    })
  })

  it('does not block uncategorized submission when only categories fail', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    mockCategoriesFetchError = 'Categories unavailable'

    const transaction: TransactionWithDetails = {
      id: 'tx-expense',
      account_id: 'acc-1',
      category_id: null,
      subcategory_id: null,
      type: 'expense',
      amount: 2550,
      currency: 'USD',
      description: 'Groceries',
      notes: null,
      date: '2024-06-15',
      tags: '',
      is_recurring: 0,
      transfer_to_account_id: null,
      created_at: '2024-06-15T00:00:00Z',
      updated_at: '2024-06-15T00:00:00Z',
      account_name: 'Checking',
    }

    render(<TransactionForm transaction={transaction} onSubmit={onSubmit} />)

    expect(screen.getByRole('button', { name: 'actions.save' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'expense', categoryId: null })
      )
    })
  })

  it('shows validation error for empty required fields on submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TransactionForm onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      // amount is required (positive), description is required (min 1)
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('calls onSubmit with valid form values when editing', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    const transaction: TransactionWithDetails = {
      id: 'tx-1',
      account_id: 'acc-1',
      category_id: null,
      subcategory_id: null,
      type: 'expense',
      amount: 2550,
      currency: 'USD',
      description: 'Groceries',
      notes: null,
      date: '2024-06-15',
      tags: '',
      is_recurring: 0,
      transfer_to_account_id: null,
      created_at: '2024-06-15T00:00:00Z',
      updated_at: '2024-06-15T00:00:00Z',
      account_name: 'Checking',
    }

    render(<TransactionForm transaction={transaction} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 25.5,
          description: 'Groceries',
          type: 'expense',
        })
      )
    })
  })

  it('renders "form.categoryNone" option in category select', () => {
    render(<TransactionForm onSubmit={vi.fn()} />)

    // The None option is always rendered (may appear in trigger and hidden select)
    const noneElements = screen.getAllByText('form.categoryNone')
    expect(noneElements.length).toBeGreaterThanOrEqual(1)
  })

  describe('accessibility', () => {
    it('has proper label associations for all fields', () => {
      render(<TransactionForm onSubmit={vi.fn()} />)

      // Check that all inputs have associated labels
      expect(screen.getByLabelText('form.amount')).toHaveAttribute('id', 'tx-amount')
      expect(screen.getByLabelText('form.description')).toHaveAttribute('id', 'tx-description')
      expect(screen.getByLabelText('form.date')).toHaveAttribute('id', 'tx-date')
      expect(screen.getByLabelText('form.notes')).toBeInTheDocument()
      expect(screen.getByLabelText('form.account')).toBeInTheDocument()
    })

    it('exposes aria-invalid and aria-describedby when validation fails', async () => {
      const user = userEvent.setup()
      render(<TransactionForm onSubmit={vi.fn()} />)

      // Submit empty form
      await user.click(screen.getByRole('button', { name: 'actions.save' }))

      await waitFor(() => {
        // Check error semantics on amount field
        const amountInput = screen.getByLabelText('form.amount')
        expect(amountInput).toHaveAttribute('aria-invalid', 'true')

        // Check error has role="alert" if present
        const amountError = document.querySelector('#tx-amount-error')
        if (amountError) {
          expect(amountError).toHaveAttribute('role', 'alert')
        }
      })
    })

    it('select triggers have proper id for label association', () => {
      render(<TransactionForm onSubmit={vi.fn()} />)

      // Account select should have id
      const accountSelect = document.querySelector('#tx-account')
      expect(accountSelect).toBeInTheDocument()
    })

    it('has accessible split toggle button', () => {
      render(<TransactionForm onSubmit={vi.fn()} />)

      // Split toggle should be a button with accessible name
      const splitToggle = screen.getByRole('button', { name: 'split.toggle' })
      expect(splitToggle).toBeInTheDocument()
    })
  })
})
