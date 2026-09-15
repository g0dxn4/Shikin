import { useCurrencyStore } from '@/stores/currency-store'
import { query } from '@/lib/database'
vi.mock('@/lib/database', () => ({ query: vi.fn().mockResolvedValue([]), execute: vi.fn() }))
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { BillCalendar } from '../bill-calendar'

const recurringStoreMock = vi.hoisted(() => ({
  fetch: vi.fn().mockResolvedValue(undefined),
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

async function renderBillCalendar() {
  return act(async () =>
    render(
      <MemoryRouter>
        <BillCalendar />
      </MemoryRouter>
    )
  )
}

const originalRule = recurringStoreMock.rules[0]

describe('BillCalendar', () => {
  beforeEach(() => {
    recurringStoreMock.rules = [originalRule]
    vi.mocked(query).mockResolvedValue([])
    useCurrencyStore.setState({ preferredCurrency: 'USD', rates: {}, invalidRates: [] })
  })
  it('renders calendar grid and navigation', async () => {
    await renderBillCalendar()

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /listView/i })).toHaveAttribute('href', '/bills')
    expect(screen.getByRole('button', { name: 'prevMonth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'nextMonth' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByText('Rent').length).toBeGreaterThan(0)
  })

  it('navigates to previous and next months', async () => {
    const user = userEvent.setup()
    await renderBillCalendar()

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

  it('renders localized day headers', async () => {
    await renderBillCalendar()

    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBe(7)
    expect(headers[0]).toHaveTextContent('dayLabels.sunday')
  })
  it('selects a calendar day with keyboard-operable buttons and resets selection on month navigation', async () => {
    const user = userEvent.setup()
    await renderBillCalendar()
    const dateButtons = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'))
    await user.click(dateButtons[0])
    expect(dateButtons[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'schedule.allDays' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'nextMonth' }))
    expect(screen.queryByRole('button', { name: 'schedule.allDays' })).not.toBeInTheDocument()
  })
  it('converts scheduled and actually paid bills, withholding missing-rate totals', async () => {
    recurringStoreMock.rules.push({
      ...originalRule,
      id: 'eur',
      description: 'Euro bill',
      amount: 10000,
      currency: 'EUR',
    })
    useCurrencyStore.setState({ rates: { 'EUR:USD': 2 } })
    vi.mocked(query).mockResolvedValue([
      {
        id: 'paid-rent',
        recurring_rule_id: originalRule.id,
        date: originalRule.next_date,
        type: 'expense',
        status: ' ',
        amount: originalRule.amount,
        currency: 'USD',
        description: 'Rent payment',
      },
    ])
    await renderBillCalendar()
    const total = screen.getByText('thisMonth').parentElement!
    const paid = screen.getAllByText('paid')[0].parentElement!
    expect(within(total).getByText('$1,400.00')).toBeInTheDocument()
    expect(within(paid).getByText('$1,200.00')).toBeInTheDocument()
    act(() => useCurrencyStore.setState({ rates: {} }))
    expect(within(total).queryByText('$1,400.00')).not.toBeInTheDocument()
    expect(within(total).getByText('—')).toBeInTheDocument()
  })
})
