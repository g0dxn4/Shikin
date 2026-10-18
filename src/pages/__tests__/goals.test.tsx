import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Goals } from '../goals'
import { useCurrencyStore } from '@/stores/currency-store'

// ResizeObserver polyfill for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn()
const mockOpenGoalDialog = vi.hoisted(() => vi.fn())
let mockGoals: Array<Record<string, unknown>> = []
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

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openGoalDialog: mockOpenGoalDialog,
  }),
}))

vi.mock('@/stores/goal-store', () => ({
  useGoalStore: () => ({
    goals: mockGoals,
    isLoading: mockIsLoading,
    fetchError: mockFetchError,
    fetch: mockFetch,
    remove: mockRemove,
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

describe('Goals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRemove.mockReset()
    mockGoals = []
    mockFetchError = null
    mockIsLoading = false
    useCurrencyStore.setState({
      mainCurrency: null,
      preferredCurrency: 'USD',
      manualRates: [],
    })
  })

  it('renders title', () => {
    render(<Goals />)
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('renders stored legacy goal icons as SVG without emoji', () => {
    mockGoals = [
      {
        id: 'goal-1',
        name: 'House Fund',
        target_amount: 10000,
        current_amount: 5000,
        progress: 50,
        daysRemaining: 100,
        monthlyNeeded: 500,
        accountName: null,
        color: '#22c55e',
        icon: '🏠',
        notes: null,
      },
    ]

    render(<Goals />)

    const surfaces = document.querySelectorAll('[data-goal-id="goal-1"]')
    expect(surfaces.length).toBeGreaterThan(0)
    for (const surface of surfaces) {
      expect(surface.querySelector('svg')).toBeInTheDocument()
      expect(surface.textContent ?? '').not.toContain('🏠')
    }
    const hero = screen.getByRole('region', { name: /hero\.featuredGoal/ })
    expect(hero.querySelector('circle[stroke="#22c55e"]')).toBeInTheDocument()
    expect(hero).not.toHaveAttribute('style')
    expect(document.querySelector('.text-primary')).not.toBeInTheDocument()
  })

  it('falls back to an SVG icon when a goal has no stored icon', () => {
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

    const surfaces = document.querySelectorAll('[data-goal-id="goal-1"]')
    expect(surfaces.length).toBeGreaterThan(0)
    for (const surface of surfaces) {
      expect(surface.querySelector('svg')).toBeInTheDocument()
      expect(surface.textContent ?? '').not.toContain('🎯')
    }
    expect(
      screen
        .getByRole('region', { name: /hero\.featuredGoal/ })
        .querySelector('circle[stroke="#7C5CFF"]')
    ).toBeInTheDocument()
  })

  describe('failure/retry boundary behavior', () => {
    it('shows ErrorState (not empty CTA) when initial fetch fails with empty dataset', () => {
      mockFetchError = 'Database connection failed'
      mockGoals = []

      render(<Goals />)

      // Should show error state, not empty state
      expect(screen.getByText('error.loadDetailed')).toBeInTheDocument()
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
      expect(screen.queryByText('error.loadDetailed')).not.toBeInTheDocument()
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
      expect(screen.getByText('error.load')).toBeInTheDocument()

      // But should still show the goal (may appear in hero + card)
      expect(screen.getAllByText('Emergency Fund').length).toBeGreaterThan(0)

      // Should NOT show error state (full page error)
      expect(screen.queryByText('error.loadDetailed')).not.toBeInTheDocument()
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

    it('marks loading skeleton container with aria-busy', () => {
      mockIsLoading = true
      mockGoals = []
      mockFetchError = null

      render(<Goals />)

      const busyContainer = document.querySelector('[aria-busy="true"]')
      expect(busyContainer).toBeInTheDocument()
    })
  })

  describe('hero section', () => {
    it('withholds a complete summary whose report currency is not the selected authority', () => {
      useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD' })
      mockGoals = [
        {
          id: 'goal-1',
          name: 'Emergency Fund',
          target_amount: 10000,
          current_amount: 5000,
          currency: 'MXN',
          progress: 50,
          daysRemaining: 100,
          monthlyNeeded: 500,
          accountName: null,
          color: null,
          icon: null,
          notes: null,
          mainConversion: {
            complete: true,
            policy: 'recorded_goal_value_today',
            toCurrency: 'MXN',
            target: {
              complete: true,
              preferredCurrency: 'MXN',
              amountCentavos: 10_000,
              missingCurrencies: [],
            },
            saved: {
              complete: true,
              preferredCurrency: 'MXN',
              amountCentavos: 5_000,
              missingCurrencies: [],
            },
            reason: null,
          },
        },
      ]

      render(<Goals />)

      expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
      expect(screen.queryByTestId('goals-aggregate-summary')).not.toBeInTheDocument()
      expect(screen.queryByText('$50.00')).not.toBeInTheDocument()
      expect(screen.queryByText('$100.00')).not.toBeInTheDocument()
      expect(screen.getByRole('region', { name: /hero\.featuredGoal/ })).toHaveTextContent(
        'MX$50.00'
      )
    })

    it('renders the featured goal without an unauthorized aggregate', () => {
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
        {
          id: 'goal-2',
          name: 'Vacation',
          target_amount: 5000,
          current_amount: 2500,
          progress: 50,
          daysRemaining: 50,
          monthlyNeeded: 250,
          accountName: null,
          color: null,
          icon: null,
          notes: null,
        },
      ]

      render(<Goals />)

      expect(screen.getByRole('heading', { name: 'Emergency Fund' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: /hero\.featuredGoal/ })).toHaveTextContent(
        'Emergency Fund'
      )
      expect(screen.getByText('2 hero.goalCount')).toBeInTheDocument()
      expect(screen.queryByTestId('goals-aggregate-summary')).not.toBeInTheDocument()
      expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
    })
  })

  describe('due date states', () => {
    it('shows due today text for goals with 0 days remaining', () => {
      mockGoals = [
        {
          id: 'goal-1',
          name: 'Urgent Goal',
          target_amount: 10000,
          current_amount: 5000,
          progress: 50,
          daysRemaining: 0,
          deadline: '2026-06-01',
          monthlyNeeded: 500,
          accountName: null,
          color: null,
          icon: null,
          notes: null,
        },
      ]

      render(<Goals />)

      expect(screen.getAllByText('card.dueToday').length).toBeGreaterThan(0)
      expect(screen.getByText('hero.statusDueToday')).toBeInTheDocument()
      expect(screen.queryByText('card.overdue')).not.toBeInTheDocument()
      expect(screen.queryByText('card.noDeadline')).not.toBeInTheDocument()
    })

    it('shows overdue text for goals with negative days remaining', () => {
      mockGoals = [
        {
          id: 'goal-1',
          name: 'Overdue Goal',
          target_amount: 10000,
          current_amount: 5000,
          progress: 50,
          daysRemaining: -5,
          monthlyNeeded: 500,
          accountName: null,
          color: null,
          icon: null,
          notes: null,
        },
      ]

      render(<Goals />)

      expect(screen.getAllByText('card.overdue').length).toBeGreaterThan(0)
      expect(screen.getByText('hero.statusOverdue')).toBeInTheDocument()
      expect(screen.queryByText('card.dueToday')).not.toBeInTheDocument()
    })
  })

  it('renders long goal lists in pages', async () => {
    const user = userEvent.setup()
    mockGoals = Array.from({ length: 21 }, (_, index) => {
      const suffix = String(index).padStart(2, '0')
      return {
        id: `goal-${suffix}`,
        name: `Goal ${suffix}`,
        target_amount: 10000,
        current_amount: 5000,
        progress: 50,
        daysRemaining: 100,
        monthlyNeeded: 500,
        accountName: null,
        color: null,
        icon: null,
        notes: null,
      }
    })

    render(<Goals />)

    expect(screen.getAllByText('Goal 00').length).toBeGreaterThan(0)
    expect(screen.getByText('Goal 19')).toBeInTheDocument()
    expect(screen.queryByText('Goal 20')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /pagination\.showMore/i }))

    expect(screen.getByText('Goal 20')).toBeInTheDocument()
  })

  it('shows a specific error toast when deleting a goal fails', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockRemove.mockRejectedValueOnce(new Error('Goal delete DB error'))
    mockGoals = [
      {
        id: 'goal-delete-fail',
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

    await user.click(screen.getByLabelText('actions.delete Emergency Fund'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('goal-delete-fail')
      expect(toast.error).toHaveBeenCalledWith('Goal delete DB error')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  function goalFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'goal-1',
      name: 'Goal',
      target_amount: 10000,
      current_amount: 5000,
      currency: 'USD',
      progress: 50,
      daysRemaining: 30,
      monthlyNeeded: 500,
      accountName: null,
      color: '#22c55e',
      icon: null,
      notes: null,
      deadline: null,
      ...overrides,
    }
  }

  it('changes the featured hero when a collection goal is selected and edit opens the dialog', async () => {
    const user = userEvent.setup()
    mockGoals = [
      goalFixture({
        id: 'soon',
        name: 'Soon',
        deadline: '2026-01-15',
        progress: 10,
        daysRemaining: 20,
        current_amount: 1000,
      }),
      goalFixture({
        id: 'later',
        name: 'Later',
        deadline: '2026-12-01',
        progress: 80,
        daysRemaining: 200,
        current_amount: 8000,
        accountName: 'Savings',
      }),
    ]

    render(<Goals />)

    const hero = () => screen.getByRole('region', { name: /hero\.featuredGoal/ })
    expect(hero()).toHaveTextContent('Soon')
    expect(hero()).not.toHaveTextContent('Later')
    expect(screen.getByRole('button', { name: /^Soon/ })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /^Later/ }))

    expect(hero()).toHaveTextContent('Later')
    expect(hero()).not.toHaveTextContent('Soon')
    expect(hero()).toHaveTextContent('Savings')
    expect(screen.getByRole('button', { name: /^Later/ })).toHaveAttribute('aria-pressed', 'true')
    expect(mockOpenGoalDialog).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'editGoal' }))
    expect(mockOpenGoalDialog).toHaveBeenCalledWith('later')
  })

  it('falls back to the featured goal after the selected goal is deleted', async () => {
    const user = userEvent.setup()
    mockRemove.mockImplementation(async (id: string) => {
      mockGoals = mockGoals.filter((goal) => goal.id !== id)
    })
    mockGoals = [
      goalFixture({
        id: 'soon',
        name: 'Soon',
        deadline: '2026-02-01',
        progress: 15,
        current_amount: 1500,
      }),
      goalFixture({
        id: 'later',
        name: 'Later',
        deadline: '2026-12-01',
        progress: 70,
        current_amount: 7000,
      }),
    ]

    render(<Goals />)
    await user.click(screen.getByRole('button', { name: /^Later/ }))
    await user.click(screen.getByLabelText('actions.delete Later'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Soon' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Later' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('actions.delete Later')).not.toBeInTheDocument()
    expect(mockRemove).toHaveBeenCalledWith('later')
  })

  it('falls back safely when refresh removes the selection and when no goals remain', async () => {
    const user = userEvent.setup()
    mockGoals = [
      goalFixture({
        id: 'soon',
        name: 'Soon',
        deadline: '2026-03-01',
        currency: 'USD',
        current_amount: 2000,
        progress: 20,
      }),
      goalFixture({
        id: 'later',
        name: 'Later',
        deadline: '2026-09-01',
        currency: 'USD',
        current_amount: 6000,
        progress: 60,
      }),
    ]
    const { rerender } = render(<Goals />)
    await user.click(screen.getByRole('button', { name: /^Later/ }))

    mockGoals = [
      goalFixture({
        id: 'soon',
        name: 'Soon',
        deadline: '2026-03-01',
        currency: 'USD',
        current_amount: 2500,
        progress: 25,
      }),
    ]
    rerender(<Goals />)

    const hero = screen.getByRole('region', { name: /hero\.featuredGoal/ })
    expect(hero).toHaveTextContent('Soon')
    expect(hero).toHaveTextContent('$25.00')
    expect(screen.queryByRole('heading', { name: 'Later' })).not.toBeInTheDocument()

    mockRemove.mockImplementation(async (id: string) => {
      mockGoals = mockGoals.filter((goal) => goal.id !== id)
    })
    await user.click(screen.getByLabelText('actions.delete Soon'))
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(screen.getByText('empty.title')).toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: /hero\.featuredGoal/ })).not.toBeInTheDocument()
    expect(screen.queryByText('error.loadDetailed')).not.toBeInTheDocument()
  })

  it('shows an authoritative aggregate without replacing a goal\u2019s own currency', () => {
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD' })
    mockGoals = [
      goalFixture({
        id: 'eur',
        name: 'Euro Trip',
        currency: 'EUR',
        current_amount: 5000,
        target_amount: 10000,
        deadline: '2026-04-01',
        progress: 50,
        monthlyNeeded: 250,
        accountName: 'Travel',
        mainConversion: {
          complete: true,
          toCurrency: 'USD',
          saved: { complete: true, amountCentavos: 6000, preferredCurrency: 'USD' },
          target: { complete: true, amountCentavos: 12000, preferredCurrency: 'USD' },
        },
      }),
    ]

    render(<Goals />)

    const hero = screen.getByRole('region', { name: /hero\.featuredGoal/ })
    expect(hero).toHaveTextContent('\u20ac50.00')
    expect(hero).toHaveTextContent('\u20ac100.00')
    expect(hero).toHaveTextContent('Travel')
    expect(hero).not.toHaveTextContent('$60.00')
    const summary = screen.getByTestId('goals-aggregate-summary')
    expect(summary).toHaveTextContent('$60.00')
    expect(summary).toHaveTextContent('$120.00')
    expect(summary).toHaveTextContent('USD')
    expect(screen.queryByText('currency.unavailable')).not.toBeInTheDocument()
  })

  it('does not summarize mixed or incomplete conversions as zero or a partial total', () => {
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD' })
    mockGoals = [
      goalFixture({
        id: 'usd',
        name: 'Dollar Goal',
        currency: 'USD',
        current_amount: 1000,
        target_amount: 2000,
        deadline: '2026-04-01',
        progress: 50,
        monthlyNeeded: 100,
        mainConversion: {
          complete: true,
          toCurrency: 'USD',
          saved: { complete: true, amountCentavos: 9999, preferredCurrency: 'USD' },
          target: { complete: true, amountCentavos: 2000, preferredCurrency: 'USD' },
        },
      }),
      goalFixture({
        id: 'eur',
        name: 'Euro Goal',
        currency: 'EUR',
        current_amount: 5000,
        target_amount: 8000,
        deadline: '2026-08-01',
        progress: 40,
        monthlyNeeded: 200,
        mainConversion: {
          complete: false,
          toCurrency: 'USD',
          saved: { complete: false, preferredCurrency: 'USD' },
          target: { complete: false, preferredCurrency: 'USD' },
        },
      }),
    ]

    render(<Goals />)

    expect(screen.queryByTestId('goals-aggregate-summary')).not.toBeInTheDocument()
    expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
    expect(screen.queryByText('$99.99')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /hero\.featuredGoal/ })).toHaveTextContent('$10.00')
    expect(screen.getByRole('region', { name: /hero\.featuredGoal/ })).not.toHaveTextContent(
      '$99.99'
    )
  })

  it('does not sum unlike currencies when each conversion is marked complete', () => {
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD' })
    mockGoals = [
      goalFixture({
        id: 'usd',
        name: 'Dollar',
        currency: 'USD',
        current_amount: 100,
        target_amount: 200,
        deadline: '2026-04-01',
        monthlyNeeded: 10,
        mainConversion: {
          complete: true,
          toCurrency: 'USD',
          saved: { complete: true, amountCentavos: 1111, preferredCurrency: 'USD' },
          target: { complete: true, amountCentavos: 2222, preferredCurrency: 'USD' },
        },
      }),
      goalFixture({
        id: 'eur',
        name: 'Euro',
        currency: 'EUR',
        current_amount: 5000,
        target_amount: 8000,
        deadline: '2026-08-01',
        mainConversion: {
          complete: true,
          toCurrency: 'EUR',
          saved: { complete: true, amountCentavos: 5000, preferredCurrency: 'EUR' },
          target: { complete: true, amountCentavos: 8000, preferredCurrency: 'EUR' },
        },
      }),
    ]

    render(<Goals />)

    expect(screen.queryByTestId('goals-aggregate-summary')).not.toBeInTheDocument()
    expect(screen.queryByText('$11.11')).not.toBeInTheDocument()
    expect(screen.queryByText('$22.22')).not.toBeInTheDocument()
    expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /hero\.featuredGoal/ })).toHaveTextContent('$1.00')
  })

  it('describes a completed goal without a savings trajectory', () => {
    mockGoals = [
      goalFixture({
        name: 'Done',
        progress: 100,
        daysRemaining: -4,
        deadline: '2020-01-01',
        current_amount: 10000,
        monthlyNeeded: 0,
      }),
    ]

    render(<Goals />)

    expect(screen.getAllByText('card.completed').length).toBeGreaterThan(0)
    expect(screen.getByText('hero.statusCompleted')).toBeInTheDocument()
    expect(screen.queryByText('card.overdue')).not.toBeInTheDocument()
    expect(screen.getByText('hero.noMonthlyPace')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps the hero ring ahead of the data and stacks pace metrics below 360px', () => {
    mockGoals = [
      goalFixture({
        id: 'narrow',
        name: 'Narrow',
        deadline: '2026-01-01',
        currency: 'USD',
        current_amount: 5000,
        target_amount: 10000,
      }),
    ]

    render(<Goals />)

    expect(document.querySelector('[data-goal-hero-layout]')?.className).toContain('flex-col')
    expect(document.querySelector('[data-goal-hero-layout]')?.className).toContain('sm:flex-row')
    const pace = document.querySelector('[data-goal-pace]')
    expect(pace?.className).toContain('grid-cols-1')
    expect(pace?.className).toContain('min-[360px]:grid-cols-3')
    expect(screen.getByRole('button', { name: /^Narrow/ })).toHaveClass('min-h-11')
    expect(screen.getByLabelText('actions.edit Narrow')).toHaveClass('h-11', 'w-11')
    expect(screen.getByLabelText('actions.delete Narrow')).toHaveClass('h-11', 'w-11')
    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveAttribute('aria-valuenow', '50')
    expect(progress).toHaveAttribute('aria-valuetext', expect.stringContaining('$50.00'))
    expect(progress).toHaveAttribute('aria-valuetext', expect.stringContaining('$100.00'))
  })
})
