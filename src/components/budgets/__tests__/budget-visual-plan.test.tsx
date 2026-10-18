import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@/i18n'
import i18n from '@/i18n'
import type { DisplayBudget } from '@/components/budgets/use-budget-display'
import { formatMoney } from '@/lib/money'
import { BudgetVisualPlan } from '@/components/budgets/budget-visual-plan'
import { BudgetVisualCollection } from '@/components/budgets/budget-visual-collection'

vi.mock('@/components/budgets/scoped-result', () => ({
  ScopedActualResult: ({
    result,
    compact,
  }: {
    result: { basis?: string; transactionIds?: string[] }
    compact?: boolean
  }) => (
    <div data-evidence-compact={String(!!compact)} data-evidence-basis={result.basis ?? ''}>
      <p>Inspect scope, coverage & money evidence</p>
      <button type="button">
        Inspect contributing transactions · {result.transactionIds?.length ?? 0}
      </button>
    </div>
  ),
}))

const references = {
  accounts: [
    {
      id: 'bank',
      name: 'Bank',
      type: 'checking',
      currency: 'USD',
      account_mode: 'transactional',
      is_archived: 0,
    },
  ],
  categories: [{ id: 'food', name: 'Food', color: '#f97316' }],
}

function plan(overrides: Record<string, unknown> = {}): DisplayBudget {
  return {
    id: 'food',
    name: 'Food plan',
    category_id: 'food',
    categoryName: 'Food',
    categoryColor: '#f97316',
    amount: 100000,
    period: 'monthly',
    currency: 'USD',
    is_active: 1,
    limitCentavos: 100000,
    spent: 25000,
    remaining: 75000,
    percentUsed: 25,
    comparison: { limitComparable: true },
    result: {
      complete: true,
      basis: 'gross_cashflow',
      currency: 'USD',
      window: { start: '2026-01-01', end: '2026-01-31', timeZone: 'UTC' },
      transactionIds: ['expense'],
      scope: {},
    },
    ...overrides,
  } as DisplayBudget
}

