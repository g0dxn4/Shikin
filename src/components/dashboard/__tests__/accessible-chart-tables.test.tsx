import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OverviewCashFlow } from '@/components/dashboard/overview-cash-flow'
import { SpendingCategoriesPanel } from '@/components/dashboard/spending-categories-panel'
import { SpendingPacePanel } from '@/components/dashboard/spending-pace-panel'
import { SpendingTrendPanel } from '@/components/dashboard/spending-trend-panel'
import type {
  CategoriesResult,
  PaceResult,
  TrendMonth,
  TrendResult,
} from '@/lib/dashboard-analytics'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: () => null,
}))

vi.mock('recharts', () => ({
  BarChart: () => null,
  Bar: () => null,
  LineChart: () => null,
  Line: () => null,
  ComposedChart: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}))

const conversion = { kind: 'complete', currency: 'USD', missingCurrencies: [] } as const

function expectAccessibleTable(container: HTMLElement, id: string, caption: string) {
  const chart = container.querySelector(`[aria-describedby="${id}"]`)
  const table = within(container).getByRole('table', { name: caption })
  const wrapper = table.parentElement

  expect(chart).toHaveAttribute('aria-describedby', id)
  expect(table).toHaveAttribute('id', id)
  expect(table.caption).toHaveTextContent(caption)
  expect(table).not.toHaveClass('sr-only')
  expect(table).not.toHaveAttribute('aria-hidden')
  expect(table).not.toHaveAttribute('hidden')
  expect(wrapper?.tagName).toBe('DIV')
  expect(wrapper).toHaveClass('sr-only')
  expect(wrapper).not.toHaveAttribute('aria-hidden')
  expect(wrapper).not.toHaveAttribute('hidden')

  return table
}

const month: TrendMonth = {
  key: '2026-01',
  label: 'January',
  isCurrent: true,
  income: 12_345,
  expenses: 2_345,
  net: 10_000,
  conversion,
}

const pace: PaceResult = {
  currentMonth: '2026-01',
  daysInMonth: 31,
  todayDay: 1,
  points: [{ day: 1, current: 1_234, previous: 2_345, priorAverage: 3_456, runRate: 4_567 }],
  spentMTD: 1_234,
  projectedMonthEnd: 4_567,
  priorAverageTotal: 3_456,
  vsPriorAverage: 1_111,
  conversion,
}

const trend: TrendResult = {
  months: [month],
  totalIncome: month.income,
  totalExpenses: month.expenses,
  totalNet: month.net,
  conversion,
}

const categories: CategoriesResult = {
  months: [
    {
      key: '2026-01',
      label: 'January',
      isCurrent: true,
      byCategoryId: { groceries: 5_678 },
    },
  ],
  categoryMeta: { groceries: { name: 'Groceries', color: '#123456' } },
  topCategoryIds: ['groceries'],
  otherCategoryId: 'other',
  currentMonthBreakdown: [
    {
      categoryId: 'groceries',
      name: 'Groceries',
      color: '#123456',
      amount: 5_678,
      percent: 100,
    },
  ],
  splitIntegrityNotices: [],
  conversion,
}

describe('accessible chart data tables', () => {
  it('keeps the overview cash-flow table semantic while hiding its wrapper', () => {
    const { container } = render(<OverviewCashFlow months={[month]} displayCurrency="USD" />)

    expect(
      within(container).getByRole('heading', { name: 'overview.cashFlow' })
    ).toBeInTheDocument()
    const table = expectAccessibleTable(container, 'overview-cashflow-data', 'overview.cashFlow')
    expect(
      within(table).getByRole('row', { name: /January \$123\.45 \$23\.45 \$100\.00/ })
    ).toBeInTheDocument()
  })

  it('keeps the spending pace table semantic while hiding its wrapper', () => {
    const { container } = render(
      <SpendingPacePanel pace={pace} displayCurrency="USD" notice={null} />
    )

    const table = expectAccessibleTable(container, 'spending-pace-data', 'analytics.paceChartLabel')
    expect(
      within(table).getByRole('row', { name: /1 \$12\.34 \$23\.45 \$34\.56 \$45\.67/ })
    ).toBeInTheDocument()
  })

  it('keeps the spending trend table semantic while hiding its wrapper', () => {
    const { container } = render(
      <SpendingTrendPanel trend={trend} displayCurrency="USD" notice={null} />
    )

    const table = expectAccessibleTable(
      container,
      'spending-trend-data',
      'analytics.trendChartLabel'
    )
    expect(
      within(table).getByRole('row', { name: /January \$123\.45 \$23\.45 \$100\.00/ })
    ).toBeInTheDocument()
  })

  it('keeps the spending categories table semantic while hiding its wrapper', () => {
    const { container } = render(
      <SpendingCategoriesPanel categories={categories} displayCurrency="USD" notice={null} />
    )

    const table = expectAccessibleTable(
      container,
      'spending-categories-data',
      'analytics.categoriesChartLabel'
    )
    expect(within(table).getByRole('row', { name: /January \$56\.78/ })).toBeInTheDocument()
  })
})
