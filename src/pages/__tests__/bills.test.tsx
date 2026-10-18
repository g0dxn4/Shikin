import { act } from '@testing-library/react'
import { useCurrencyStore } from '@/stores/currency-store'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { MemoryRouter } from 'react-router'
import { BillsPage } from '../bills'

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
    isLoading: false,
    fetch: recurringStoreMock.fetch,
  }),
}))

const fxRate = (fromCurrency: string, toCurrency: string, rateDecimal: string) => ({
  id: `${fromCurrency}-${toCurrency}-${rateDecimal}`,
  fromCurrency,
  toCurrency,
  rateDecimal,
  effectiveFrom: '2000-01-01',
  supersedesRateId: null,
  createdAt: '2000-01-01T00:00:00Z',
  sourceNote: null,
})

describe('BillsPage', () => {
  beforeEach(() => {
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'USD', manualRates: [] })
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

  it('stacks the status filter above calendar and add actions at narrow widths', () => {
    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    const toolbar = document.querySelector('.page-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.className).toMatch(/(?:^|\s)flex-col(?:\s|$)/)
    expect(toolbar?.className).toMatch(/(?:^|\s)items-stretch(?:\s|$)/)
    expect(toolbar?.className).toMatch(/(?:^|\s)sm:flex-row(?:\s|$)/)
    expect(toolbar?.className).toMatch(/(?:^|\s)sm:items-center(?:\s|$)/)
    expect(toolbar?.className).not.toMatch(/(?:^|\s)items-center(?:\s|$)/)
    expect(toolbar?.className).toContain('max-sm:[&>div]:w-full')
    expect(toolbar?.className).toContain('max-sm:[&>div]:min-w-0')

    const slots = toolbar ? [...toolbar.children] : []
    expect(slots).toHaveLength(2)
    expect(slots.every((slot) => slot.tagName === 'DIV')).toBe(true)

    const select = screen.getByRole('combobox')
    expect(slots[0]).toContainElement(select)
    expect(select.className).toMatch(/(?:^|\s)w-full(?:\s|$)/)
    expect(select.className).toMatch(/(?:^|\s)min-w-0(?:\s|$)/)
    expect(select.className).toMatch(/(?:^|\s)flex-1(?:\s|$)/)
    expect(select.className).toMatch(/min-h-11/)
    expect(select.className).toMatch(/sm:w-auto/)
    expect(select.className).toMatch(/sm:flex-none/)
    expect(select.parentElement?.className).toMatch(/(?:^|\s)w-full(?:\s|$)/)
    expect(select.parentElement?.className).toMatch(/sm:w-auto/)
    expect(screen.getByRole('option', { name: 'filter.all' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'filter.soon' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'filter.overdue' })).toBeInTheDocument()
    expect((select as HTMLSelectElement).value).toBe('all')

    const calendar = screen.getByRole('link', { name: /bills\.calendarView/i })
    const add = screen.getByRole('button', { name: 'bills.addRecurring' })
    expect(slots[1]).toContainElement(calendar)
    expect(slots[1]).toContainElement(add)
    for (const control of [calendar, add]) {
      expect(control.className).toMatch(/min-h-11/)
      expect(control.className).toMatch(/(?:^|\s)w-full(?:\s|$)/)
      expect(control.className).toMatch(/shrink-0/)
      expect(control.className).toMatch(/sm:w-auto/)
    }
  })

  it('renders recurring bills from local rules', () => {
    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
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
  it('converts mixed-currency run rates and withholds totals when a rate disappears', () => {
    recurringStoreMock.rules.push({
      ...recurringStoreMock.rules[0],
      id: 'eur',
      description: 'EUR bill',
      amount: 10000,
      currency: 'EUR',
    })
    useCurrencyStore.setState({ manualRates: [fxRate('EUR', 'USD', '2')] })
    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )
    expect(screen.getByText('$1,400.00')).toBeInTheDocument()
    expect(screen.getByText('€100.00')).toBeInTheDocument()
    act(() => useCurrencyStore.setState({ manualRates: [] }))
    expect(screen.queryByText('$1,400.00')).not.toBeInTheDocument()
    expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
  })

  it('filters due statuses without removing the recurring-rule list actions', async () => {
    recurringStoreMock.rules.push({
      ...recurringStoreMock.rules[0],
      id: 'overdue',
      description: 'Old bill',
      next_date: '2020-01-01',
    })
    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'overdue')
    expect(screen.getByText('Old bill')).toBeInTheDocument()
    expect(screen.queryByText('Rent')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bills.addRecurring' })).toBeInTheDocument()
  })

  it('keeps filtered-empty distinct from a true zero-bill state', async () => {
    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'overdue')
    expect(screen.getByText('filter.empty')).toBeInTheDocument()
    expect(screen.getByText('filter.emptyDescription')).toBeInTheDocument()
    expect(screen.queryByText('bills.emptyTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('bills.emptyDescription')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'bills.addRecurring' })).toHaveLength(1)
  })

  it('partitions active expense rules into disjoint overdue, next-7, and later counts', async () => {
    const user = userEvent.setup()
    const today = dayjs().startOf('day')
    const on = (offset: number) => today.add(offset, 'day').format('YYYY-MM-DD')
    const rule = (overrides: Record<string, unknown>) => ({
      ...recurringStoreMock.rules[0],
      amount: 10000,
      currency: 'USD',
      ...overrides,
    })
    recurringStoreMock.rules = [
      rule({ id: 'overdue', description: 'Overdue rent', next_date: on(-1) }),
      rule({ id: 'today', description: 'Due today', next_date: on(0) }),
      rule({ id: 'day7', description: 'Due on day 7', next_date: on(7) }),
      rule({ id: 'day8', description: 'Due on day 8', next_date: on(8) }),
      rule({ id: 'day30', description: 'Due in 30 days', next_date: on(30) }),
      rule({ id: 'day31', description: 'Due in 31 days', next_date: on(31) }),
      rule({ id: 'income', description: 'Paycheck', type: 'income', next_date: on(-1) }),
      rule({
        id: 'archived',
        description: 'Archived utility',
        account_is_archived: 1,
        next_date: on(-1),
      }),
      rule({
        id: 'ended',
        description: 'Ended subscription',
        next_date: on(10),
        end_date: on(-2),
      }),
      rule({ id: 'inactive', description: 'Inactive bill', active: 0, next_date: on(-1) }),
    ]

    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    const summaryName = 'horizon.overdueCount 1. horizon.next7Count 2. horizon.laterCount 3.'
    expect(screen.getByRole('img', { name: summaryName })).toBeInTheDocument()
    expect(screen.getByText('horizon.activeCount 6')).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: 'horizon.legend' })
    expect(within(legend).getAllByRole('listitem')).toHaveLength(3)
    expect(
      within(legend).getByRole('listitem', { name: 'horizon.overdueCount 1' })
    ).toHaveTextContent('1')
    expect(
      within(legend).getByRole('listitem', { name: 'horizon.next7Count 2' })
    ).toHaveTextContent('2')
    expect(
      within(legend).getByRole('listitem', { name: 'horizon.laterCount 3' })
    ).toHaveTextContent('3')
    expect(within(legend).getByText('horizon.overdueWindow')).toBeInTheDocument()
    expect(within(legend).getByText('horizon.next7Window')).toBeInTheDocument()
    expect(within(legend).getByText('horizon.laterWindow')).toBeInTheDocument()
    expect(within(legend).queryByText(/[$€]|MX\$/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Due today')).toHaveLength(1)
    expect(screen.getAllByText('Due on day 8')).toHaveLength(1)
    expect(screen.queryByText('Paycheck')).not.toBeInTheDocument()
    expect(screen.queryByText('Archived utility')).not.toBeInTheDocument()
    expect(screen.queryByText('Ended subscription')).not.toBeInTheDocument()
    expect(screen.queryByText('Inactive bill')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox'), 'soon')
    expect(screen.getByText('Due today')).toBeInTheDocument()
    expect(screen.getByText('Due on day 7')).toBeInTheDocument()
    expect(screen.getByText('Due on day 8')).toBeInTheDocument()
    expect(screen.getByText('Due in 30 days')).toBeInTheDocument()
    expect(screen.queryByText('Due in 31 days')).not.toBeInTheDocument()
    expect(screen.queryByText('Overdue rent')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bills.addRecurring' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: summaryName })).toBeInTheDocument()
  })
})
