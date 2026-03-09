import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Investments } from '../investments'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openInvestmentDialog: vi.fn(),
  }),
}))

vi.mock('@/stores/investment-store', () => ({
  useInvestmentStore: () => ({
    investments: [],
    isLoading: false,
    fetch: vi.fn(),
    remove: vi.fn(),
    priceHistory: new Map(),
    portfolioSummary: { totalValue: 0, totalCostBasis: 0, totalGainLoss: 0, totalGainLossPercent: 0, byType: {} },
    lastPriceFetch: null,
    fetchPriceHistory: vi.fn(),
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    fetch: vi.fn(),
  }),
}))

vi.mock('@/lib/price-service', () => ({
  fetchAllCurrentPrices: vi.fn().mockResolvedValue(new Map()),
  savePricesToDB: vi.fn(),
}))

vi.mock('recharts', () => ({
  AreaChart: () => null,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
}))

vi.mock('dayjs/plugin/relativeTime', () => ({ default: () => {} }))

describe('Investments', () => {
  it('renders title', () => {
    render(<Investments />)

    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('renders empty state text', () => {
    render(<Investments />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
  })
})
