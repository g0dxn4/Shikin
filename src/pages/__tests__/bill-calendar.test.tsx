import { useCurrencyStore } from '@/stores/currency-store'
import { query } from '@/lib/database'
vi.mock('@/lib/database', () => ({ query: vi.fn().mockResolvedValue([]), ...ledgerWrites }))
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { BillCalendar } from '../bill-calendar'
import dayjs from 'dayjs'
import { createInstance } from 'i18next'
import type { i18n, Namespace } from 'i18next'
import en from '@/i18n/locales/en/billCalendar.json'
import es from '@/i18n/locales/es/billCalendar.json'
import enCommon from '@/i18n/locales/en/common.json'
import esCommon from '@/i18n/locales/es/common.json'

const translationMock = vi.hoisted(() => ({ i18n: null as i18n | null }))
const ledgerWrites = vi.hoisted(() => ({
  execute: vi.fn(),
  withTransaction: vi.fn(),
  materializeRecurringTransactionsBrowser: vi.fn(),
}))

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
  useTranslation: (namespace: Namespace) => ({
    t: (key: string, params?: { count?: number; rules?: string; currency?: string }) =>
      translationMock.i18n
        ? translationMock.i18n.t(key, { ns: namespace, defaultValue: key, ...params })
        : params?.rules
          ? `${key} ${params.rules}`
          : typeof params?.count === 'number'
            ? `${key} ${params.count}`
            : key,
    i18n: { language: translationMock.i18n?.language ?? 'en', changeLanguage: vi.fn() },
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
const convertCurrent = useCurrencyStore.getState().convertCurrentToPreferred
const convertHistorical = useCurrencyStore.getState().convertHistoricalToPreferred

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

async function setLocale(language: 'en' | 'es') {
  const i18n = createInstance()
  await i18n.init({
    lng: language,
    fallbackLng: false,
    resources: {
      en: { billCalendar: en, common: enCommon },
      es: { billCalendar: es, common: esCommon },
    },
    interpolation: { escapeValue: false },
  })
  translationMock.i18n = i18n
}

describe('BillCalendar', () => {
  beforeEach(() => {
    translationMock.i18n = null
    Object.values(ledgerWrites).forEach((write) => write.mockClear())
    recurringStoreMock.rules = [originalRule]
    vi.mocked(query).mockResolvedValue([])
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [],
      convertCurrentToPreferred: convertCurrent,
      convertHistoricalToPreferred: convertHistorical,
    })
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
    const dateButtons = within(screen.getByRole('table')).getAllByRole('button')
    await user.click(dateButtons[0])
    expect(dateButtons[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'schedule.allDays' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'nextMonth' }))
    expect(screen.queryByRole('button', { name: 'schedule.allDays' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
  })
  it('uses transaction-date FX for paid bills and today FX for planning estimates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2024-09-14T12:00:00'))
    const paidRule = {
      ...originalRule,
      id: 'paid-eur',
      description: 'Paid EUR',
      amount: 10_000,
      currency: 'EUR',
      next_date: '2024-09-13',
    }
    const estimateRule = {
      ...originalRule,
      id: 'estimate-eur',
      description: 'Estimated EUR',
      amount: 10_000,
      currency: 'EUR',
      next_date: '2024-09-14',
    }
    recurringStoreMock.rules = [paidRule, estimateRule]
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: [
        { ...fxRate('EUR', 'MXN', '17'), id: 'rate-17', effectiveFrom: '2024-09-01' },
        { ...fxRate('EUR', 'MXN', '18'), id: 'rate-18', effectiveFrom: '2024-09-14' },
      ],
    })
    vi.mocked(query).mockResolvedValue([
      {
        id: 'paid-eur-transaction',
        recurring_rule_id: paidRule.id,
        date: '2024-09-13',
        type: 'expense',
        status: 'posted',
        amount: 10_000,
        currency: 'EUR',
        description: 'Paid EUR',
      },
    ])

    try {
      await renderBillCalendar()
      const total = screen.getByText('thisMonth').parentElement!
      const paid = screen.getAllByText('paid')[0].parentElement!
      const remaining = screen.getByText('remaining').parentElement!
      expect(within(total).getByText('MX$3,500.00')).toBeInTheDocument()
      expect(within(paid).getByText('MX$1,700.00')).toBeInTheDocument()
      expect(within(remaining).getByText('MX$1,800.00')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('withholds a rule without recorded currency and marks its plain amount', async () => {
    recurringStoreMock.rules = [
      Object.assign({}, originalRule, { currency: null, account_currency: null }),
    ]
    const convert = vi.fn(convertCurrent)
    useCurrencyStore.setState({ convertCurrentToPreferred: convert })

    await renderBillCalendar()

    expect(convert).not.toHaveBeenCalled()
    expect(within(screen.getByText('thisMonth').parentElement!).getByText('—')).toBeInTheDocument()
    expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toBe('estimate.unknownCurrencyRules Rent')
    await userEvent
      .setup()
      .click(within(screen.getByRole('list', { name: 'calendar.markedDays' })).getByRole('button'))
    const list = within(screen.getByRole('list', { name: 'schedule.list' }))
    expect(list.getByText('Rent')).toBeInTheDocument()
    expect(list.getByText('1,200.00 · currency.unknown')).toBeInTheDocument()
    expect(list.queryByText('$1,200.00')).not.toBeInTheDocument()
    expect(screen.getByText('scheduledCount 1')).toBeInTheDocument()
    Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
  })

  it('withholds empty unconfigured totals instead of using the EUR setup preference', async () => {
    recurringStoreMock.rules = []
    useCurrencyStore.setState({ mainCurrency: null, preferredCurrency: 'EUR' })

    await renderBillCalendar()

    for (const label of ['thisMonth', 'paid', 'remaining']) {
      expect(within(screen.getByText(label).parentElement!).getByText('—')).toBeInTheDocument()
    }
    expect(screen.queryByText('€0.00')).not.toBeInTheDocument()
    expect(screen.queryByText('EUR')).not.toBeInTheDocument()
    expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toBe('common:currencySetup.title')
    await userEvent.setup().click(screen.getByRole('button', { name: 'currency.basis' }))
    expect(screen.queryByText('currency.actualAndEstimate')).not.toBeInTheDocument()
    Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
  })

  it.each([false, true])(
    'keeps unknown bills counted and names them once alongside a valid bill (paid=%s)',
    async (paid) => {
      const date = dayjs().startOf('month').format('YYYY-MM-DD')
      recurringStoreMock.rules = [
        { ...originalRule, next_date: date },
        Object.assign({}, originalRule, {
          id: 'unknown',
          description: 'Unknown bill',
          amount: 4000,
          currency: null,
          account_currency: null,
          frequency: 'weekly',
          next_date: date,
          end_date: dayjs(date).add(7, 'day').format('YYYY-MM-DD'),
        }),
        Object.assign({}, originalRule, {
          id: 'other-unknown',
          description: 'Other unknown bill',
          amount: 5000,
          currency: null,
          account_currency: undefined,
          next_date: date,
        }),
      ]
      if (paid) {
        vi.mocked(query).mockResolvedValue([
          {
            id: 'paid-rent',
            recurring_rule_id: originalRule.id,
            date,
            type: 'expense',
            status: 'posted',
            amount: 120000,
            currency: 'USD',
            description: 'Rent',
          },
        ])
      }
      const before = JSON.stringify(recurringStoreMock.rules)
      const current = vi.fn(convertCurrent)
      const historical = vi.fn(convertHistorical)
      useCurrencyStore.setState({
        convertCurrentToPreferred: current,
        convertHistoricalToPreferred: historical,
      })

      await renderBillCalendar()

      for (const label of ['thisMonth', 'remaining']) {
        const metric = within(screen.getByText(label).parentElement!)
        expect(metric.getByText('—')).toBeInTheDocument()
        expect(metric.queryByText('$1,200.00')).not.toBeInTheDocument()
      }
      expect(
        within(screen.getByText('paid').parentElement!).getByText(paid ? '$1,200.00' : '$0.00')
      ).toBeInTheDocument()
      expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
      expect(screen.getByRole('status').textContent).toBe(
        'estimate.unknownCurrencyRules Other unknown bill, Unknown bill'
      )
      expect(screen.getByRole('status')).toHaveClass('break-words')
      expect(screen.getByText('scheduledCount 4')).toBeInTheDocument()
      expect(
        within(screen.getByRole('list', { name: 'schedule.list' })).getAllByRole('listitem')
      ).toHaveLength(4)
      expect(
        [...current.mock.calls, ...historical.mock.calls].every(([amount]) => amount === 120000)
      ).toBe(true)
      current.mockClear()
      historical.mockClear()
      await userEvent
        .setup()
        .click(
          within(screen.getByRole('list', { name: 'calendar.markedDays' })).getAllByRole(
            'button'
          )[0]
        )
      if (paid) {
        expect(historical).toHaveBeenCalledWith(120000, 'USD', date)
        expect(current).not.toHaveBeenCalled()
      } else {
        expect(current).toHaveBeenCalledWith(120000, 'USD')
        expect(historical).not.toHaveBeenCalled()
      }
      const list = within(screen.getByRole('list', { name: 'schedule.list' }))
      expect(list.getByText('40.00 · currency.unknown')).toBeInTheDocument()
      expect(list.getByText('50.00 · currency.unknown')).toBeInTheDocument()
      expect(list.getByText('$1,200.00')).toBeInTheDocument()
      expect(list.getAllByRole('listitem')).toHaveLength(3)
      expect(screen.getByRole('status').textContent).toBe(
        'estimate.unknownCurrencyRules Other unknown bill, Unknown bill'
      )
      expect(JSON.stringify(recurringStoreMock.rules)).toBe(before)
      Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
    }
  )

  it.each([
    { billCount: 0, total: '$0.00' },
    { billCount: 1, total: '$1,200.00' },
  ])(
    'formats $billCount bills and the FX basis in main currency, not the setup draft',
    async ({ billCount, total }) => {
      await setLocale('en')
      recurringStoreMock.rules = recurringStoreMock.rules.slice(0, billCount)
      useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'EUR' })

      await renderBillCalendar()

      for (const label of ['This Month', 'Remaining']) {
        expect(within(screen.getByText(label).parentElement!).getByText(total)).toBeInTheDocument()
      }
      expect(
        within(screen.getByText('Paid', { selector: 'span' }).parentElement!).getByText('$0.00')
      ).toBeInTheDocument()
      expect(screen.getByText('USD')).toBeInTheDocument()
      expect(screen.queryByText('EUR')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Rate basis' }))
      expect(
        screen.getByText('USD · paid at transaction date; estimates use today’s rate')
      ).toBeInTheDocument()
      Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
    }
  )

  it.each([
    {
      language: 'en' as const,
      unavailable: 'Unavailable',
      markedDays: 'Marked days',
      rowAmount: '1,200.00 · Unknown currency',
      reason: 'Total unavailable: no currency recorded (Rent).',
      setupReason: 'Main currency needs to be configured',
    },
    {
      language: 'es' as const,
      unavailable: 'No disponible',
      markedDays: 'Días marcados',
      rowAmount: '1200,00 · Moneda desconocida',
      reason: 'Total no disponible: no hay moneda registrada (Rent).',
      setupReason: 'Falta configurar la moneda principal',
    },
  ])(
    'renders unknown currency and setup reasons in $language',
    async ({ language, unavailable, markedDays, rowAmount, reason, setupReason }) => {
      await setLocale(language)
      recurringStoreMock.rules = [
        Object.assign({}, originalRule, { currency: null, account_currency: null }),
      ]

      await renderBillCalendar()

      expect(screen.getByText(unavailable)).toBeInTheDocument()
      expect(screen.getByRole('status').textContent).toBe(reason)
      await userEvent
        .setup()
        .click(within(screen.getByRole('list', { name: markedDays })).getByRole('button'))
      expect(screen.getByText(rowAmount)).toBeInTheDocument()
      act(() => useCurrencyStore.setState({ mainCurrency: null, preferredCurrency: 'EUR' }))
      expect(screen.getByRole('status').textContent).toBe(`${setupReason} ${reason}`)
      expect(screen.queryByText('€0.00')).not.toBeInTheDocument()
      expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
      Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
    }
  )

  it('converts scheduled and actually paid bills, withholding missing-rate totals', async () => {
    recurringStoreMock.rules.push({
      ...originalRule,
      id: 'eur',
      description: 'Euro bill',
      amount: 10000,
      currency: 'EUR',
    })
    useCurrencyStore.setState({ manualRates: [fxRate('EUR', 'USD', '2')] })
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
    act(() => useCurrencyStore.setState({ manualRates: [] }))
    expect(within(total).queryByText('$1,400.00')).not.toBeInTheDocument()
    expect(within(total).getByText('—')).toBeInTheDocument()
  })

  it('keeps the month grid keyboard-accessible inside a local scroll region', async () => {
    const user = userEvent.setup()
    await renderBillCalendar()

    const month = screen.getByRole('heading', { level: 2 }).textContent
    const table = screen.getByRole('table', { name: month ?? '' })
    const region = screen.getByRole('region', { name: 'calendar.scrollRegion' })
    const page = document.querySelector('.page-content')
    expect(region).toHaveClass('max-w-full', 'min-w-0', 'overflow-x-auto')
    expect(region).toContainElement(table)
    expect(table).toHaveClass('min-w-[22rem]')
    expect(page).toHaveClass('min-w-0', 'max-w-full')
    expect(page).not.toHaveClass('min-w-[22rem]')
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)

    const today = screen.getByRole('button', { current: 'date' })
    expect(today).toHaveAttribute('aria-pressed', 'false')
    expect(today.className).toMatch(/min-h-11/)
    expect(today.className).toMatch(/min-w-11/)
    expect(screen.getByRole('button', { name: 'prevMonth' }).className).toMatch(/h-11/)
    expect(screen.getByRole('button', { name: 'nextMonth' }).className).toMatch(/w-11/)

    const days = within(table).getAllByRole('button')
    expect(days.every((button) => button.hasAttribute('aria-pressed'))).toBe(true)
    expect(days.every((button) => button.className.includes('min-h-11'))).toBe(true)
    expect(days.every((button) => button.className.includes('min-w-11'))).toBe(true)
    const marked = screen.queryByRole('list', { name: 'calendar.markedDays' })
    if (marked) expect(region).not.toContainElement(marked)
    days[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(days[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(days[1]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'schedule.allDays' })).toHaveClass('min-h-11')
  })

  it('shows counts and paid marks in cells, and native amounts only for the selected day', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 5, 14, 12, 0, 0))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const paidRule = {
      ...originalRule,
      id: 'paid-usd',
      description: 'Paid rent',
      amount: 120000,
      currency: 'USD',
      next_date: '2026-06-14',
    }
    const unpaidRule = {
      ...originalRule,
      id: 'unpaid-eur',
      description: 'Unpaid euro',
      amount: 10000,
      currency: 'EUR',
      next_date: '2026-06-14',
    }
    const laterRule = {
      ...originalRule,
      id: 'later-mxn',
      description: 'Later peso',
      amount: 5000,
      currency: 'MXN',
      next_date: '2026-06-16',
    }
    recurringStoreMock.rules = [paidRule, unpaidRule, laterRule]
    vi.mocked(query).mockResolvedValue([
      {
        id: 'paid-usd-transaction',
        recurring_rule_id: paidRule.id,
        date: '2026-06-14',
        type: 'expense',
        status: 'posted',
        amount: 120000,
        currency: 'USD',
        description: 'Paid rent',
      },
    ])

    try {
      await renderBillCalendar()
      const table = screen.getByRole('table')
      expect(within(table).queryByText('$1,200.00')).not.toBeInTheDocument()
      expect(within(table).queryByText('€100.00')).not.toBeInTheDocument()
      expect(within(table).queryByText('MX$50.00')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: /scheduledCount 2, calendar\.paidCount 1, calendar\.unpaidCount 1/,
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: /scheduledCount 1, calendar\.paidCount 0, calendar\.unpaidCount 1/,
        })
      ).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'calendar.markLegend' })).toBeInTheDocument()

      const list = screen.getByRole('list', { name: 'schedule.list' })
      expect(within(list).getByText('Paid rent')).toBeInTheDocument()
      expect(within(list).queryByText('$1,200.00')).not.toBeInTheDocument()
      expect(within(list).queryByText('€100.00')).not.toBeInTheDocument()

      await user.click(
        screen.getByRole('button', {
          name: /scheduledCount 2, calendar\.paidCount 1, calendar\.unpaidCount 1/,
        })
      )
      expect(within(list).getByText('$1,200.00')).toBeInTheDocument()
      expect(within(list).getByText('€100.00')).toBeInTheDocument()
      expect(within(list).queryByText('MX$50.00')).not.toBeInTheDocument()
      expect(within(list).queryByText('$1,300.00')).not.toBeInTheDocument()
      expect(screen.getByText('schedule.nativeChip')).toBeInTheDocument()
      expect(screen.queryByText('schedule.nativeAmounts')).not.toBeInTheDocument()
      expect(screen.queryByText('schedule.description')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'schedule.about' }))
      expect(screen.getByText('schedule.nativeAmounts')).toBeInTheDocument()
      expect(screen.getByText('schedule.description')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a Saturday mark reachable outside the scrolling grid and counts bills instead of summing money', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const paidRule = {
      ...originalRule,
      id: 'paid-usd',
      description: 'Paid rent',
      amount: 120000,
      currency: 'USD',
      next_date: '2026-06-27',
    }
    const unpaidRule = {
      ...originalRule,
      id: 'unpaid-eur',
      description: 'Unpaid euro',
      amount: 10000,
      currency: 'EUR',
      next_date: '2026-06-27',
    }
    recurringStoreMock.rules = [paidRule, unpaidRule]
    vi.mocked(query).mockResolvedValue([
      {
        id: 'paid-usd-transaction',
        recurring_rule_id: paidRule.id,
        date: '2026-06-27',
        type: 'expense',
        status: 'posted',
        amount: 120000,
        currency: 'USD',
        description: 'Paid rent',
      },
    ])

    try {
      await renderBillCalendar()
      const region = screen.getByRole('region', { name: 'calendar.scrollRegion' })
      const table = screen.getByRole('table')
      expect(region).toContainElement(table)
      expect(table).toHaveClass('min-w-[22rem]')
      const chips = screen.getByRole('list', { name: 'calendar.markedDays' })
      expect(region).not.toContainElement(chips)
      expect(chips.closest('.overflow-x-auto')).toBeNull()
      expect(table.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
      expect(
        screen.getByText('thisMonth').compareDocumentPosition(table) &
          Node.DOCUMENT_POSITION_PRECEDING
      ).toBeTruthy()

      const chipButtons = within(chips).getAllByRole('button')
      expect(chipButtons).toHaveLength(1)
      const chip = screen.getByRole('button', {
        name: '2026-06-27, calendar.paidCount 1, calendar.unpaidCount 1',
      })
      expect(chip).toHaveClass('min-h-11')
      expect(chip.closest('.overflow-x-auto')).toBeNull()
      expect(within(chip).getAllByText('1')).toHaveLength(2)
      expect(within(chip).queryByText('2')).not.toBeInTheDocument()
      expect(chip.textContent).not.toMatch(/[$€]|MX\$/)
      expect(chip.querySelector('[data-mark="paid"]')).toHaveClass('bg-success')
      expect(chip.querySelector('[data-mark="unpaid"]')).toHaveClass('border')
      expect(chip.querySelector('[data-mark="unpaid"]')).not.toHaveClass('bg-success')

      const day = screen.getByRole('button', {
        name: /scheduledCount 2, calendar\.paidCount 1, calendar\.unpaidCount 1/,
      })
      expect(region).toContainElement(day)
      expect(day).toHaveAttribute('aria-pressed', 'false')
      await user.click(chip)
      expect(chip).toHaveAttribute('aria-pressed', 'true')
      expect(day).toHaveAttribute('aria-pressed', 'true')
      const list = screen.getByRole('list', { name: 'schedule.list' })
      expect(within(list).getByText('$1,200.00')).toBeInTheDocument()
      expect(within(list).getByText('€100.00')).toBeInTheDocument()
      expect(within(list).queryByText('$1,300.00')).not.toBeInTheDocument()
      expect(within(chip).queryByText('$1,200.00')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'nextMonth' }))
      expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /2026-06-27/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'schedule.allDays' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows one FX basis and keeps a recorded paid total of zero', async () => {
    const user = userEvent.setup()
    await renderBillCalendar()
    const paid = screen.getAllByText('paid')[0].parentElement!
    expect(within(paid).getByText('$0.00')).toBeInTheDocument()
    expect(within(paid).queryByText('—')).not.toBeInTheDocument()
    expect(screen.queryByText('currency.actualAndEstimate')).not.toBeInTheDocument()
    expect(screen.queryByText('currency.missing')).not.toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'currency.basis' }))
    expect(screen.getAllByText('currency.actualAndEstimate')).toHaveLength(1)
    expect(screen.queryByText('currency.missing')).not.toBeInTheDocument()
  })

  it('withholds a missing paid conversion instead of showing zero', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2024-09-14T12:00:00'))
    const paidRule = {
      ...originalRule,
      id: 'paid-eur',
      description: 'Paid EUR',
      amount: 10_000,
      currency: 'EUR',
      next_date: '2024-09-13',
    }
    recurringStoreMock.rules = [paidRule]
    useCurrencyStore.setState({
      mainCurrency: 'MXN',
      preferredCurrency: 'MXN',
      manualRates: [{ ...fxRate('EUR', 'MXN', '17'), effectiveFrom: '2024-09-01' }],
    })
    vi.mocked(query).mockResolvedValue([
      {
        id: 'paid-eur-transaction',
        recurring_rule_id: paidRule.id,
        date: '2024-09-13',
        type: 'expense',
        status: 'posted',
        amount: 10_000,
        currency: 'EUR',
        description: 'Paid EUR',
      },
    ])

    try {
      await renderBillCalendar()
      expect(
        within(screen.getAllByText('paid')[0].parentElement!).getByText('MX$1,700.00')
      ).toBeInTheDocument()
      expect(screen.queryByText('currency.missing')).not.toBeInTheDocument()
      act(() => useCurrencyStore.setState({ manualRates: [] }))
      const paid = screen.getAllByText('paid')[0].parentElement!
      expect(within(paid).getByText('—')).toBeInTheDocument()
      expect(within(paid).queryByText('MX$0.00')).not.toBeInTheDocument()
      expect(within(paid).queryByText('MX$1,700.00')).not.toBeInTheDocument()
      expect(screen.getAllByText('currency.missing')).toHaveLength(1)
      expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
      expect(screen.queryByText('currency.actualAndEstimate')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
