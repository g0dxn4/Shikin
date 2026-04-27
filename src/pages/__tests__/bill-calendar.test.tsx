import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BillCalendar } from '../bill-calendar'

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
    fetch: recurringStoreMock.fetch,
  }),
}))

describe('BillCalendar', () => {
  it('renders calendar grid and navigation', () => {
    render(<BillCalendar />)

    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'prevMonth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'nextMonth' })).toBeInTheDocument()
    expect(screen.getByRole('grid')).toBeInTheDocument()
    expect(screen.getAllByText('Rent').length).toBeGreaterThan(0)
  })

  it('navigates to previous and next months', async () => {
    const user = userEvent.setup()
    render(<BillCalendar />)

    const prevBtn = screen.getByRole('button', { name: 'prevMonth' })
    const nextBtn = screen.getByRole('button', { name: 'nextMonth' })

    const initialMonth = screen.getByRole('heading', { level: 2 }).textContent

    await user.click(prevBtn)
    const prevMonth = screen.getByRole('heading', { level: 2 }).textContent
    expect(prevMonth).not.toBe(initialMonth)

    await user.click(nextBtn)
    await user.click(nextBtn)
    const nextMonth = screen.getByRole('heading', { level: 2 }).textContent
    expect(nextMonth).not.toBe(prevMonth)
  })

  it('renders localized day headers', () => {
    render(<BillCalendar />)

    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBe(7)
    expect(headers[0]).toHaveTextContent('dayLabels.sunday')
  })
})
