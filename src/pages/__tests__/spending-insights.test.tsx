import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpendingInsights } from '../spending-insights'

const mockLoadComparisons = vi.fn()

let mockState = {
  momComparisons: [
    {
      categoryName: 'Food',
      categoryColor: '#f97316',
      current: 20000,
      previous: 10000,
      change: 10000,
      changePercent: 100,
    },
  ],
  momCurrentTotal: 20000,
  momPreviousTotal: 10000,
  yoyComparisons: [],
  yoyCurrentTotal: 20000,
  yoyPreviousTotal: 0,
  insights: [
    {
      id: 'insight-1',
      type: 'increase' as const,
      categoryName: 'Food',
      categoryColor: '#f97316',
      message: 'Food is up 40% vs your 3-month average',
      amount: 8000,
      changePercent: 40,
      severity: 'warning' as const,
    },
  ],
  isLoading: false,
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/spending-insights-store', () => ({
  useSpendingInsightsStore: () => ({
    ...mockState,
    loadComparisons: mockLoadComparisons,
  }),
}))

describe('SpendingInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState = {
      ...mockState,
      isLoading: false,
      yoyComparisons: [],
    }
  })

  it('loads comparisons and keeps insight, month, and year views', async () => {
    const user = userEvent.setup()
    render(<SpendingInsights />)

    expect(mockLoadComparisons).toHaveBeenCalled()
    expect(screen.getByText('Food is up 40% vs your 3-month average')).toBeInTheDocument()

    await user.click(screen.getByText('spendingInsights.tabs.mom'))
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0)

    await user.click(screen.getByText('spendingInsights.tabs.yoy'))
    expect(screen.getByText('spendingInsights.noData')).toBeInTheDocument()
  })
})
