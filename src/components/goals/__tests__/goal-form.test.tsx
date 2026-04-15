import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalForm } from '../goal-form'

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
let mockAccountsFetchError: string | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    isLoading: false,
    fetchError: mockAccountsFetchError,
    fetch: mockFetchAccounts,
  }),
}))

describe('GoalForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccountsFetchError = null
  })

  describe('accessibility', () => {
    it('has proper label associations for all fields', () => {
      render(<GoalForm onSubmit={vi.fn()} />)

      // Check that all inputs have associated labels
      expect(screen.getByLabelText('form.name')).toHaveAttribute('id', 'goal-name')
      expect(screen.getByLabelText('form.targetAmount')).toHaveAttribute('id', 'goal-target-amount')
      expect(screen.getByLabelText('form.currentAmount')).toHaveAttribute(
        'id',
        'goal-current-amount'
      )
      expect(screen.getByLabelText('form.deadline')).toBeInTheDocument()
      expect(screen.getByLabelText('form.account')).toBeInTheDocument()
    })

    it('icon and color options expose radio semantics with accessible names', () => {
      render(<GoalForm onSubmit={vi.fn()} />)

      const iconOptions = screen.getAllByRole('radio', { name: /Select icon/ })
      expect(iconOptions.length).toBeGreaterThan(0)

      expect(iconOptions[0]).toHaveAttribute('aria-checked', 'true')

      const colorOptions = screen.getAllByRole('radio', { name: /Select color/ })
      expect(colorOptions.length).toBeGreaterThan(0)
    })

    it('exposes aria-invalid and aria-describedby when validation fails', async () => {
      const user = userEvent.setup()
      render(<GoalForm onSubmit={vi.fn()} />)

      // Submit empty form
      await user.click(screen.getByRole('button', { name: 'actions.save' }))

      // Check error semantics on name field
      const nameInput = screen.getByLabelText('form.name')
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).toHaveAttribute('aria-describedby', 'goal-name-error')

      // Check error has role="alert"
      const nameError = document.querySelector('#goal-name-error')
      expect(nameError).toHaveAttribute('role', 'alert')
    })

    it('select triggers have proper id for label association', () => {
      render(<GoalForm onSubmit={vi.fn()} />)

      // Account select should have id
      const accountSelect = document.querySelector('#goal-account')
      expect(accountSelect).toBeInTheDocument()
    })

    it('icon and color pickers have radiogroup role', () => {
      render(<GoalForm onSubmit={vi.fn()} />)

      // Icon picker should have radiogroup role
      const iconContainer = screen.getByRole('radiogroup', { name: /form\.icon/i })
      expect(iconContainer).toBeInTheDocument()

      // Color picker should have radiogroup role
      const colorContainer = screen.getByRole('radiogroup', { name: /form\.color/i })
      expect(colorContainer).toBeInTheDocument()
    })

    it('shows inline prerequisite error when account loading fails', () => {
      mockAccountsFetchError = 'Accounts unavailable'

      render(<GoalForm onSubmit={vi.fn()} />)

      expect(screen.getByText(/Accounts couldn.*t be loaded/)).toBeInTheDocument()
      expect(screen.getByText('Accounts unavailable')).toBeInTheDocument()
    })
  })
})
