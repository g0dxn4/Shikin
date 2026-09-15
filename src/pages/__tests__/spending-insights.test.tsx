import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpendingInsights } from '../spending-insights'

const mockLoadComparisons = vi.fn()

const mockLoadRates = vi.fn().mockResolvedValue(undefined)
const mockRates: Record<string, number> = {}
const mockInvalidRates: Array<{ fromCurrency: string; toCurrency: string; rate: string }> = []

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
  complete: true,
  currency: 'USD',
  missingCurrencies: [] as string[],
  reason: null as 'missing_exchange_rates' | 'invalid_currency_data' | 'read_error' | null,
  error: null as string | null,
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
    preferredCurrency: 'USD',
    rates: mockRates,
    invalidRates: mockInvalidRates,
    loadRates: mockLoadRates,
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
      complete: true,
      error: null,
      reason: null,
      missingCurrencies: [],
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
    expect(mockLoadRates).toHaveBeenCalled()
  })

  it('shows a missing-rate state instead of zero totals or fake insights', () => {
    mockState = {
      ...mockState,
      complete: false,
      reason: 'missing_exchange_rates',
      missingCurrencies: ['EUR'],
      momCurrentTotal: 0,
      insights: [],
    }

    render(<SpendingInsights />)

    expect(screen.getByRole('alert')).toHaveTextContent('spendingInsights.incompleteTotals')
    expect(screen.queryByText('Food is up 40% vs your 3-month average')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })
})
