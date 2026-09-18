import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalForm } from '../goal-form'
import { GOAL_ICONS } from '../goal-icons'

const mockFetchAccounts = vi.fn().mockResolvedValue(undefined)
let mockAccountsFetchError: string | null = null
const LEGACY_EMOJI_PATTERN = /🎯|🏠|✈️|🚗|🎓|💰|🏖️|💍|🏥|📱/

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { icon?: string; color?: string }) => {
      if (options?.icon) return `${key} ${options.icon}`
      if (options?.color) return `${key} ${options.color}`
      return key
    },
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

      const iconOptions = screen.getAllByRole('radio', { name: /form\.selectIcon/ })
      expect(iconOptions.length).toBeGreaterThan(0)

      expect(iconOptions[0]).toHaveAttribute('aria-checked', 'true')

      const colorOptions = screen.getAllByRole('radio', { name: /form\.selectColor/ })
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

      expect(screen.getByText('form.accountsError')).toBeInTheDocument()
      expect(screen.getByText('Accounts unavailable')).toBeInTheDocument()
    })

    it('announces loading state on submit button', () => {
      render(<GoalForm onSubmit={vi.fn()} isLoading={true} />)

      const submitButton = screen.getByRole('button')
      expect(submitButton).toHaveAttribute('aria-busy', 'true')
      expect(submitButton).toHaveTextContent('actions.saving')
    })

    it('renders icon and color picker targets at accessible size', () => {
      render(<GoalForm onSubmit={vi.fn()} />)

      const firstIcon = screen.getAllByRole('radio', { name: /form\.selectIcon/ })[0]
      expect(firstIcon).toHaveClass('h-11', 'w-11')

      const firstColor = screen.getAllByRole('radio', { name: /form\.selectColor/ })[0]
      expect(firstColor).toHaveClass('h-11', 'w-11')
    })
  })

  describe('icon picker', () => {
    it('renders Lucide SVGs with human-readable labels instead of emoji', () => {
      render(<GoalForm onSubmit={vi.fn()} />)

      const iconOptions = screen.getAllByRole('radio', { name: /form\.selectIcon/ })
      expect(iconOptions).toHaveLength(GOAL_ICONS.length)

      for (const option of iconOptions) {
        const label = option.getAttribute('aria-label') ?? ''
        expect(label).toMatch(/form\.iconLabels\./)
        expect(label).not.toMatch(LEGACY_EMOJI_PATTERN)
        expect(option.querySelector('svg')).toBeInTheDocument()
        expect(option.textContent ?? '').not.toMatch(LEGACY_EMOJI_PATTERN)
      }
    })

    it('keeps the stored emoji icon string in the submit payload', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<GoalForm onSubmit={onSubmit} />)

      await user.type(screen.getByLabelText('form.name'), 'Vacation fund')
      const targetAmount = screen.getByLabelText('form.targetAmount')
      await user.clear(targetAmount)
      await user.type(targetAmount, '2500')

      await user.click(screen.getByRole('radio', { name: /form\.iconLabels\.travel/ }))
      await user.click(screen.getByRole('button', { name: 'actions.save' }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        name: 'Vacation fund',
        icon: '✈️',
      })
    })

    it('preserves selected state and keyboard selection', async () => {
      const user = userEvent.setup()
      render(<GoalForm onSubmit={vi.fn()} />)

      const iconOptions = screen.getAllByRole('radio', { name: /form\.selectIcon/ })
      expect(iconOptions[0]).toHaveAttribute('aria-checked', 'true')
      expect(iconOptions[0]).toHaveAttribute('tabIndex', '0')
      expect(iconOptions[1]).toHaveAttribute('tabIndex', '-1')

      iconOptions[0].focus()
      await user.keyboard('{ArrowRight}')

      expect(iconOptions[1]).toHaveAttribute('aria-checked', 'true')
      expect(iconOptions[1]).toHaveAttribute('tabIndex', '0')
      expect(iconOptions[0]).toHaveAttribute('aria-checked', 'false')
      expect(iconOptions[0]).toHaveAttribute('tabIndex', '-1')
      await waitFor(() => {
        expect(iconOptions[1]).toHaveFocus()
      })
    })
  })
})
