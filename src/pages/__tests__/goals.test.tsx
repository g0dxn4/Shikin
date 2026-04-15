import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Goals } from '../goals'

// ResizeObserver polyfill for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const mockFetch = vi.fn().mockResolvedValue(undefined)
let mockGoals: Array<Record<string, unknown>> = []
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
    openGoalDialog: vi.fn(),
  }),
}))

vi.mock('@/stores/goal-store', () => ({
  useGoalStore: () => ({
    goals: mockGoals,
    isLoading: mockIsLoading,
    fetchError: mockFetchError,
    fetch: mockFetch,
    remove: vi.fn(),
  }),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}))

describe('Goals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGoals = []
    mockFetchError = null
    mockIsLoading = false
  })

  it('renders title', () => {
    render(<Goals />)
    expect(screen.getByText('title')).toBeInTheDocument()
  })

  describe('failure/retry boundary behavior', () => {
    it('shows ErrorState (not empty CTA) when initial fetch fails with empty dataset', () => {
      mockFetchError = 'Database connection failed'
      mockGoals = []

      render(<Goals />)

      // Should show error state, not empty state
      expect(screen.getByText('Couldn\u2019t load your goals')).toBeInTheDocument()
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()

      // Should NOT show empty state CTA
      expect(screen.queryByText('empty.title')).not.toBeInTheDocument()
    })

    it('shows empty state CTA (not ErrorState) when fetch succeeds with no goals', () => {
      mockFetchError = null
      mockGoals = []

      render(<Goals />)

      // Should show empty state
      expect(screen.getByText('empty.title')).toBeInTheDocument()
      expect(screen.getByText('empty.description')).toBeInTheDocument()

      // Should NOT show error state
      expect(screen.queryByText('Couldn\u2019t load your goals')).not.toBeInTheDocument()
    })

    it('calls fetch when retry button is clicked', async () => {
      const user = userEvent.setup()
      mockFetchError = 'Network error'
      mockGoals = []

      render(<Goals />)

      const retryButton = screen.getByRole('button', { name: /Try again/i })
      await user.click(retryButton)

      expect(mockFetch).toHaveBeenCalledTimes(2) // Once on mount, once on retry
    })

    it('shows ErrorBanner (not ErrorState) when fetch fails but has cached goals', () => {
      mockFetchError = 'Refresh failed'
      mockGoals = [
        {
          id: 'goal-1',
          name: 'Emergency Fund',
          target_amount: 10000,
          current_amount: 5000,
          progress: 50,
          daysRemaining: 100,
          monthlyNeeded: 500,
          accountName: null,
          color: null,
          icon: null,
          notes: null,
        },
      ]

      render(<Goals />)

      // Should show error banner, not full error state
      expect(screen.getByText('Couldn\u2019t load goals')).toBeInTheDocument()

      // But should still show the goal
      expect(screen.getByText('Emergency Fund')).toBeInTheDocument()

      // Should NOT show error state (full page error)
      expect(screen.queryByText('Couldn\u2019t load your goals')).not.toBeInTheDocument()
    })

    it('shows loading skeleton when isLoading is true', () => {
      mockIsLoading = true
      mockGoals = []
      mockFetchError = null

      render(<Goals />)

      // Should show skeleton loaders (Skeleton component uses 'skeleton' class)
      const skeletons = document.querySelectorAll('.skeleton')
      expect(skeletons.length).toBeGreaterThan(0)
    })
  })
})
