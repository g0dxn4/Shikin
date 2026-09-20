import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { useCurrencyStore } from '@/stores/currency-store'
import { BillsPage } from '../bills'

const mockOpenRecurringDialog = vi.fn()

const recurringStoreMock = vi.hoisted(() => ({
  fetch: vi.fn().mockResolvedValue(undefined),
  rules: [] as Array<Record<string, unknown>>,
}))

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    description: 'Rent',
    amount: 120000,
    currency: 'USD',
    type: 'expense',
    frequency: 'monthly',
    next_date: new Date().toISOString().slice(0, 10),
    end_date: null,
    account_id: 'account-1',
    to_account_id: null,
    category_id: 'category-1',
    subcategory_id: null,
    tags: '',
    notes: null,
    active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    account_name: 'Checking',
    account_currency: 'USD',
    category_name: 'Housing',
    category_color: '#0a84ff',
    ...overrides,
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => {
      if (key === 'actions.edit') return 'Edit'
      return typeof params?.count === 'number' ? `${key} ${params.count}` : key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openRecurringDialog: mockOpenRecurringDialog,
  }),
}))

vi.mock('@/stores/recurring-store', () => ({
  useRecurringStore: () => ({
    rules: recurringStoreMock.rules,
    isLoading: false,
    fetch: recurringStoreMock.fetch,
  }),
}))

describe('BillsPage edit action', () => {
  beforeEach(() => {
    mockOpenRecurringDialog.mockClear()
    recurringStoreMock.fetch.mockClear()
    useCurrencyStore.setState({ preferredCurrency: 'USD', rates: {}, invalidRates: [] })
    recurringStoreMock.rules = [
      makeRule({ id: 'rule-rent', description: 'Rent' }),
      makeRule({ id: 'rule-netflix', description: 'Netflix' }),
    ]
  })

  function renderPage() {
    return render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )
  }

  it('opens the matching recurring rule for edit and keeps add-rule in create mode', async () => {
    const user = userEvent.setup()
    renderPage()

    const rentEdit = screen.getByRole('button', { name: 'Edit Rent' })
    const netflixEdit = screen.getByRole('button', { name: 'Edit Netflix' })

    expect(rentEdit.tagName).toBe('BUTTON')
    expect(netflixEdit.tagName).toBe('BUTTON')

    await user.click(screen.getByText('Rent'))
    expect(mockOpenRecurringDialog).not.toHaveBeenCalled()

    await user.click(netflixEdit)
    expect(mockOpenRecurringDialog).toHaveBeenCalledTimes(1)
    expect(mockOpenRecurringDialog).toHaveBeenCalledWith('rule-netflix')
    expect(mockOpenRecurringDialog).not.toHaveBeenCalledWith('rule-rent')
    expect(mockOpenRecurringDialog.mock.calls[0]).toEqual(['rule-netflix'])

    mockOpenRecurringDialog.mockClear()
    await user.click(screen.getByRole('button', { name: 'bills.addRecurring' }))
    expect(mockOpenRecurringDialog).toHaveBeenCalledTimes(1)
    expect(mockOpenRecurringDialog).toHaveBeenCalledWith()
    expect(mockOpenRecurringDialog.mock.calls[0]).toEqual([])
  })

  it('activates the row edit button with keyboard', async () => {
    const user = userEvent.setup()
    renderPage()

    const rentEdit = screen.getByRole('button', { name: 'Edit Rent' })
    rentEdit.focus()
    expect(rentEdit).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(mockOpenRecurringDialog).toHaveBeenCalledTimes(1)
    expect(mockOpenRecurringDialog).toHaveBeenCalledWith('rule-rent')

    mockOpenRecurringDialog.mockClear()
    rentEdit.focus()
    await user.keyboard(' ')
    expect(mockOpenRecurringDialog).toHaveBeenCalledTimes(1)
    expect(mockOpenRecurringDialog).toHaveBeenCalledWith('rule-rent')
  })
})
