import { useState, type ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewAccountComparison } from '@/components/dashboard/overview-account-comparison'
import type {
  ComparisonDisplayMode,
  ConvertToPreferred,
} from '@/components/dashboard/overview-account-comparison-helpers'
import type { NetWorthPeriod } from '@/components/dashboard/overview-net-worth'
import type { Account } from '@/types/database'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}))

const defaultFirstHistory = [
  { date: '2026-01-01', balance: -20_000 },
  { date: '2026-03-01', balance: -5_000 },
]
const defaultSecondHistory = [
  { date: '2026-02-01', balance: 100_000 },
  { date: '2026-03-01', balance: 120_000 },
]

const history = vi.hoisted(() => ({
  firstHistory: [
    { date: '2026-01-01', balance: -20_000 },
    { date: '2026-03-01', balance: -5_000 },
  ],
  secondHistory: [
    { date: '2026-02-01', balance: 100_000 },
    { date: '2026-03-01', balance: 120_000 },
  ],
  isLoading: false,
  error: null as string | null,
}))

vi.mock('@/components/dashboard/use-overview-account-comparison', () => ({
  useOverviewAccountComparison: () => history,
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('recharts', () => ({
  LineChart: () => null,
  Line: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}))

const accounts = [
  {
    id: 'card',
    name: 'Nu Card',
    type: 'credit_card',
    currency: 'USD',
    balance: -5_000,
  },
  {
    id: 'checking',
    name: 'BBVA',
    type: 'checking',
    currency: 'EUR',
    balance: 120_000,
  },
] as Account[]

function converter(euroRate: number | null): ConvertToPreferred {
  return (amount, currency) =>
    currency === 'USD' || euroRate !== null
      ? {
          complete: true,
          preferredCurrency: 'USD',
          amountCentavos: currency === 'EUR' ? amount * euroRate! : amount,
          missingCurrencies: [],
        }
      : {
          complete: false,
          preferredCurrency: 'USD',
          missingCurrencies: ['EUR'],
          reason: 'missing_exchange_rates',
        }
}

function ComparisonHarness(
  props: Omit<
    ComponentProps<typeof OverviewAccountComparison>,
    'selection' | 'onSelectionChange' | 'period' | 'onPeriodChange' | 'mode' | 'onModeChange'
  >
) {
  const [selection, setSelection] = useState<[string, string]>(['', ''])
  const [period, setPeriod] = useState<NetWorthPeriod>('6m')
  const [mode, setMode] = useState<ComparisonDisplayMode>('balance')
  return (
    <OverviewAccountComparison
      {...props}
      selection={selection}
      onSelectionChange={setSelection}
      period={period}
      onPeriodChange={setPeriod}
      mode={mode}
      onModeChange={setMode}
    />
  )
}

function metricCard(name: string) {
  const term = screen.getAllByText(name).find((element) => element.tagName === 'DT')
  expect(term).toBeTruthy()
  return term!.closest('div')!
}

describe('OverviewAccountComparison', () => {
  beforeEach(() => {
    history.firstHistory = defaultFirstHistory
    history.secondHistory = defaultSecondHistory
    history.isLoading = false
    history.error = null
  })

  it('shows negative card debt, missing dates as dashes, and account-specific change baselines', async () => {
    const user = userEvent.setup()
    render(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={converter(2)}
      />
    )

    expect(screen.getByText('overview.comparison.debtBalance')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('—')).toBeInTheDocument()
    expect(within(rows[2]).getByText('—')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'overview.comparison.change' }))
    expect(screen.getAllByText(/Jan 1, 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Feb 1, 2026/).length).toBeGreaterThan(0)
    expect(within(screen.getAllByRole('row')[3]).getByText('$150.00')).toBeInTheDocument()
    expect(within(screen.getAllByRole('row')[3]).getByText('$400.00')).toBeInTheDocument()
  })

  it('recomputes when preferred currency changes with stable history, rates, and converter identity', () => {
    let preferredCurrency = 'USD'
    const convertToPreferred: ConvertToPreferred = (amount, currency) => ({
      complete: true,
      preferredCurrency,
      amountCentavos:
        currency === preferredCurrency ? amount : amount * (preferredCurrency === 'USD' ? 2 : 0.5),
      missingCurrencies: [],
    })
    const props = {
      accounts,
      rates: { 'EUR:USD': 2, 'USD:EUR': 0.5 },
      invalidRates: [],
      convertToPreferred,
    }
    const { rerender } = render(
      <ComparisonHarness {...props} preferredCurrency={preferredCurrency} />
    )
    expect(screen.getAllByText('$2,400.00').length).toBeGreaterThan(0)

    preferredCurrency = 'EUR'
    rerender(<ComparisonHarness {...props} preferredCurrency={preferredCurrency} />)
    expect(screen.getAllByText('€1,200.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-€25.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('€2,400.00')).not.toBeInTheDocument()
  })

  it('recomputes historical conversion when current rates update and withholds all values for missing or invalid rates', () => {
    const { rerender } = render(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={converter(2)}
      />
    )
    expect(screen.getAllByText('$2,400.00').length).toBeGreaterThan(0)

    rerender(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 3 }}
        invalidRates={[]}
        convertToPreferred={converter(3)}
      />
    )
    expect(screen.getAllByText('$3,600.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('$2,400.00')).not.toBeInTheDocument()

    rerender(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{}}
        invalidRates={[]}
        convertToPreferred={converter(null)}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.missingRates EUR')
    expect(screen.queryByText('$3,600.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()

    rerender(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 3 }}
        invalidRates={[{ fromCurrency: 'EUR', toCurrency: 'USD', rate: '0' }]}
        convertToPreferred={converter(3)}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.invalidConversion')
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()
  })

  it('labels each account with its own latest non-null snapshot date, not the shared series end', async () => {
    history.firstHistory = [
      { date: '2026-01-01', balance: -20_000 },
      { date: '2026-03-01', balance: -5_000 },
    ]
    history.secondHistory = [
      { date: '2026-02-01', balance: 100_000 },
      { date: '2026-04-15', balance: 150_000 },
    ]
    const user = userEvent.setup()
    render(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={converter(2)}
      />
    )

    expect(
      within(metricCard('Nu Card')).getByText(/overview.comparison.lastRecorded Mar 1, 2026/)
    ).toBeInTheDocument()
    expect(within(metricCard('Nu Card')).queryByText(/Apr 15, 2026/)).not.toBeInTheDocument()
    expect(
      within(metricCard('BBVA')).getByText(/overview.comparison.lastRecorded Apr 15, 2026/)
    ).toBeInTheDocument()
    expect(within(metricCard('BBVA')).queryByText(/Mar 1, 2026/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'overview.comparison.change' }))
    expect(
      within(metricCard('Nu Card')).getByText(/overview.comparison.lastRecorded Mar 1, 2026/)
    ).toBeInTheDocument()
    expect(
      within(metricCard('BBVA')).getByText(/overview.comparison.lastRecorded Apr 15, 2026/)
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Jan 1, 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Feb 1, 2026/).length).toBeGreaterThan(0)
  })

  it('does not invent last-recorded dates while loading, on error, or without history', () => {
    history.isLoading = true
    const { rerender } = render(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={converter(2)}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('overview.comparison.loading')
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()

    history.isLoading = false
    history.error = 'history unavailable'
    rerender(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={converter(2)}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.loadError')
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()

    history.error = null
    history.firstHistory = []
    history.secondHistory = []
    rerender(
      <ComparisonHarness
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={converter(2)}
      />
    )
    expect(screen.getByText(/overview.comparison.noHistory/)).toBeInTheDocument()
    expect(screen.queryByText(/overview.comparison.lastRecorded/)).not.toBeInTheDocument()
  })
})
