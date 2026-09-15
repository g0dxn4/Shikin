import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Forecast } from '../forecast'
import { useForecastStore } from '@/stores/forecast-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { generateCashFlowForecast } from '@/lib/forecast-service'
import { query } from '@/lib/database'
const { fetchAccounts, accounts } = vi.hoisted(() => ({
  fetchAccounts: vi.fn().mockResolvedValue(undefined),
  accounts: [{ id: 'eur', name: 'Euro account', currency: 'EUR', is_archived: 0 }],
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/forecast-service', () => ({ generateCashFlowForecast: vi.fn() }))
vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({ accounts, fetch: fetchAccounts }),
}))
vi.mock('@/components/ui/safe-chart', () => ({ SafeChart: () => <div data-testid="chart" /> }))
const forecast = {
  complete: true,
  currency: 'USD',
  missingCurrencies: [],
  points: [{ date: '2028-01-01', projected: 10000, optimistic: 11000, pessimistic: 9000 }],
  currentBalance: 10000,
  dailyBurnRate: 100,
  dailyIncome: 200,
  minBalance: { date: '2028-01-01', amount: 10000 },
  dangerDates: [],
}

describe('Forecast native view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useForecastStore.setState({
      forecast: null,
      selectedRange: 30,
      accountId: undefined,
      dangerThreshold: 0,
      error: null,
    })
    useCurrencyStore.setState({ preferredCurrency: 'USD', rates: {}, invalidRates: [] })
    vi.mocked(generateCashFlowForecast).mockResolvedValue(forecast)
    vi.mocked(query).mockResolvedValue([
      {
        id: 'sub',
        name: 'Euro subscription',
        amount: 1234,
        currency: 'EUR',
        billing_cycle: 'monthly',
        next_billing_date: '2028-01-01',
      },
    ])
  })
  it('retains real horizons, account scope, accessible chart data and subscription currencies', async () => {
    const user = userEvent.setup()
    render(<Forecast />)
    await screen.findByText('chart.data')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByText('€12.34')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'range.60' }))
    await waitFor(() =>
      expect(generateCashFlowForecast).toHaveBeenLastCalledWith(60, 0, { accountId: undefined })
    )
    await user.selectOptions(screen.getByRole('combobox'), 'eur')
    await waitFor(() =>
      expect(generateCashFlowForecast).toHaveBeenLastCalledWith(60, 0, { accountId: 'eur' })
    )
    expect(screen.getByRole('button', { name: 'range.60' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      vi
        .mocked(query)
        .mock.calls.some(
          ([sql, params]) => sql.includes('AND s.account_id = ?') && params?.[0] === 'eur'
        )
    ).toBe(true)
  })
  it('shows missing-rate diagnostics instead of any partial chart or safe-balance alert', async () => {
    vi.mocked(generateCashFlowForecast).mockResolvedValue({
      ...forecast,
      complete: false,
      points: [],
      missingCurrencies: ['EUR'],
    })
    render(<Forecast />)
    await screen.findByText('currency.unavailable')
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument()
    expect(screen.queryByText('metrics.currentBalance')).not.toBeInTheDocument()
    expect(screen.queryByText('danger.noDanger')).not.toBeInTheDocument()
  })
  it('surfaces forecast and subscriptions read errors', async () => {
    vi.mocked(generateCashFlowForecast).mockRejectedValue(new Error('Forecast read failed'))
    vi.mocked(query).mockRejectedValue(new Error('Subscription read failed'))
    render(<Forecast />)
    expect(await screen.findByText('Forecast read failed')).toBeInTheDocument()
    expect(await screen.findByText('Subscription read failed')).toBeInTheDocument()
  })
})
