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
})
