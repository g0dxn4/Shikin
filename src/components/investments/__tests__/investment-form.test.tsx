import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvestmentForm } from '../investment-form'

const mockAccounts: Array<{ id: string; name: string; type: string }> = []
let mockAccountsLoading = false
let mockAccountsFetchError: string | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: mockAccounts,
    isLoading: mockAccountsLoading,
    fetchError: mockAccountsFetchError,
  }),
}))

describe('InvestmentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccountsLoading = false
    mockAccountsFetchError = null
    mockAccounts.length = 0
  })

  it('shows loading skeleton while accounts are loading', () => {
    mockAccountsLoading = true

    render(<InvestmentForm onSubmit={vi.fn()} />)

    // Should show skeleton for account select
    const skeletons = document.querySelectorAll('.skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows inline prerequisite error when account loading fails', () => {
    mockAccountsFetchError = 'Accounts unavailable'

    render(<InvestmentForm onSubmit={vi.fn()} />)

    // The ErrorBanner title
    expect(screen.getByText(/Accounts couldn.*t be loaded/)).toBeInTheDocument()
    expect(screen.getByText('Accounts unavailable')).toBeInTheDocument()
  })

  it('renders account options when accounts loaded', () => {
    mockAccounts.push(
      { id: 'acc-1', name: 'Brokerage', type: 'investment' },
      { id: 'acc-2', name: 'Crypto Wallet', type: 'crypto' }
    )

    render(<InvestmentForm onSubmit={vi.fn()} />)

    // Should render without error banner
    expect(screen.queryByText(/Accounts couldn.*t be loaded/)).not.toBeInTheDocument()
  })

  describe('accessibility', () => {
    it('has proper label associations for all fields', () => {
      render(<InvestmentForm onSubmit={vi.fn()} />)

      // Check that all inputs have associated labels
      expect(screen.getByLabelText('form.symbol')).toHaveAttribute('id', 'inv-symbol')
      expect(screen.getByLabelText('form.name')).toHaveAttribute('id', 'inv-name')
      expect(screen.getByLabelText('form.shares')).toHaveAttribute('id', 'inv-shares')
      expect(screen.getByLabelText('form.avgCost')).toHaveAttribute('id', 'inv-avg-cost')
      expect(screen.getByLabelText('form.type')).toBeInTheDocument()
      expect(screen.getByLabelText('form.currency')).toBeInTheDocument()
      expect(screen.getByLabelText('form.account')).toBeInTheDocument()
    })

    it('exposes aria-invalid and aria-describedby when validation fails', async () => {
      const user = userEvent.setup()
      render(<InvestmentForm onSubmit={vi.fn()} />)

      // Submit empty form
      await user.click(screen.getByRole('button', { name: 'actions.save' }))

      // Check error semantics on symbol field
      const symbolInput = screen.getByLabelText('form.symbol')
      expect(symbolInput).toHaveAttribute('aria-invalid', 'true')
      expect(symbolInput).toHaveAttribute('aria-describedby', 'inv-symbol-error')

      // Check error has role="alert"
      const symbolError = document.querySelector('#inv-symbol-error')
      expect(symbolError).toHaveAttribute('role', 'alert')
    })

    it('select triggers have proper id for label association', () => {
      render(<InvestmentForm onSubmit={vi.fn()} />)

      // Select triggers should have ids
      const typeSelect = document.querySelector('#inv-type')
      expect(typeSelect).toBeInTheDocument()

      const currencySelect = document.querySelector('#inv-currency')
      expect(currencySelect).toBeInTheDocument()
    })
  })
})
