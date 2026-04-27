import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReportsPage } from '../reports'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [{ id: 'account-1', balance: 250000, currency: 'USD', is_archived: 0 }],
    fetch: vi.fn(),
    isLoading: false,
  }),
}))

vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: () => ({
    budgets: [{ id: 'budget-1', amount: 100000, spent: 25000 }],
    fetch: vi.fn(),
    isLoading: false,
  }),
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({
    transactions: [
      {
        id: 'tx-1',
        type: 'expense',
        amount: 25000,
        date: new Date().toISOString().slice(0, 10),
        category_name: 'Food',
        category_color: '#30d158',
      },
      {
        id: 'tx-2',
        type: 'income',
        amount: 500000,
        date: new Date().toISOString().slice(0, 10),
      },
    ],
    fetch: vi.fn(),
    isLoading: false,
  }),
}))

describe('ReportsPage', () => {
  it('renders a usable monthly report from local data', () => {
    render(<ReportsPage />)

    expect(screen.getByText('reports.title')).toBeInTheDocument()
    expect(screen.getByText('reports.categoryBreakdown')).toBeInTheDocument()
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })
})
