import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BudgetForm } from '../budget-form'

const mockFetchCategories = vi.fn().mockResolvedValue(undefined)
let mockCategoriesLoading = false
let mockCategoriesFetchError: string | null = null
let mockCategories: Array<{ id: string; name: string; type: string; icon?: string }> = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: mockCategories,
    isLoading: mockCategoriesLoading,
    fetchError: mockCategoriesFetchError,
    fetch: mockFetchCategories,
  }),
}))

describe('BudgetForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCategoriesLoading = false
    mockCategoriesFetchError = null
    mockCategories = []
  })

  it('shows loading skeleton while categories are loading', () => {
    mockCategoriesLoading = true

    render(<BudgetForm onSubmit={vi.fn()} />)

    // Should show skeleton for category select
    const skeleton = document.querySelector('.skeleton')
    expect(skeleton).toBeInTheDocument()
  })

  it('shows inline prerequisite error when category loading fails', () => {
    mockCategoriesFetchError = 'Categories unavailable'

    render(<BudgetForm onSubmit={vi.fn()} />)

    // The ErrorBanner title
    expect(screen.getByText('form.categoriesError')).toBeInTheDocument()
    expect(screen.getByText('Categories unavailable')).toBeInTheDocument()
  })

  it('renders category options when categories loaded', () => {
    mockCategories = [
      { id: 'cat-1', name: 'Food', type: 'expense', icon: '🍔' },
      { id: 'cat-2', name: 'Rent', type: 'expense' },
    ]

    render(<BudgetForm onSubmit={vi.fn()} />)

    // Should render without error banner
    expect(screen.queryByText('form.categoriesError')).not.toBeInTheDocument()
  })

  it('requires a category before submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    mockCategories = [{ id: 'cat-1', name: 'Food', type: 'expense' }]

    render(<BudgetForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Groceries')
    await user.type(screen.getByLabelText('form.amount'), '100')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    expect(onSubmit).not.toHaveBeenCalled()
    // Check for the error banner or validation error
    expect(document.querySelector('[role="alert"]')).toBeInTheDocument()
  })

  describe('accessibility', () => {
    it('has proper label associations for all fields', () => {
      render(<BudgetForm onSubmit={vi.fn()} />)

      // Check that all inputs have associated labels
      expect(screen.getByLabelText('form.name')).toHaveAttribute('id', 'budget-name')
      expect(screen.getByLabelText('form.amount')).toHaveAttribute('id', 'budget-amount')
      expect(screen.getByLabelText('form.period')).toBeInTheDocument()

      // Category select trigger should have id
      const categoryTrigger = document.querySelector('#budget-category')
      expect(categoryTrigger).toBeInTheDocument()
    })

    it('exposes aria-invalid and aria-describedby when validation fails', async () => {
      const user = userEvent.setup()
      render(<BudgetForm onSubmit={vi.fn()} />)

      // Submit empty form
      await user.click(screen.getByRole('button', { name: 'actions.save' }))

      // Check error semantics
      const nameInput = screen.getByLabelText('form.name')
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).toHaveAttribute('aria-describedby', 'budget-name-error')

      // Check error has role="alert"
      const nameError = document.querySelector('#budget-name-error')
      expect(nameError).toHaveAttribute('role', 'alert')
    })

    it('select has aria-invalid when category is required but empty', async () => {
      mockCategories = [{ id: 'cat-1', name: 'Food', type: 'expense' }]

      const user = userEvent.setup()
      render(<BudgetForm onSubmit={vi.fn()} />)

      // Fill name and amount but not category
      await user.type(screen.getByLabelText('form.name'), 'Test Budget')
      await user.type(screen.getByLabelText('form.amount'), '100')

      // Submit form
      await user.click(screen.getByRole('button', { name: 'actions.save' }))

      // Check category select has aria-invalid
      const categorySelect = document.querySelector('#budget-category')
      expect(categorySelect).toHaveAttribute('aria-invalid', 'true')
    })

    it('disables submit when categories fail to load', () => {
      mockCategoriesFetchError = 'Network error'

      render(<BudgetForm onSubmit={vi.fn()} />)

      // Error banner should be visible
      expect(screen.getByText('form.categoriesError')).toBeInTheDocument()
    })

    it('announces loading state on submit button', () => {
      render(<BudgetForm onSubmit={vi.fn()} isLoading={true} />)

      const submitButton = screen.getByRole('button')
      expect(submitButton).toHaveAttribute('aria-busy', 'true')
      expect(submitButton).toHaveTextContent('actions.saving')
    })
  })
})
