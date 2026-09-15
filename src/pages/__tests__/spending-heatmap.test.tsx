import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import dayjs from 'dayjs'
import { SpendingHeatmap } from '../spending-heatmap'
import type { HeatmapLedgerRow } from '@/lib/spending-heatmap'

const mockFetchRows = vi.fn()
const mockLoadRates = vi.fn().mockResolvedValue(undefined)

let mockConvert: (
  amountCentavos: number,
  currency: string
) => {
  complete: boolean
  amountCentavos?: number
  missingCurrencies?: string[]
  reason?: 'missing_exchange_rates' | 'invalid_currency_data'
}

const mockConvertToPreferred = (amountCentavos: number, currency: string) =>
  mockConvert(amountCentavos, currency)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { currencies?: string; n?: number; count?: number }) =>
      options?.currencies
        ? `${key}: ${options.currencies}`
        : options?.n !== undefined
          ? `${key}: ${options.n}`
          : options?.count !== undefined
            ? `${key}: ${options.count}`
            : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/lib/database', () => ({
  query: (...args: unknown[]) => mockFetchRows(...args),
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
    preferredCurrency: 'USD',
    convertToPreferred: mockConvertToPreferred,
    loadRates: mockLoadRates,
  }),
}))

function row(overrides: Partial<HeatmapLedgerRow> = {}): HeatmapLedgerRow {
  return {
    id: 'tx-1',
    date: dayjs().format('YYYY-MM-DD'),
    amount: 2500,
    currency: 'USD',
    type: 'expense',
    status: 'posted',
    reporting_treatment: 'normal',
    transaction_kind: 'standard',
    is_archived: 0,
    category_id: 'cat-food',
    category_name: 'Food',
    category_color: '#f97316',
    account_id: 'acc-1',
    description: 'Groceries',
    ...overrides,
  }
}

describe('SpendingHeatmap page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConvert = (amountCentavos, currency) => {
      if (currency === 'USD') {
        return { complete: true, amountCentavos, missingCurrencies: [] }
      }
      return {
        complete: false,
        missingCurrencies: [currency],
        reason: 'missing_exchange_rates',
      }
    }
    mockFetchRows.mockResolvedValue([row()])
  })

  it('converts eligible spending and drills a day into the ledger query contract', async () => {
    const today = dayjs().format('YYYY-MM-DD')
    mockFetchRows.mockResolvedValue([
      row({ id: 'usd', amount: 2500, date: today }),
      row({
        id: 'pending',
        amount: 90000,
        date: today,
        status: 'pending',
      }),
    ])

    render(<SpendingHeatmap />)

    await waitFor(() => {
      expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(`${today}:`) }))

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'spendingHeatmap.openDay' })).toHaveAttribute(
      'href',
      `/transactions?type=expense&dateFrom=${today}&dateTo=${today}`
    )
    expect(screen.getByRole('link', { name: /Food/ })).toHaveAttribute(
      'href',
      expect.stringContaining('type=expense&category=cat-food')
    )
  })

  it('omits heatmap totals when mixed currencies are missing rates', async () => {
    mockFetchRows.mockResolvedValue([
      row({ id: 'usd', amount: 2500, currency: 'USD' }),
      row({ id: 'eur', amount: 8000, currency: 'EUR' }),
    ])

    render(<SpendingHeatmap />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('spendingHeatmap.incompleteTotals: EUR')
    })
    expect(screen.queryByText('$25.00')).not.toBeInTheDocument()
    expect(screen.queryByText('$105.00')).not.toBeInTheDocument()
  })
})
