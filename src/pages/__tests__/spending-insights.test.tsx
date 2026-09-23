import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'
import { SpendingInsights } from '../spending-insights'

const mockLoadComparisons = vi.fn()

const mockLoadRates = vi.fn().mockResolvedValue(undefined)
const mockManualRates: DatedExchangeRate[] = []

let mockState = {
  evidence: [],
  authority: { mainCurrency: 'USD', manualRates: mockManualRates, today: '2026-06-18' },
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
    mainCurrency: 'USD',
    manualRates: mockManualRates,
    loadRates: mockLoadRates,
  }),
}))

vi.mock('@/stores/spending-insights-store', () => ({
  useSpendingInsightsStore: () => ({
    ...mockState,
    loadComparisons: mockLoadComparisons,
  }),
}))

const defaultInsight = {
  id: 'insight-1',
  type: 'increase' as const,
  categoryName: 'Food',
  categoryColor: '#f97316',
  message: 'Food is up 40% vs your 3-month average',
  amount: 8000,
  changePercent: 40,
  severity: 'warning' as const,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SpendingInsights />
    </MemoryRouter>
  )
}

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
      insights: [defaultInsight],
    }
  })

  it('loads comparisons and keeps insight, month, and year views', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(mockLoadComparisons).toHaveBeenCalled()
    expect(screen.getByText('Food is up 40% vs your 3-month average')).toBeInTheDocument()
    expect(screen.queryByText('spendingInsights.quietNextSteps')).not.toBeInTheDocument()

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

    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('spendingInsights.incompleteTotals')
    expect(screen.queryByText('Food is up 40% vs your 3-month average')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.queryByText('spendingInsights.quietNextSteps')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'spendingInsights.openReports' })
    ).not.toBeInTheDocument()
  })

  it('keeps quiet success distinct and offers Reports and Heatmap next steps', () => {
    mockState = {
      ...mockState,
      insights: [],
    }

    renderPage()

    expect(screen.getByText('spendingInsights.insightsEmpty')).toBeInTheDocument()
    expect(screen.getByText('spendingInsights.quietNextSteps')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'spendingInsights.openReports' })).toHaveAttribute(
      'href',
      '/reports'
    )
    expect(screen.getByRole('link', { name: 'spendingInsights.openHeatmap' })).toHaveAttribute(
      'href',
      '/spending-heatmap'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('spendingInsights.loadError')).not.toBeInTheDocument()
    expect(screen.queryByText('spendingInsights.incompleteTotals')).not.toBeInTheDocument()
  })
})
