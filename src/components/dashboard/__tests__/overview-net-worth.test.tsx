import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { OverviewNetWorth } from '@/components/dashboard/overview-net-worth'
import type { ConvertToPreferred } from '@/components/dashboard/overview-account-comparison-helpers'
import type { Account } from '@/types/database'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}))

vi.mock('@/components/dashboard/use-overview-account-comparison', () => ({
  useOverviewAccountComparison: () => ({
    firstHistory: [
      { date: '2026-01-01', balance: 10_000 },
      { date: '2026-03-01', balance: 12_000 },
    ],
    secondHistory: [
      { date: '2026-02-01', balance: 20_000 },
      { date: '2026-03-01', balance: 22_000 },
    ],
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('recharts', () => ({
  AreaChart: () => null,
  Area: () => null,
  LineChart: () => null,
  Line: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}))

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
})

const accounts = [
  { id: 'nu', name: 'Nu Card', type: 'credit_card', currency: 'USD', balance: -5_000 },
  { id: 'bbva', name: 'BBVA', type: 'checking', currency: 'USD', balance: 80_000 },
  { id: 'savings', name: 'Savings', type: 'savings', currency: 'USD', balance: 40_000 },
] as Account[]

const convertToPreferred: ConvertToPreferred = (amount) => ({
  complete: true,
  preferredCurrency: 'USD',
  amountCentavos: amount,
  missingCurrencies: [],
})

function renderOverview() {
  return render(
    <OverviewNetWorth
      currentComplete
      currentAmount={115_000}
      currentCurrency="USD"
      income="$10.00"
      spent="$4.00"
      saved="$6.00"
      savedTone="positive"
      cashFlowLabel="April 2026 cash flow"
      asOfLabel="As of April 18, 2026"
      history={[
        { date: '2026-01-01', netWorth: 100_000 },
        { date: '2026-03-01', netWorth: 115_000 },
      ]}
      period="6m"
      onPeriodChange={() => {}}
      historyCurrency="USD"
      emptyHistoryMessage="No history"
      accounts={accounts}
      preferredCurrency="USD"
      rates={{}}
      invalidRates={[]}
      convertToPreferred={convertToPreferred}
    />
  )
}

describe('OverviewNetWorth comparison controls', () => {
  it('keeps comparison accounts, range, and mode across Summary and History', async () => {
    const user = userEvent.setup()
    renderOverview()

    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    expect(screen.getByLabelText('overview.comparison.firstAccount')).toHaveTextContent('Nu Card')
    expect(screen.getByLabelText('overview.comparison.secondAccount')).toHaveTextContent('BBVA')

    await user.click(screen.getByLabelText('overview.comparison.secondAccount'))
    await user.click(await screen.findByRole('option', { name: 'Savings' }))
    await user.click(screen.getByRole('button', { name: 'overview.period.1y' }))
    await user.click(screen.getByRole('button', { name: 'overview.comparison.change' }))

    expect(screen.getByLabelText('overview.comparison.secondAccount')).toHaveTextContent('Savings')
    expect(screen.getByRole('button', { name: 'overview.period.1y' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'overview.comparison.change' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(screen.getByRole('tab', { name: 'overview.views.summary' }))
    expect(screen.queryByLabelText('overview.comparison.firstAccount')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'overview.views.history' }))
    expect(screen.getByText('overview.netWorthHistory')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'overview.views.comparison' }))
    expect(screen.getByLabelText('overview.comparison.firstAccount')).toHaveTextContent('Nu Card')
    expect(screen.getByLabelText('overview.comparison.secondAccount')).toHaveTextContent('Savings')
    expect(screen.getByRole('button', { name: 'overview.period.1y' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'overview.comparison.change' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'overview.period.6m' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'overview.comparison.balance' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})
