import type { Debt } from '@/lib/debt-service'
const data = vi.hoisted(() => ({
  accounts: [] as { id: string; currency: string }[],
  debts: [] as Debt[],
  loadDebts: vi.fn(),
  fetchAccounts: vi.fn().mockResolvedValue(undefined),
  setStrategy: vi.fn(),
  setExtraPayment: vi.fn(),
}))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: data.accounts,
    isLoading: false,
    fetch: data.fetchAccounts,
  }),
}))
vi.mock('@/lib/database', () => ({ query: vi.fn().mockResolvedValue([]), execute: vi.fn() }))
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DebtPayoff } from '../debt-payoff'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/debt-store', () => ({
  useDebtStore: () => ({
    debts: data.debts,
    manualDebts: [],
    strategy: 'avalanche',
    extraPayment: 0,
    payoffPlan: null,
    isLoading: false,
    loadDebts: data.loadDebts,
    addManualDebt: vi.fn(),
    removeDebt: vi.fn(),
    setStrategy: data.setStrategy,
    setExtraPayment: data.setExtraPayment,
  }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: () => <div data-testid="debt-chart" />,
}))

describe('DebtPayoff', () => {
  beforeEach(() => {
    data.accounts = []
    data.debts = []
    vi.clearAllMocks()
  })
  it('renders empty state when no debts', () => {
    render(<DebtPayoff />)

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByText('empty.title')).toBeInTheDocument()
  })

  it('renders add debt form with labeled inputs after opening', async () => {
    const user = userEvent.setup()
    render(<DebtPayoff />)

    await user.click(screen.getByRole('button', { name: 'addDebt.button' }))

    expect(screen.getByLabelText('addDebt.name')).toBeInTheDocument()
    expect(screen.getByLabelText('addDebt.balance')).toBeInTheDocument()
    expect(screen.getByLabelText('addDebt.apr')).toBeInTheDocument()
    expect(screen.getByLabelText('addDebt.minPayment')).toBeInTheDocument()
  })
  it('groups real debts by currency and preserves strategy and extra-payment actions', async () => {
    data.accounts = [
      { id: 'usd', currency: 'USD' },
      { id: 'eur', currency: 'EUR' },
    ]
    data.debts = [
      { id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 10 },
      { id: 'eur', name: 'EUR debt', balance: 20000, minPayment: 2500, apr: 20 },
    ]
    const user = userEvent.setup()
    render(<DebtPayoff />)
    const total = screen.getByText('summary.totalDebt').parentElement!
    expect(within(total).getByText('$100.00')).toBeInTheDocument()
    expect(screen.queryByText('$300.00')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'EUR')
    expect(within(total).getByText('€200.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /strategy.snowball/ }))
    expect(data.setStrategy).toHaveBeenCalledWith('snowball')
    await user.type(screen.getByLabelText('extraPayment.title'), '12')
    expect(data.setExtraPayment).toHaveBeenCalled()
    expect(screen.getByText('chart.data')).toBeInTheDocument()
  })

  it('does not publish partial totals when account currency metadata is missing', () => {
    data.debts = [
      { id: 'unknown', name: 'Unresolved debt', balance: 10000, minPayment: 2500, apr: 0 },
    ]
    render(<DebtPayoff />)
    expect(screen.getByRole('status')).toHaveTextContent('Unresolved debt')
    expect(screen.queryByText('summary.totalDebt')).not.toBeInTheDocument()
    expect(screen.queryByTestId('debt-chart')).not.toBeInTheDocument()
  })
})