describe('budget visual plan', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('draws a filled ring only for a comparable complete percent and keeps full money', () => {
    render(
      <BudgetVisualPlan
        budget={plan()}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const ring = screen.getByRole('progressbar')
    expect(ring).toHaveAttribute('data-budget-usage-filled', 'true')
    expect(ring).toHaveAttribute('data-budget-usage-percent', '25')
    expect(ring).toHaveAttribute('data-budget-usage-visual-percent', '25')
    expect(ring.querySelector('[data-budget-usage-arc]')).toHaveAttribute(
      'data-budget-usage-arc',
      '25'
    )
    expect(ring).toHaveAccessibleName(
      /Food plan, Food: 25% used\. Spent \$250\.00 of \$1,000\.00\. Remaining \$750\.00/
    )
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('$750.00')).toBeInTheDocument()
    expect(screen.getByText('On track · 25%')).toHaveClass('text-success')
    expect(screen.getByText('Actual gross')).toBeInTheDocument()
    expect(screen.getByText(/2026-01-01 .+ 2026-01-31 · UTC/)).toBeInTheDocument()
    expect(screen.getByText('Inspect scope, coverage & money evidence')).toBeInTheDocument()
    expect(document.querySelector('[data-evidence-compact="true"]')).toHaveAttribute(
      'data-evidence-basis',
      'gross_cashflow'
    )
  })

  it('caps the ring above 100 and keeps the exact percent and over amount', () => {
    render(
      <BudgetVisualPlan
        budget={plan({
          id: 'over',
          name: 'Travel plan',
          currency: 'EUR',
          limitCentavos: 10000,
          spent: 14000,
          remaining: -4000,
          percentUsed: 140,
        })}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const ring = screen.getByRole('progressbar')
    expect(ring).toHaveAttribute('data-budget-usage-percent', '140')
    expect(ring).toHaveAttribute('data-budget-usage-visual-percent', '100')
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring).toHaveAttribute('aria-valuetext', '140%')
    expect(ring.querySelector('[data-budget-usage-arc]')).toHaveAttribute(
      'data-budget-usage-arc',
      '100'
    )
    expect(screen.getByText('140%')).toBeInTheDocument()
    expect(screen.getByText(formatMoney(14000, 'EUR'))).toBeInTheDocument()
    expect(screen.getByText(formatMoney(10000, 'EUR'))).toBeInTheDocument()
    expect(screen.getByText(formatMoney(-4000, 'EUR'))).toHaveClass('text-destructive')
    expect(screen.getByText(/Over budget · €40\.00 · 140%/)).toBeInTheDocument()
    expect(screen.getByText(/ring stops at 100%/)).toBeInTheDocument()
  })

  it('shows an em dash and no arc when the limit is not comparable', () => {
    const { container } = render(
      <BudgetVisualPlan
        budget={plan({
          comparison: { limitComparable: false },
          percentUsed: 90,
          limitCentavos: null,
          remaining: null,
          spent: 25000,
        })}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const ring = screen.getByRole('img', { name: /usage unavailable/i })
    expect(ring).toHaveAttribute('data-budget-usage-filled', 'false')
    expect(ring.querySelector('[data-budget-usage-arc]')).toBeNull()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(container.querySelector('[style*="width"]')).toBeNull()
    expect(screen.getByText('Usage unavailable')).toBeInTheDocument()
    expect(screen.getByText(/This range spans plan periods/)).toBeInTheDocument()
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('does not fill a ring when the scoped result is incomplete', () => {
    render(
      <BudgetVisualPlan
        budget={plan({
          result: {
            complete: false,
            basis: 'net_consumption',
            currency: 'USD',
            window: { start: '2026-01-01', end: '2026-01-31', timeZone: 'UTC' },
            transactionIds: [],
          },
          percentUsed: 40,
          spent: 40000,
          remaining: 60000,
          limitCentavos: 100000,
        })}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('data-budget-usage-filled', 'false')
    expect(document.querySelector('[data-budget-usage-arc]')).toBeNull()
    expect(screen.getByText('Usage unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/40%/)).not.toBeInTheDocument()
    expect(document.querySelector('[data-evidence-basis="net_consumption"]')).toBeInTheDocument()
  })

  it('keeps edit, delete, and inactive copy on the plan', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <BudgetVisualPlan
        budget={plan({ is_active: 0 })}
        references={references}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )
    expect(screen.getByText('Inactive budget · editable for reactivation')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Food plan' }))
    await user.click(screen.getByRole('button', { name: 'Delete Food plan' }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: /Inspect contributing transactions · 1/ })
    ).toBeInTheDocument()
  })
})

describe('budget visual collection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('does not sum overlapping or mixed-currency plans', () => {
    const usd = plan()
    const overlap = plan({
      id: 'overlap',
      name: 'Dining plan',
      categoryName: 'Dining',
      categoryColor: '#22c55e',
      limitCentavos: 50000,
      amount: 50000,
      spent: 40000,
      remaining: 10000,
      percentUsed: 80,
    })
    const euro = plan({
      id: 'euro',
      name: 'Rent plan',
      categoryName: 'Rent',
      categoryColor: '#3b82f6',
      currency: 'EUR',
      period: 'yearly',
      limitCentavos: 80000,
      amount: 80000,
      spent: 90000,
      remaining: -10000,
      percentUsed: 113,
      result: {
        complete: true,
        basis: 'gross_cashflow',
        currency: 'EUR',
        window: { start: '2026-01-01', end: '2026-12-31', timeZone: 'UTC' },
        transactionIds: [],
      },
    })
    render(
      <BudgetVisualCollection
        plans={[usd, overlap, euro]}
        visiblePlans={[usd, overlap, euro]}
        references={references}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.getAllByRole('progressbar')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'Plan usage' })).toBeInTheDocument()
    expect(screen.getByText(/Budgets may overlap/)).toBeInTheDocument()
    expect(screen.getByText('3 plans · 1 over plan')).toBeInTheDocument()
    for (const amount of [100000, 25000, 75000, 50000, 40000, 10000]) {
      expect(screen.getAllByText(formatMoney(amount, 'USD')).length).toBeGreaterThan(0)
    }
    for (const amount of [80000, 90000, -10000]) {
      expect(screen.getByText(formatMoney(amount, 'EUR'))).toBeInTheDocument()
    }
    const text = document.body.textContent ?? ''
    for (const summed of [150000, 65000, 85000, 115000, 180000]) {
      expect(text).not.toContain(formatMoney(summed, 'USD'))
      expect(text).not.toContain(formatMoney(summed, 'EUR'))
    }
    expect(screen.queryByText(/Total Budgeted|Total Spent|Total Remaining/)).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-budget-usage-arc]')).toHaveLength(3)
  })
})
