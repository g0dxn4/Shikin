import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/budgets/use-budget-display', () => ({
  useBudgetDisplay: (budgets: Array<Record<string, unknown>>) => ({
    budgets: budgets.map((budget) => ({ ...budget, complete: true, currency: 'USD' })),
    error: null,
  }),
}))
vi.mock('@/components/budgets/cashflow-buckets-panel', () => ({
  CashflowBucketsPanel: () => <section aria-label="virtual buckets">bucket-panel</section>,
}))
vi.mock('@/stores/ui-store', () => ({ useUIStore: () => ({ openBudgetDialog: vi.fn() }) }))
vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({ preferredCurrency: 'USD' }),
}))
vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: () => ({
    budgets: [
      {
        id: 'budget-1',
        name: 'Monthly food',
        categoryName: 'Food',
        amount: 50_00,
        spent: 20_00,
        remaining: 30_00,
        percentUsed: 40,
        period: 'monthly',
      },
    ],
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { Budgets } from '../budgets'

describe('Budgets cashflow bucket panel integration', () => {
  it('mounts the compact panel below existing budget intelligence without a new page title', () => {
    render(<Budgets />)
    const intelligence = screen.getByRole('heading', { name: 'intelligence.title' })
    const buckets = screen.getByRole('region', { name: 'virtual buckets' })
    expect(
      intelligence.compareDocumentPosition(buckets) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByText('progress.title')).toBeInTheDocument()
  })
})
