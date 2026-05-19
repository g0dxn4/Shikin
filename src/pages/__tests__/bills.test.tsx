import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { BillsPage } from '../bills'

const recurringStoreMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  rules: [
    {
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
    },
  ],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) =>
      typeof params?.count === 'number' ? `${key} ${params.count}` : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/recurring-store', () => ({
  useRecurringStore: () => ({
    rules: recurringStoreMock.rules,
    isLoading: false,
    fetch: recurringStoreMock.fetch,
  }),
}))

describe('BillsPage', () => {
  beforeEach(() => {
    recurringStoreMock.fetch.mockClear()
    recurringStoreMock.rules = [
      {
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
      },
    ]
  })

  it('renders recurring bills from local rules', () => {
    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )
    expect(screen.getByText('bills.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /bills\.calendarView/i })).toHaveAttribute(
      'href',
      '/bill-calendar'
    )
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Housing · Checking')).toBeInTheDocument()
  })

  it('renders long recurring bill lists in pages', async () => {
    const user = userEvent.setup()
    recurringStoreMock.rules = Array.from({ length: 21 }, (_, index) => {
      const suffix = String(index).padStart(2, '0')
      return {
        id: `rule-${suffix}`,
        description: `Bill ${suffix}`,
        amount: 120000 + index,
        currency: 'USD',
        type: 'expense',
        frequency: 'monthly',
        next_date: `2026-06-${String(index + 1).padStart(2, '0')}`,
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
      }
    })

    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Bill 00')).toBeInTheDocument()
    expect(screen.getByText('Bill 19')).toBeInTheDocument()
    expect(screen.queryByText('Bill 20')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /pagination\.showMore/i }))

    expect(screen.getByText('Bill 20')).toBeInTheDocument()
  })
})
