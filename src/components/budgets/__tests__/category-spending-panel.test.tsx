import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CategorySpendingPanel } from '../category-spending-panel'

const state = vi.hoisted(() => ({
  mainCurrency: 'USD' as string | null,
  loading: false,
  error: null as string | null,
  rows: [] as Array<{
    categoryId: string
    spending: {
      complete: boolean
      totalCentavos: number | null
      nativeTotals: Array<{ currency: string; amountCentavos: number }>
      unresolvedIds: string[]
    }
  }>,
}))
vi.mock('../use-budget-range-spending', () => ({
  useBudgetRangeSpending: (_categories: unknown, preset: string) => ({
    range:
      preset === 'all-time'
        ? { start: null, end: '2026-06-18' }
        : { start: '2026-06-01', end: '2026-06-18' },
    ...state,
    retry: vi.fn(),
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${Object.values(values).join(' ')}` : key,
  }),
}))

const categories = [
  { categoryId: 'food', name: 'Food', currency: 'USD' },
  { categoryId: 'food', name: 'Food (second plan)', currency: 'USD' },
  { categoryId: 'rent', name: 'Rent', currency: 'EUR' },
]

describe('category spending panel', () => {
  it('shows deduplicated actuals and date bounds without range limit or utilization targets', async () => {
    state.mainCurrency = 'USD'
    state.rows = [
      {
        categoryId: 'food',
        spending: {
          complete: true,
          totalCentavos: 3500,
          nativeTotals: [{ currency: 'USD', amountCentavos: 3500 }],
          unresolvedIds: [],
        },
      },
      {
        categoryId: 'rent',
        spending: {
          complete: false,
          totalCentavos: null,
          nativeTotals: [{ currency: 'EUR', amountCentavos: 1200 }],
          unresolvedIds: ['tx-1'],
        },
      },
    ]
    render(<CategorySpendingPanel categories={categories} />)
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.queryByText('Food (second plan)')).not.toBeInTheDocument()
    expect(screen.getByText('actual.dates 2026-06-01 2026-06-18')).toBeInTheDocument()
    expect(screen.getByText('actual.unavailable')).toBeInTheDocument()
    expect(screen.getByText(/actual.native.*€12/)).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-hidden="true"] .bg-primary')).toHaveLength(1)
    expect(screen.queryByText('currentContext')).not.toBeInTheDocument()
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'actual.rangeLabel' }), 'all-time')
    expect(screen.getByText('actual.through 2026-06-18')).toBeInTheDocument()
  })

  it('does not present main-currency totals without an authoritative main currency', () => {
    state.mainCurrency = null
    state.rows = [
      {
        categoryId: 'food',
        spending: {
          complete: true,
          totalCentavos: 3500,
          nativeTotals: [{ currency: 'USD', amountCentavos: 3500 }],
          unresolvedIds: [],
        },
      },
    ]
    render(<CategorySpendingPanel categories={categories.slice(0, 1)} />)
    expect(screen.getByText('actual.noMain')).toBeInTheDocument()
    expect(screen.getByText('actual.unavailable')).toBeInTheDocument()
    expect(screen.getByText(/actual.native.*\$35/)).toBeInTheDocument()
  })
})
