import { act } from '@testing-library/react'
import { useCurrencyStore } from '@/stores/currency-store'
import type * as Database from '@/lib/database'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { MemoryRouter } from 'react-router'
import { BillsPage } from '../bills'
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

vi.mock('@/lib/database', async (importOriginal) => ({
  ...(await importOriginal<typeof Database>()),
  ...ledgerWrites,
}))

const convertMonthlyEstimate = useCurrencyStore.getState().convertCurrentToPreferred

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

describe('BillsPage', () => {
  beforeEach(() => {
    translationMock.i18n = null
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [],
      convertCurrentToPreferred: convertMonthlyEstimate,
    })
    Object.values(ledgerWrites).forEach((write) => write.mockClear())
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

  it.each([
    { amount: 3700, frequency: 'weekly', monthlyCentavos: 16077, runRate: '$160.77' },
    { amount: 7400, frequency: 'biweekly', monthlyCentavos: 16077, runRate: '$160.77' },
    {
      amount: 172750273393471,
      frequency: 'weekly',
      monthlyCentavos: 750599937894631,
      runRate: '$7,505,999,378,946.31',
    },
    {
      amount: 345500546786971,
      frequency: 'biweekly',
      monthlyCentavos: 750599937894694,
      runRate: '$7,505,999,378,946.94',
    },
    { amount: 120000, frequency: 'monthly', monthlyCentavos: 120000, runRate: '$1,200.00' },
    { amount: 100, frequency: 'daily', monthlyCentavos: 3000, runRate: '$30.00' },
    { amount: 100, frequency: 'quarterly', monthlyCentavos: 33, runRate: '$0.33' },
    { amount: 100, frequency: 'yearly', monthlyCentavos: 8, runRate: '$0.08' },
    { amount: -0, frequency: 'monthly', monthlyCentavos: 0, runRate: '$0.00' },
  ])(
    'pins the monthly equivalent for $amount centavos / $frequency',
    ({ amount, frequency, monthlyCentavos, runRate }) => {
      Object.assign(recurringStoreMock.rules[0], { amount, frequency })
      const convert = vi.fn(convertMonthlyEstimate)
      useCurrencyStore.setState({ convertCurrentToPreferred: convert })

      render(
        <MemoryRouter>
          <BillsPage />
        </MemoryRouter>
      )

      expect(convert).toHaveBeenCalledExactlyOnceWith(monthlyCentavos, 'USD')
      const total = within(screen.getByText('monthlyRunRate').parentElement!)
      expect(total.getByText(runRate)).toBeInTheDocument()
      expect(total.getByText('currency.estimate')).toBeInTheDocument()
    }
  )

  it.each([
    {
      amount: 100,
      frequency: 'bogus',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 100,
      frequency: '',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 100,
      frequency: null,
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 100,
      frequency: undefined,
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 100,
      frequency: 'toString',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 100,
      frequency: 'constructor',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 100,
      frequency: '__proto__',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: -1,
      frequency: 'weekly',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 0.5,
      frequency: 'weekly',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: 0.5,
      frequency: 'monthly',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: NaN,
      frequency: 'monthly',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: Infinity,
      frequency: 'daily',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: Number.MAX_SAFE_INTEGER + 1,
      frequency: 'monthly',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: Number.MAX_SAFE_INTEGER,
      frequency: 'daily',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
    {
      amount: Number.MAX_SAFE_INTEGER,
      frequency: 'monthly',
      monthlyCentavos: null,
      runRate: 'currency.unavailable',
      reason: 'estimate.invalidRules Rent',
    },
  ])(
    'pins invalid or oversized $amount centavos / $frequency',
    ({ amount, frequency, monthlyCentavos, runRate, reason }) => {
      Object.assign(recurringStoreMock.rules[0], { amount, frequency })
      const convert = vi.fn(convertMonthlyEstimate)
      useCurrencyStore.setState({ convertCurrentToPreferred: convert })

      render(
        <MemoryRouter>
          <BillsPage />
        </MemoryRouter>
      )

      if (monthlyCentavos === null) expect(convert).not.toHaveBeenCalled()
      else expect(convert).toHaveBeenCalledExactlyOnceWith(monthlyCentavos, 'USD')
      const total = within(screen.getByText('monthlyRunRate').parentElement!)
      expect(total.getByText(runRate)).toBeInTheDocument()
      if (reason) expect(screen.getByRole('status')).toHaveTextContent(reason)
      else expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(total.queryByText('currency.estimate')).not.toBeInTheDocument()
      Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
      expect(screen.getByText('Rent')).toBeInTheDocument()
      expect(screen.getByText('horizon.activeCount 1')).toBeInTheDocument()
    }
  )

  it('keeps mixed valid and invalid bills visible without writing or materializing', () => {
    recurringStoreMock.rules.push({
      ...recurringStoreMock.rules[0],
      id: 'invalid',
      description: 'Invalid bill',
      amount: 100,
      frequency: 'bogus',
    })
    const before = JSON.stringify(recurringStoreMock.rules)

    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    const total = within(screen.getByText('monthlyRunRate').parentElement!)
    expect(total.getByText('currency.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('estimate.invalidRules Invalid bill')
    expect(total.queryByText('$1,200.00')).not.toBeInTheDocument()
    expect(total.queryByText('$1,201.00')).not.toBeInTheDocument()
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Invalid bill')).toBeInTheDocument()
    expect(screen.getByText('horizon.activeCount 2')).toBeInTheDocument()
    expect(JSON.stringify(recurringStoreMock.rules)).toBe(before)
    Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
  })

  it('keeps currency and invalid-estimate reasons together when the list is filtered', async () => {
    Object.assign(recurringStoreMock.rules[0], { currency: 'EUR' })
    recurringStoreMock.rules.push({
      ...recurringStoreMock.rules[0],
      id: 'invalid',
      description: 'Invalid bill',
      frequency: 'bogus',
      next_date: '2020-01-01',
    })
    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'currency.missing estimate.invalidRules Invalid bill'
    )
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'overdue')
    expect(screen.queryByText('Rent')).not.toBeInTheDocument()
    expect(screen.getByText('Invalid bill')).toBeInTheDocument()
    expect(screen.getByText('currency.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'currency.missing estimate.invalidRules Invalid bill'
    )
    Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
  })

  it('withholds estimates for a rule with no recorded currency and marks its plain amount', () => {
    Object.assign(recurringStoreMock.rules[0], { currency: null, account_currency: null })
    const convert = vi.fn(convertMonthlyEstimate)
    useCurrencyStore.setState({ convertCurrentToPreferred: convert })

    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    expect(convert).not.toHaveBeenCalled()
    const row = within(screen.getByText('Rent').closest('li')!)
    expect(row.getByText('1,200.00 · currency.unknown')).toBeInTheDocument()
    expect(row.queryByText('$1,200.00')).not.toBeInTheDocument()
    const total = within(screen.getByText('monthlyRunRate').parentElement!)
    expect(total.getByText('currency.unavailable')).toBeInTheDocument()
    expect(total.queryByText('$1,200.00')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('estimate.unknownCurrencyRules Rent')
    expect(screen.getByText('horizon.activeCount 1')).toBeInTheDocument()
    Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
  })

  it('withholds an empty unconfigured run rate instead of using the EUR setup preference', () => {
    recurringStoreMock.rules = []
    useCurrencyStore.setState({ mainCurrency: null, preferredCurrency: 'EUR' })

    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    const total = within(screen.getByText('monthlyRunRate').parentElement!)
    expect(total.getByText('currency.unavailable')).toBeInTheDocument()
    expect(total.queryByText('€0.00')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('currencySetup.title')
    expect(screen.getByText('horizon.activeCount 0')).toBeInTheDocument()
    Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
  })

  it.each([
    { descriptions: ['Unknown bill'] },
    { descriptions: ['Unknown bill', 'Another unknown bill'] },
  ])(
    'withholds mixed totals and names only unknown-currency rules: $descriptions',
    ({ descriptions }) => {
      for (const [index, description] of descriptions.entries()) {
        recurringStoreMock.rules.push(
          Object.assign(
            { ...recurringStoreMock.rules[0], id: `unknown-${index}`, description },
            { currency: null, account_currency: null }
          )
        )
      }
      const before = JSON.stringify(recurringStoreMock.rules)
      const convert = vi.fn(convertMonthlyEstimate)
      useCurrencyStore.setState({ convertCurrentToPreferred: convert })

      render(
        <MemoryRouter>
          <BillsPage />
        </MemoryRouter>
      )

      expect(convert).toHaveBeenCalledExactlyOnceWith(120000, 'USD')
      const total = within(screen.getByText('monthlyRunRate').parentElement!)
      expect(total.getByText('currency.unavailable')).toBeInTheDocument()
      expect(total.queryByText('$1,200.00')).not.toBeInTheDocument()
      expect(screen.getByRole('status').textContent).toBe(
        `estimate.unknownCurrencyRules ${descriptions.join(', ')}`
      )
      expect(screen.getByRole('status')).toHaveClass('max-w-2xl', 'break-words')
      expect(screen.getByText('Rent')).toBeInTheDocument()
      for (const description of descriptions) {
        expect(screen.getByText(description)).toBeInTheDocument()
      }
      expect(screen.getByText(`horizon.activeCount ${descriptions.length + 1}`)).toBeInTheDocument()
      expect(
        within(screen.getByRole('list', { name: 'horizon.legend' })).getByRole('listitem', {
          name: `horizon.next7Count ${descriptions.length + 1}`,
        })
      ).toBeInTheDocument()
      expect(JSON.stringify(recurringStoreMock.rules)).toBe(before)
      Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
    }
  )

  it.each([
    { billCount: 0, amount: '€0.00' },
    { billCount: 1, amount: '€1,200.00' },
  ])(
    'uses the configured main currency for $billCount bills, not the setup draft',
    async ({ billCount, amount }) => {
      await setLocale('en')
      recurringStoreMock.rules = recurringStoreMock.rules.slice(0, billCount)
      recurringStoreMock.rules.forEach((rule) => Object.assign(rule, { currency: 'EUR' }))
      useCurrencyStore.setState({ mainCurrency: 'EUR', preferredCurrency: 'USD' })

      render(
        <MemoryRouter>
          <BillsPage />
        </MemoryRouter>
      )

      const total = within(screen.getByText('Monthly Run Rate').parentElement!)
      expect(total.getByText(amount)).toBeInTheDocument()
      expect(total.queryByText(/\$/)).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Due count method' }))
      expect(screen.getByText('EUR · planning estimate using today’s rate')).toBeInTheDocument()
      Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
    }
  )

  it.each([
    {
      language: 'en' as const,
      unavailable: 'Unavailable',
      rowAmount: '1,200.00 · Unknown currency',
      reason: 'Total unavailable: no currency recorded (Rent).',
      setupReason: 'Main currency needs to be configured',
    },
    {
      language: 'es' as const,
      unavailable: 'No disponible',
      rowAmount: '1200,00 · Moneda desconocida',
      reason: 'Total no disponible: no hay moneda registrada (Rent).',
      setupReason: 'Falta configurar la moneda principal',
    },
  ])(
    'renders the currency reasons and unknown marker in $language',
    async ({ language, unavailable, rowAmount, reason, setupReason }) => {
      for (const copy of [en, es]) {
        expect(copy.currency.unknown.length).toBeGreaterThan(0)
        expect(copy.estimate.unknownCurrencyRules).toContain('{{rules}}')
      }
      await setLocale(language)
      Object.assign(recurringStoreMock.rules[0], { currency: null, account_currency: null })

      render(
        <MemoryRouter>
          <BillsPage />
        </MemoryRouter>
      )

      expect(screen.getByText(unavailable)).toBeInTheDocument()
      expect(screen.getByText(rowAmount)).toBeInTheDocument()
      expect(screen.getByRole('status').textContent).toBe(reason)
      expect(screen.getByRole('status')).toHaveClass('max-w-2xl', 'break-words')
      act(() => useCurrencyStore.setState({ mainCurrency: null, preferredCurrency: 'EUR' }))
      expect(screen.getByRole('status').textContent).toBe(`${setupReason} ${reason}`)
      expect(screen.queryByText('€0.00')).not.toBeInTheDocument()
    }
  )

  it('rounds before conversion, prefers rule over account currency, and withholds unknown currency', () => {
    Object.assign(recurringStoreMock.rules[0], {
      amount: 1,
      frequency: 'quarterly',
      currency: 'USD',
      account_currency: 'EUR',
    })
    useCurrencyStore.setState({ manualRates: [fxRate('EUR', 'USD', '2')] })
    const convert = vi.fn(convertMonthlyEstimate)
    useCurrencyStore.setState({ convertCurrentToPreferred: convert })
    const page = render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    expect(convert).toHaveBeenCalledExactlyOnceWith(0, 'USD')
    expect(within(screen.getByText('Rent').closest('li')!).getByText('$0.01')).toBeInTheDocument()
    Object.assign(recurringStoreMock.rules[0], { currency: null })
    recurringStoreMock.rules = [...recurringStoreMock.rules]
    convert.mockClear()
    page.rerender(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    expect(convert).toHaveBeenCalledExactlyOnceWith(0, 'EUR')
    expect(
      within(screen.getByText('monthlyRunRate').parentElement!).getByText('$0.00')
    ).toBeInTheDocument()

    Object.assign(recurringStoreMock.rules[0], { account_currency: null })
    recurringStoreMock.rules = [...recurringStoreMock.rules]
    convert.mockClear()
    page.rerender(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )
    expect(convert).not.toHaveBeenCalled()
    expect(
      within(screen.getByText('monthlyRunRate').parentElement!).getByText('currency.unavailable')
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('estimate.unknownCurrencyRules Rent')
    Object.values(ledgerWrites).forEach((write) => expect(write).not.toHaveBeenCalled())
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
    expect(screen.queryByText('horizon.scope')).not.toBeInTheDocument()
  })

  it('keeps horizon method and list order behind info, and separates the due rail from the category dot', async () => {
    const user = userEvent.setup()
    const today = dayjs().startOf('day')
    recurringStoreMock.rules = [
      {
        ...recurringStoreMock.rules[0],
        id: 'overdue',
        description: 'Overdue rent',
        next_date: today.add(-1, 'day').format('YYYY-MM-DD'),
        category_color: '#ff0000',
      },
      {
        ...recurringStoreMock.rules[0],
        id: 'later',
        description: 'Later bill',
        next_date: today.add(10, 'day').format('YYYY-MM-DD'),
        category_color: '#00ff00',
      },
    ]

    render(
      <MemoryRouter>
        <BillsPage />
      </MemoryRouter>
    )

    expect(screen.queryByText('horizon.scope')).not.toBeInTheDocument()
    expect(screen.queryByText('currency.estimateToday')).not.toBeInTheDocument()
    expect(screen.queryByText('bills.upcomingDescription')).not.toBeInTheDocument()
    expect(screen.getByText('currency.estimate')).toBeInTheDocument()
    const runRate = screen.getByText('$2,400.00')
    expect(runRate.className).not.toMatch(/text-2xl|text-3xl|text-4xl/)
    expect(runRate.className).toMatch(/text-sm/)

    const overdueRow = screen.getByText('Overdue rent').closest('li')
    const laterRow = screen.getByText('Later bill').closest('li')
    expect(overdueRow).not.toBeNull()
    expect(laterRow).not.toBeNull()
    const overdueRail = overdueRow?.querySelector('[data-due-status]')
    const laterRail = laterRow?.querySelector('[data-due-status]')
    const overdueDot = overdueRow?.querySelector('[data-category-dot]')
    const laterDot = laterRow?.querySelector('[data-category-dot]')
    expect(overdueRail).toHaveAttribute('data-due-status', 'overdue')
    expect(overdueRail).toHaveClass('w-[3px]', 'bg-destructive')
    expect(overdueRail).not.toHaveClass('bg-warning', 'bg-success')
    expect(laterRail).toHaveAttribute('data-due-status', 'later')
    expect(laterRail).toHaveClass('w-[3px]', 'bg-success')
    expect(overdueDot).toHaveStyle({ backgroundColor: '#ff0000' })
    expect(laterDot).toHaveStyle({ backgroundColor: '#00ff00' })
    expect(overdueRail).not.toBe(overdueDot)
    expect(overdueDot).not.toHaveClass('w-[3px]')
    expect(overdueRail).not.toHaveAttribute('style')

    await user.click(screen.getByRole('button', { name: 'horizon.about' }))
    expect(screen.getByText('horizon.scope')).toBeInTheDocument()
    expect(screen.getByText('currency.estimateToday')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'bills.aboutList' }))
    expect(screen.getByText('bills.upcomingDescription')).toBeInTheDocument()
  })
})
