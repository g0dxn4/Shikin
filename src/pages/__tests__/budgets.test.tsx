import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Budgets } from '../budgets'

// ResizeObserver polyfill for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const mockFetch = vi.fn().mockResolvedValue(undefined)
let mockBudgets: Array<Record<string, unknown>> = []
let mockFetchError: string | null = null
let mockIsLoading = false

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openBudgetDialog: vi.fn(),
  }),
}))

vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: () => ({
    budgets: mockBudgets,
    isLoading: mockIsLoading,
    fetchError: mockFetchError,
    fetch: mockFetch,
    remove: vi.fn(),
  }),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}))

describe('Budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBudgets = []
    mockFetchError = null
    mockIsLoading = false
  })

  it('renders title', () => {
    render(<Budgets />)
    expect(screen.getByText('title')).toBeInTheDocument()
  })

  describe('failure/retry boundary behavior', () => {
    it('shows ErrorState (not empty CTA) when initial fetch fails with empty dataset', () => {
      mockFetchError = 'Database connection failed'
      mockBudgets = []

      render(<Budgets />)

      // Should show error state, not empty state
      expect(screen.getByText('error.loadDetailed')).toBeInTheDocument()
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()

      // Should NOT show empty state CTA
      expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
    })

    it('shows empty state CTA (not ErrorState) when fetch succeeds with no budgets', () => {
      mockFetchError = null
      mockBudgets = []

      render(<Budgets />)

      // Should show empty state
      expect(screen.getByText('empty.title')).toBeInTheDocument()
      expect(screen.getByText('empty.description')).toBeInTheDocument()

      // Should NOT show error state
      expect(screen.queryByText('error.loadDetailed')).not.toBeInTheDocument()
    })

    it('calls fetch when retry button is clicked', async () => {
      const user = userEvent.setup()
      mockFetchError = 'Network error'
      mockBudgets = []

      render(<Budgets />)

      const retryButton = screen.getByRole('button', { name: /Try again/i })
      await user.click(retryButton)

      expect(mockFetch).toHaveBeenCalledTimes(2) // Once on mount, once on retry
    })

    it('shows ErrorBanner (not ErrorState) when fetch fails but has cached budgets', () => {
      mockFetchError = 'Refresh failed'
      mockBudgets = [
        {
          id: 'budget-1',
          name: 'Groceries',
          categoryName: 'Food',
          categoryColor: '#ff0000',
          spent: 30000,
          remaining: 20000,
          percentUsed: 60,
          period: 'monthly',
        },
      ]

      render(<Budgets />)

      // Should show error banner, not full error state
      expect(screen.getByText('error.load')).toBeInTheDocument()

      // But should still show the budget
      expect(screen.getByText('Groceries')).toBeInTheDocument()

      // Should NOT show error state (full page error)
      expect(screen.queryByText('error.loadDetailed')).not.toBeInTheDocument()
    })

    it('shows loading skeleton when isLoading is true', () => {
      mockIsLoading = true
      mockBudgets = []
      mockFetchError = null

      render(<Budgets />)

      // Should show skeleton loaders (Skeleton component uses 'skeleton' class)
      const skeletons = document.querySelectorAll('.skeleton')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('marks loading skeleton container with aria-busy', () => {
      mockIsLoading = true
      mockBudgets = []
      mockFetchError = null

      render(<Budgets />)

      const busyContainer = document.querySelector('[aria-busy="true"]')
      expect(busyContainer).toBeInTheDocument()
    })
  })

  describe('hero section', () => {
    it('renders hero summary with budget totals', () => {
      mockBudgets = [
        {
          id: 'budget-1',
          name: 'Groceries',
          categoryName: 'Food',
          categoryColor: '#ff0000',
          amount: 50000,
          spent: 30000,
          remaining: 20000,
          percentUsed: 60,
          period: 'monthly',
        },
        {
          id: 'budget-2',
          name: 'Rent',
          categoryName: 'Housing',
          categoryColor: '#00ff00',
          amount: 100000,
          spent: 100000,
          remaining: 0,
          percentUsed: 100,
          period: 'monthly',
        },
      ]

      render(<Budgets />)

      expect(screen.getByText('hero.totalBudgeted')).toBeInTheDocument()
      expect(screen.getByText('hero.totalSpent')).toBeInTheDocument()
      expect(screen.getByText('hero.totalRemaining')).toBeInTheDocument()
      expect(screen.getByText('2 hero.budgetCount')).toBeInTheDocument()
    })
  })
})
