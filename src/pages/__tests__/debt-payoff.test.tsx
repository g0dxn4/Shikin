import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    debts: [],
    manualDebts: [],
    strategy: 'avalanche',
    extraPayment: 0,
    payoffPlan: null,
    isLoading: false,
    loadDebts: vi.fn(),
    addManualDebt: vi.fn(),
    removeDebt: vi.fn(),
    setStrategy: vi.fn(),
    setExtraPayment: vi.fn(),
  }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('DebtPayoff', () => {
  it('renders empty state when no debts', () => {
    render(<DebtPayoff />)

    expect(screen.getByText('title')).toBeInTheDocument()
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
})
