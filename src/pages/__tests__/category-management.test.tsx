import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CategoryManagement } from '../category-management'

// ResizeObserver polyfill for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const mockFetch = vi.fn().mockResolvedValue(undefined)
let mockCategories: Array<Record<string, unknown>> = []
let mockFetchError: string | null = null
let mockIsLoading = false

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const translationMap: Record<string, string> = {
  title: 'Categories',
  subtitle: 'Management',
  addCategory: 'Add Category',
  newCategory: 'New Category',
  createCategory: 'Create Category',
  saveChanges: 'Save Changes',
  loadError: 'Couldn’t load categories',
  'empty.title': 'No categories yet',
  'empty.description': 'Create categories to organize your transactions and budgets.',
  'table.category': 'Category',
  'table.type': 'Type',
  'table.actions': 'Actions',
  'form.name': 'Name',
  'form.namePlaceholder': 'e.g. Groceries',
  'form.nameRequired': 'Category name is required.',
  'form.type': 'Type',
  'form.color': 'Color',
  'form.icon': 'Icon',
  'types.expense': 'Expense',
  'types.income': 'Income',
  'types.transfer': 'Transfer',
  'common:actions.saving': 'Saving...',
  'common:actions.cancel': 'Cancel',
  'common:actions.delete': 'Delete',
  selectPrompt: 'Select a category to edit, or click Add Category to create one.',
  deleteCategory: 'Delete Category',
  deleteDescription: 'Are you sure you want to delete this category? This cannot be undone.',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const template = translationMap[key] ?? key
      return Object.entries(params ?? {}).reduce(
        (value, [param, replacement]) => value.replace(`{{${param}}}`, replacement),
        template
      )
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: mockCategories,
    isLoading: mockIsLoading,
    fetchError: mockFetchError,
    fetch: mockFetch,
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}))

describe('CategoryManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCategories = []
    mockFetchError = null
    mockIsLoading = false
  })

  it('renders title and add button', () => {
    render(<CategoryManagement />)
    expect(screen.getByText('Categories')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Add Category/i }).length).toBeGreaterThanOrEqual(
      1
    )
  })

  it('shows empty state when no categories', () => {
    render(<CategoryManagement />)
    expect(screen.getByText('No categories yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Add Category/i }).length).toBeGreaterThanOrEqual(
      1
    )
  })

  it('shows ErrorState when initial fetch fails', () => {
    mockFetchError = 'Database connection failed'

    render(<CategoryManagement />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Database connection failed')).toBeInTheDocument()
  })

  it('renders category list when data is loaded', () => {
    mockCategories = [
      {
        id: '01CAT001',
        name: 'Food',
        type: 'expense',
        color: '#f97316',
        icon: 'utensils',
        sort_order: 1,
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: '01CAT002',
        name: 'Salary',
        type: 'income',
        color: '#22c55e',
        icon: 'banknote',
        sort_order: 2,
        created_at: '2024-01-01T00:00:00Z',
      },
    ]

    render(<CategoryManagement />)
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.getByText('Salary')).toBeInTheDocument()
  })

  it('clears a stale selected category after the category disappears', async () => {
    const user = userEvent.setup()
    mockCategories = [
      {
        id: '01CAT001',
        name: 'Food',
        type: 'expense',
        color: '#f97316',
        icon: 'utensils',
        sort_order: 1,
        created_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { rerender } = render(<CategoryManagement />)
    await user.click(screen.getByRole('button', { name: 'Food' }))
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument()

    mockCategories = []
    rerender(<CategoryManagement />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument()
    })
    expect(screen.getByText('No categories yet')).toBeInTheDocument()
  })

  it('opens add form when Add Category is clicked', async () => {
    const user = userEvent.setup()
    render(<CategoryManagement />)

    await user.click(screen.getAllByRole('button', { name: /Add Category/i })[0])
    expect(screen.getByText('New Category')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Category/i })).toBeInTheDocument()
  })

  it('calls fetch on mount', () => {
    render(<CategoryManagement />)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
