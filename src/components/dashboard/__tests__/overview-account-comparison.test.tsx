import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OverviewAccountComparison } from '@/components/dashboard/overview-account-comparison'
import type { ConvertToPreferred } from '@/components/dashboard/overview-account-comparison-helpers'
import type { Account } from '@/types/database'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}))

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
  error: null,
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

describe('OverviewAccountComparison', () => {
  it('shows negative card debt, missing dates as dashes, and account-specific change baselines', async () => {
    const user = userEvent.setup()
    render(
      <OverviewAccountComparison
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
      <OverviewAccountComparison {...props} preferredCurrency={preferredCurrency} />
    )
    expect(screen.getAllByText('$2,400.00').length).toBeGreaterThan(0)

    preferredCurrency = 'EUR'
    rerender(<OverviewAccountComparison {...props} preferredCurrency={preferredCurrency} />)
    expect(screen.getAllByText('€1,200.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-€25.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('€2,400.00')).not.toBeInTheDocument()
  })

  it('recomputes historical conversion when current rates update and withholds all values for missing or invalid rates', () => {
    const { rerender } = render(
      <OverviewAccountComparison
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 2 }}
        invalidRates={[]}
        convertToPreferred={converter(2)}
      />
    )
    expect(screen.getAllByText('$2,400.00').length).toBeGreaterThan(0)

    rerender(
      <OverviewAccountComparison
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
      <OverviewAccountComparison
        accounts={accounts}
        preferredCurrency="USD"
        rates={{}}
        invalidRates={[]}
        convertToPreferred={converter(null)}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.missingRates EUR')
    expect(screen.queryByText('$3,600.00')).not.toBeInTheDocument()

    rerender(
      <OverviewAccountComparison
        accounts={accounts}
        preferredCurrency="USD"
        rates={{ 'EUR:USD': 3 }}
        invalidRates={[{ fromCurrency: 'EUR', toCurrency: 'USD', rate: '0' }]}
        convertToPreferred={converter(3)}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('overview.comparison.invalidConversion')
  })
})
