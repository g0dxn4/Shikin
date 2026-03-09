import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell } from '../app-shell'

vi.mock('react-router', () => ({
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  useLocation: () => ({ pathname: '/' }),
}))

vi.mock('../bottom-nav', () => ({
  BottomNav: () => <div data-testid="bottom-nav">Bottom Nav</div>,
}))

vi.mock('../sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}))

vi.mock('../ai-panel', () => ({
  AIPanel: () => <div data-testid="ai-panel">AI Panel</div>,
}))

vi.mock('@/components/accounts/account-dialog', () => ({
  AccountDialog: () => <div data-testid="account-dialog">Account Dialog</div>,
}))

vi.mock('@/components/transactions/transaction-dialog', () => ({
  TransactionDialog: () => <div data-testid="transaction-dialog">Transaction Dialog</div>,
}))

vi.mock('@/components/budgets/budget-dialog', () => ({
  BudgetDialog: () => <div data-testid="budget-dialog">Budget Dialog</div>,
}))

vi.mock('@/components/ui/loading-spinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}))

describe('AppShell', () => {
  it('renders sidebar, outlet, and ai-panel', () => {
    render(<AppShell />)

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('renders both lazy dialogs', async () => {
    render(<AppShell />)

    expect(await screen.findByTestId('account-dialog')).toBeInTheDocument()
    expect(await screen.findByTestId('transaction-dialog')).toBeInTheDocument()
    expect(await screen.findByTestId('budget-dialog')).toBeInTheDocument()
  })

  it('has correct layout structure', () => {
    const { container } = render(<AppShell />)

    const wrapper = container.firstElementChild
    expect(wrapper).toHaveClass('flex', 'h-screen')
  })
})
