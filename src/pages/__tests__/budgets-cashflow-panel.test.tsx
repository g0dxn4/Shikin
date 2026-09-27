import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/budgets/scoped-result', () => ({ ScopedActualResult: () => null }))
vi.mock('@/components/budgets/use-budget-display', () => ({
  useBudgetDisplay: (budgets: Array<Record<string, unknown>>) => ({
    budgets: budgets.map((budget) => ({ ...budget, complete: true, currency: 'USD' })),
    error: null,
  }),
}))
vi.mock('@/components/budgets/category-spending-panel', () => ({
  CategorySpendingPanel: () => <section aria-label="category actuals">category-actuals</section>,
}))
vi.mock('@/components/budgets/cashflow-buckets-panel', () => ({
  CashflowBucketsPanel: () => <section aria-label="virtual buckets">bucket-panel</section>,
}))
vi.mock('@/stores/ui-store', () => ({ useUIStore: () => ({ openBudgetDialog: vi.fn() }) }))
vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({ preferredCurrency: 'USD' }),
}))
const budgetStore = vi.hoisted(() => ({
  budgets: [
    {
      id: 'budget-1',
      name: 'Food',
      categoryName: 'Food',
      amount: 5000,
      period: 'monthly',
      category_id: 'food',
      is_active: 1,
      comparison: { limitComparable: true },
      result: { window: {} },
    },
  ] as Array<Record<string, unknown>>,
}))
vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: () => ({
    budgets: budgetStore.budgets,
    options: { includeInactive: false },
    isLoading: false,
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
  }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { Budgets } from '../budgets'

describe('Budgets page scope', () => {
  it('shows category actuals beside current-plan cards but does not mount virtual buckets', async () => {
    render(
      <MemoryRouter>
        <Budgets />
      </MemoryRouter>
    )
    expect(await screen.findByRole('region', { name: 'category actuals' })).toBeInTheDocument()
    expect(screen.getByText(/scoped.currentDefinition/)).toBeInTheDocument()
    expect(screen.getByText('progress.title')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'virtual buckets' })).not.toBeInTheDocument()
  })

  it('retains empty budget state without mounting virtual buckets', async () => {
    budgetStore.budgets = []
    render(
      <MemoryRouter>
        <Budgets />
      </MemoryRouter>
    )
    expect(await screen.findByText('empty.title')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'virtual buckets' })).not.toBeInTheDocument()
  })
})
