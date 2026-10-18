import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'

function hasExactClass(root: HTMLElement, className: string) {
  return [root, ...root.querySelectorAll('*')].some((element) =>
    element.classList.contains(className)
  )
}
import userEvent from '@testing-library/user-event'
import { Forecast } from '../forecast'
import { useForecastStore } from '@/stores/forecast-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { captureReportingContext, projectGrossRows } from '@/lib/dated-reporting-read'
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
  authority: captureReportingContext(),
  estimateAsOf: '2028-01-01',
  evidence: projectGrossRows([], captureReportingContext()),
  nativeBalances: [],
  complete: true as const,
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
    useCurrencyStore.setState({ preferredCurrency: 'USD', mainCurrency: 'USD', manualRates: [] })
    forecast.authority = captureReportingContext()
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
    const hero = screen.getByTestId('forecast-hero')
    const chart = screen.getByTestId('chart')
    expect(hero).toContainElement(chart)
    expect(chart.parentElement).toHaveClass('min-w-0')
    expect(hero.querySelector('[data-projected-stroke]')).toHaveAttribute(
      'data-projected-stroke',
      'var(--color-chart-1)'
    )
    expect(hero.innerHTML).not.toContain('var(--color-primary)')
    expect(hasExactClass(hero, 'text-primary')).toBe(false)
    expect(screen.getByRole('combobox').className).toMatch(/min-h-11/)
    expect(screen.getByRole('button', { name: 'range.30' }).className).toMatch(/min-h-11/)
    expect(screen.getByText('hero.estimateNote')).toBeInTheDocument()
    expect(screen.getByText(/currency\.estimate/)).toBeInTheDocument()
    expect(screen.getByText('metrics.projectedEnd')).toBeInTheDocument()
    for (const label of ['metrics.dailyBurn', 'metrics.dailyIncome', 'metrics.lowestProjected']) {
      expect(
        chart.compareDocumentPosition(screen.getByText(label)) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    const projection = screen.getByRole('table', { name: 'chart.title' })
    expect(within(projection).getAllByRole('row')).toHaveLength(forecast.points.length + 1)
    expect(within(projection).getByText('2028-01-01')).toBeInTheDocument()
    expect(within(projection).getByText('$100.00')).toBeInTheDocument()
    expect(within(projection).getByText('$110.00')).toBeInTheDocument()
    expect(within(projection).getByText('$90.00')).toBeInTheDocument()
    expect(within(projection).queryByText('€12.34')).not.toBeInTheDocument()
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
      currentBalance: null,
      dailyIncome: null,
      dailyBurnRate: null,
      minBalance: { date: '2028-01-01', amount: null },
      points: [],
      missingCurrencies: ['EUR'],
    })
    render(<Forecast />)
    await screen.findByText('currency.unavailable')
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('forecast-hero')).not.toBeInTheDocument()
    expect(screen.queryByText('metrics.currentBalance')).not.toBeInTheDocument()
    expect(screen.queryByText('metrics.dailyBurn')).not.toBeInTheDocument()
    expect(screen.queryByText('metrics.dailyIncome')).not.toBeInTheDocument()
    expect(screen.queryByText('chart.data')).not.toBeInTheDocument()
    expect(screen.queryByText('danger.noDanger')).not.toBeInTheDocument()
    expect(screen.getByText(/currency\.nativeHistory/)).toBeInTheDocument()
    expect(screen.getByText(/currency\.nativeBalances/)).toBeInTheDocument()
  })
  it('separates recurring-cost columns with gutters and local horizontal scrolling', async () => {
    render(<Forecast />)
    const amountHeader = await screen.findByRole('columnheader', { name: 'table.amount' })
    const frequencyHeader = screen.getByRole('columnheader', { name: 'table.frequency' })
    const nextDateHeader = screen.getByRole('columnheader', { name: 'table.nextDate' })
    const table = amountHeader.closest('table')
    expect(table).not.toBeNull()
    expect(table?.className).toMatch(/w-max/)
    expect(table?.className).toMatch(/min-w-full/)
    expect(table?.parentElement?.className).toMatch(/overflow-x-auto/)
    expect(table?.parentElement?.className).toMatch(/max-w-full/)
    for (const header of [amountHeader, frequencyHeader, nextDateHeader]) {
      expect(header.className).toMatch(/px-3/)
      expect(header.className).toMatch(/whitespace-nowrap/)
    }
    const amountCell = screen.getByText('€12.34')
    expect(amountCell.className).toMatch(/px-3/)
    expect(amountCell.className).toMatch(/whitespace-nowrap/)
  })

  it('stacks the account scope above the range actions so the select cannot collapse', async () => {
    render(<Forecast />)
    await screen.findByRole('option', { name: 'scope.allAccounts' })
    await waitFor(() => expect(query).toHaveBeenCalled())
    const toolbar = document.querySelector('.page-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.className).toMatch(/(?:^|\s)flex-col(?:\s|$)/)
    expect(toolbar?.className).toMatch(/(?:^|\s)items-stretch(?:\s|$)/)
    expect(toolbar?.className).toMatch(/(?:^|\s)sm:flex-row(?:\s|$)/)
    expect(toolbar?.className).toMatch(/(?:^|\s)sm:items-center(?:\s|$)/)
    expect(toolbar?.className).not.toMatch(/(?:^|\s)items-center(?:\s|$)/)
    expect(toolbar?.className).toContain('max-sm:[&>div]:w-full')
    expect(toolbar?.className).toContain('max-sm:[&>div]:min-w-0')

    const slots = toolbar ? [...toolbar.children] : []
    expect(slots).toHaveLength(2)
    expect(slots.every((slot) => slot.tagName === 'DIV')).toBe(true)

    const select = screen.getByRole('combobox')
    expect(slots[0]).toContainElement(select)
    expect(select.className).toMatch(/(?:^|\s)w-full(?:\s|$)/)
    expect(select.className).toMatch(/(?:^|\s)min-w-0(?:\s|$)/)
    expect(select.className).toMatch(/(?:^|\s)max-w-full(?:\s|$)/)
    expect(select.className).toMatch(/min-h-11/)
    expect(select.className).toMatch(/sm:w-auto/)
    expect(select.parentElement?.className).toMatch(/(?:^|\s)w-full(?:\s|$)/)
    expect(select.parentElement?.className).toMatch(/sm:w-auto/)
    expect(screen.getByRole('option', { name: 'scope.allAccounts' })).toBeInTheDocument()
    expect((select as HTMLSelectElement).value).toBe('')

    const rangeGroup = screen.getByRole('group', { name: 'range.label' })
    expect(slots[1]).toContainElement(rangeGroup)
    expect(rangeGroup.className).toMatch(/flex-wrap/)
    expect(rangeGroup.className).toMatch(/max-w-full/)
    for (const name of ['range.30', 'range.60', 'range.90']) {
      const button = screen.getByRole('button', { name })
      expect(rangeGroup).toContainElement(button)
      expect(button.className).toMatch(/min-h-11/)
      expect(button.className).toMatch(/min-w-11/)
      expect(button.className).toMatch(/shrink-0/)
    }
  })

  it('surfaces forecast and subscriptions read errors', async () => {
    vi.mocked(generateCashFlowForecast).mockRejectedValue(new Error('Forecast read failed'))
    vi.mocked(query).mockRejectedValue(new Error('Subscription read failed'))
    render(<Forecast />)
    expect(await screen.findByText('Forecast read failed')).toBeInTheDocument()
    expect(await screen.findByText('Subscription read failed')).toBeInTheDocument()
  })
})
