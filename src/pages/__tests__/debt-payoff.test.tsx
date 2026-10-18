import { calculatePayoffPlan, type Debt } from '@/lib/debt-service'
import { formatMoney } from '@/lib/money'

function hasExactClass(root: HTMLElement, className: string) {
  return [root, ...root.querySelectorAll('*')].some((element) =>
    element.classList.contains(className)
  )
}
const data = vi.hoisted(() => ({
  accounts: [] as { id: string; currency: string }[],
  debts: [] as Debt[],
  manualDebts: [] as Debt[],
  strategy: 'avalanche' as 'avalanche' | 'snowball',
  loadDebts: vi.fn(),
  fetchAccounts: vi.fn().mockResolvedValue(undefined),
  setStrategy: vi.fn(),
  setExtraPayment: vi.fn(),
  removeDebt: vi.fn(),
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
import { fireEvent, render, screen, within } from '@testing-library/react'
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
    manualDebts: data.manualDebts,
    strategy: data.strategy,
    extraPayment: 0,
    payoffPlan: null,
    isLoading: false,
    loadDebts: data.loadDebts,
    addManualDebt: vi.fn(),
    removeDebt: data.removeDebt,
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
    data.manualDebts = []
    data.strategy = 'avalanche'
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
    expect(screen.queryByText('payoffOrder.title')).not.toBeInTheDocument()
    expect(screen.queryByText('comparison.avalancheMonths')).not.toBeInTheDocument()
  })

  it('accepts a finite extra payment of 12.34 as 1234 centavos', () => {
    data.accounts = [{ id: 'usd', currency: 'USD' }]
    data.debts = [{ id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 0 }]
    render(<DebtPayoff />)

    fireEvent.change(screen.getByLabelText('extraPayment.title'), { target: { value: '12.34' } })

    expect(data.setExtraPayment).toHaveBeenCalledWith(1234)
  })

  it('rejects fractional-cent precision without replacing the last accepted payment', () => {
    data.accounts = [{ id: 'usd', currency: 'USD' }]
    data.debts = [{ id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 0 }]
    render(<DebtPayoff />)
    const input = screen.getByLabelText('extraPayment.title') as HTMLInputElement

    fireEvent.change(input, { target: { value: '12.34' } })
    expect(data.setExtraPayment).toHaveBeenCalledWith(1234)
    data.setExtraPayment.mockClear()
    fireEvent.change(input, { target: { value: '12.345' } })

    expect(input.validity.stepMismatch).toBe(true)
    expect(input).toHaveValue(12.345)
    expect(data.setExtraPayment).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('extraPayment.invalid')

    fireEvent.change(input, { target: { value: '12.34' } })
    expect(data.setExtraPayment).toHaveBeenCalledExactlyOnceWith(1234)
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('treats a cleared extra payment as intentional zero', () => {
    data.accounts = [{ id: 'usd', currency: 'USD' }]
    data.debts = [{ id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 0 }]
    render(<DebtPayoff />)
    const input = screen.getByLabelText('extraPayment.title')

    fireEvent.change(input, { target: { value: '12.34' } })
    data.setExtraPayment.mockClear()
    fireEvent.change(input, { target: { value: '' } })

    expect(data.setExtraPayment).toHaveBeenCalledWith(0)
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rejects a negative extra payment without calling the store and shows an accessible error', () => {
    data.accounts = [{ id: 'usd', currency: 'USD' }]
    data.debts = [{ id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 0 }]
    render(<DebtPayoff />)
    const input = screen.getByLabelText('extraPayment.title')

    fireEvent.change(input, { target: { value: '12.34' } })
    expect(data.setExtraPayment).toHaveBeenCalledWith(1234)
    data.setExtraPayment.mockClear()

    fireEvent.change(input, { target: { value: '-50' } })

    expect(data.setExtraPayment).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'extra-payment-error')
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('extraPayment.invalid')
    expect(error).toHaveAttribute('id', 'extra-payment-error')
  })

  it('clears extra payment validation after a valid amount is entered', () => {
    data.accounts = [{ id: 'usd', currency: 'USD' }]
    data.debts = [{ id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 0 }]
    render(<DebtPayoff />)
    const input = screen.getByLabelText('extraPayment.title')

    fireEvent.change(input, { target: { value: '-50' } })
    expect(screen.getByRole('alert')).toHaveTextContent('extraPayment.invalid')

    fireEvent.change(input, { target: { value: '10' } })

    expect(data.setExtraPayment).toHaveBeenCalledWith(1000)
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the selected-currency trajectory with the controls and an exact schedule table', () => {
    data.accounts = [
      { id: 'usd', currency: 'USD' },
      { id: 'eur', currency: 'EUR' },
    ]
    data.debts = [
      { id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 10 },
      { id: 'eur', name: 'EUR debt', balance: 20000, minPayment: 2500, apr: 20 },
    ]
    data.manualDebts = [
      { id: 'manual', name: 'Manual loan', balance: 5000, minPayment: 1000, apr: 0 },
    ]
    const { container } = render(<DebtPayoff />)
    const hero = screen.getByTestId('debt-scenario')
    const chart = screen.getByTestId('debt-chart')
    const total = screen.getByText('summary.totalDebt').parentElement!

    expect(hero).toContainElement(chart)
    expect(hero).toContainElement(screen.getByRole('button', { name: /strategy.avalanche/ }))
    expect(hero).toContainElement(screen.getByLabelText('extraPayment.title'))
    expect(screen.getByRole('button', { name: /strategy.avalanche/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /strategy.snowball/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: /strategy.avalanche/ }).className).toMatch(/min-h-11/)
    expect(screen.getByRole('combobox').className).toMatch(/min-h-11/)
    expect(chart.parentElement).toHaveClass('min-w-0')
    expect(hero.querySelector('[data-trajectory]')).toHaveAttribute(
      'data-trajectory',
      'var(--color-chart-1)'
    )
    expect(hero.innerHTML).not.toContain('var(--color-primary)')
    expect(hasExactClass(container, 'text-primary')).toBe(false)
    expect(
      hero.compareDocumentPosition(screen.getByText('comparison.avalancheMonths')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(within(total).getByText('$150.00')).toBeInTheDocument()
    expect(screen.queryByText('€200.00')).not.toBeInTheDocument()
    expect(screen.queryByText('$350.00')).not.toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'chart.title' })
    const plan = calculatePayoffPlan([data.debts[0], data.manualDebts[0]], 'avalanche', 0)
    expect(within(table).getAllByRole('row')).toHaveLength(plan.schedule.length + 1)
    expect(
      within(table).getAllByText(formatMoney(plan.schedule[0].totalBalance, 'USD')).length
    ).toBeGreaterThan(0)
    expect(within(table).queryByText('€200.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('debtCard.manual')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'actions.delete' }))
    expect(data.removeDebt).toHaveBeenCalledExactlyOnceWith('manual')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('colors snowball with the cool chart token and still blocks unknown-currency order', () => {
    data.strategy = 'snowball'
    data.accounts = [{ id: 'usd', currency: 'USD' }]
    data.debts = [{ id: 'usd', name: 'USD debt', balance: 10000, minPayment: 2500, apr: 0 }]
    render(<DebtPayoff />)
    expect(screen.getByTestId('debt-scenario').querySelector('[data-trajectory]')).toHaveAttribute(
      'data-trajectory',
      'var(--color-chart-3)'
    )
    expect(screen.getByRole('button', { name: /strategy.snowball/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})
