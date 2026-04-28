import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountForm } from '../account-form'
import type { Account } from '@/types/database'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

const mockAccount: Account = {
  id: '01ACC001',
  name: 'Savings',
  type: 'savings',
  currency: 'EUR',
  balance: 150050, // 1500.50 in centavos
  icon: null,
  color: null,
  is_archived: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const mockCreditCard: Account = {
  ...mockAccount,
  id: '01CARD001',
  name: 'Main Card',
  type: 'credit_card',
  currency: 'USD',
  balance: -100000,
  credit_limit: 2700000,
  statement_closing_day: 15,
  payment_due_day: 5,
}

describe('AccountForm', () => {
  it('renders all form fields and submit button', () => {
    render(<AccountForm onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('form.name')).toBeInTheDocument()
    expect(screen.getByLabelText('form.balance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeInTheDocument()
  })

  it('has correct create mode defaults', () => {
    render(<AccountForm onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('form.name')).toHaveValue('')
    expect(screen.getByLabelText('form.balance')).toHaveValue(0)
  })

  it('populates fields in edit mode with centavo conversion', () => {
    render(<AccountForm account={mockAccount} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('form.name')).toHaveValue('Savings')
    // 150050 centavos → 1500.50
    expect(screen.getByLabelText('form.balance')).toHaveValue(1500.5)
  })

  it('shows and populates credit card fields for credit card accounts', () => {
    render(<AccountForm account={mockCreditCard} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('form.creditLimit')).toHaveValue(27000)
    expect(screen.getByLabelText('form.statementClosingDay')).toHaveValue(15)
    expect(screen.getByLabelText('form.paymentDueDay')).toHaveValue(5)
  })

  it('hides credit card fields for non-credit accounts', () => {
    render(<AccountForm account={mockAccount} onSubmit={vi.fn()} />)

    expect(screen.queryByLabelText('form.creditLimit')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('form.statementClosingDay')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('form.paymentDueDay')).not.toBeInTheDocument()
  })

  it('shows validation error for empty name on submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AccountForm onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      // Zod v4 validation error appears
      const errorEl = document.querySelector('.text-destructive.text-xs')
      expect(errorEl).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('calls onSubmit with form values on valid submission', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AccountForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'My Account')
    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Account',
          type: 'checking',
          currency: 'USD',
          balance: 0,
        }),
        expect.anything()
      )
    })
  })

  it('keeps investment and crypto out of account type choices', () => {
    const { container } = render(<AccountForm onSubmit={vi.fn()} />)

    const options = Array.from(container.querySelectorAll('option')).map((option) => option.value)

    expect(options).toEqual(
      expect.arrayContaining(['checking', 'savings', 'credit_card', 'cash', 'other'])
    )
    expect(options).not.toContain('investment')
    expect(options).not.toContain('crypto')
  })

  it('disables submit and shows "..." when isLoading', () => {
    render(<AccountForm onSubmit={vi.fn()} isLoading />)

    const btn = screen.getByRole('button', { name: '...' })
    expect(btn).toBeDisabled()
  })

  it('renders currency and balance in a 2-column grid', () => {
    const { container } = render(<AccountForm onSubmit={vi.fn()} />)

    const grid = container.querySelector('.grid.grid-cols-2')
    expect(grid).toBeInTheDocument()
  })

  describe('accessibility', () => {
    it('has proper label associations for all fields', () => {
      render(<AccountForm onSubmit={vi.fn()} />)

      // Check that all inputs have associated labels
      expect(screen.getByLabelText('form.name')).toHaveAttribute('id', 'name')
      expect(screen.getByLabelText('form.balance')).toHaveAttribute('id', 'balance')
      expect(screen.getByLabelText('form.type')).toBeInTheDocument()
      expect(screen.getByLabelText('form.currency')).toBeInTheDocument()
    })

    it('exposes aria-invalid and aria-describedby when validation fails', async () => {
      const user = userEvent.setup()
      render(<AccountForm onSubmit={vi.fn()} />)

      // Submit empty form
      await user.click(screen.getByRole('button', { name: 'actions.save' }))

      await waitFor(() => {
        // Check error semantics on name field
        const nameInput = screen.getByLabelText('form.name')
        expect(nameInput).toHaveAttribute('aria-invalid', 'true')
        expect(nameInput).toHaveAttribute('aria-describedby', 'name-error')

        // Check error has role="alert"
        const nameError = document.querySelector('#name-error')
        expect(nameError).toHaveAttribute('role', 'alert')
      })
    })

    it('select triggers have proper id for label association', () => {
      render(<AccountForm onSubmit={vi.fn()} />)

      // Select triggers should have ids
      const typeSelect = document.querySelector('#account-type')
      expect(typeSelect).toBeInTheDocument()

      const currencySelect = document.querySelector('#account-currency')
      expect(currencySelect).toBeInTheDocument()
    })
  })
})
