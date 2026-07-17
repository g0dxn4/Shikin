import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { buildDashboardAnalytics, formatDashboardNotice } from '../dashboard-analytics'
import type { ConversionRate } from '@shikin/finance-core'
import type { DashboardTransaction, DashboardSplit } from '../dashboard-analytics'

const USD_RATES: ConversionRate[] = [
  { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.1 },
  { fromCurrency: 'MXN', toCurrency: 'USD', rate: 0.05 },
]

const FIXED_NOW = dayjs('2024-06-15')

function makeTransaction(
  id: string,
  type: 'income' | 'expense' | 'transfer',
  amount: number,
  currency: string,
  date: string,
  overrides: Partial<DashboardTransaction> = {}
): DashboardTransaction {
  return {
    id,
    type,
    amount,
    currency,
    date,
    status: 'posted',
    reporting_treatment: 'normal',
    transaction_kind: 'standard',
    is_archived: 0,
    category_id: null,
    ...overrides,
  }
}

describe('buildDashboardAnalytics', () => {
  it('returns empty, complete analytics with no transactions', () => {
    const result = buildDashboardAnalytics({
      transactions: [],
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.conversion.kind).toBe('complete')
    expect(result.pace.spentMTD).toBe(0)
    expect(result.pace.projectedMonthEnd).toBe(0)
    expect(result.trend.months).toHaveLength(12)
    expect(result.trend.totalIncome).toBe(0)
    expect(result.trend.totalExpenses).toBe(0)
    expect(result.categories.currentMonthBreakdown).toHaveLength(0)
  })

  it('filters non-eligible transactions from every aggregate', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('pending', 'expense', 10000, 'USD', '2024-06-10', { status: 'pending' }),
      makeTransaction('bridge', 'expense', 20000, 'USD', '2024-06-10', {
        transaction_kind: 'reconciliation_bridge',
      }),
      makeTransaction('archive', 'expense', 30000, 'USD', '2024-06-10', { is_archived: 1 }),
      makeTransaction('transfer', 'transfer', 40000, 'USD', '2024-06-10'),
      makeTransaction('eligible', 'expense', 50000, 'USD', '2024-06-10'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.pace.spentMTD).toBe(50000)
    expect(result.trend.months.find((m) => m.isCurrent)?.expenses).toBe(50000)
    expect(result.categories.currentMonthBreakdown).toHaveLength(1)
    expect(result.categories.currentMonthBreakdown[0].amount).toBe(50000)
  })

  it('computes current month MTD pace and run-rate projection', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('e1', 'expense', 10000, 'USD', '2024-06-05'),
      makeTransaction('e2', 'expense', 20000, 'USD', '2024-06-10'),
      makeTransaction('e3', 'expense', 30000, 'USD', '2024-06-15'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.pace.spentMTD).toBe(60000)
    expect(result.pace.projectedMonthEnd).toBe(
      Math.round((60000 / 15) * 30) // 30 days in June 2024
    )
    expect(result.pace.points).toHaveLength(30)
    expect(result.pace.points[0].current).toBe(0) // day 1: no expenses yet
    expect(result.pace.points[4].current).toBe(10000) // day 5: first expense
    expect(result.pace.points[14].current).toBe(60000) // day 15: MTD total
    expect(result.pace.points[15].current).toBeNull() // day 16: future
    expect(result.pace.points[29].runRate).toBe(result.pace.projectedMonthEnd)
  })

  it('compares to previous month and prior spending months', () => {
    const transactions: DashboardTransaction[] = [
      // Current month (June 2024): 6 days in, 50000 spent
      makeTransaction('cur', 'expense', 50000, 'USD', '2024-06-06'),
      // Previous month (May 2024): full month 120000
      makeTransaction('prev', 'expense', 120000, 'USD', '2024-05-15'),
      // Prior months: April 90000, March 60000
      makeTransaction('apr1', 'expense', 40000, 'USD', '2024-04-05'),
      makeTransaction('apr2', 'expense', 50000, 'USD', '2024-04-20'),
      makeTransaction('mar1', 'expense', 30000, 'USD', '2024-03-10'),
      makeTransaction('mar2', 'expense', 30000, 'USD', '2024-03-25'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.pace.priorAverageTotal).toBe(Math.round((90000 + 60000) / 2))
    expect(result.pace.vsPriorAverage).toBe(50000 - result.pace.priorAverageTotal)
    expect(result.pace.points[0].previous).toBe(0)
    expect(result.pace.points[29].previous).toBe(120000) // June has 30 days, cap at May total
  })

  it('builds 12 month trend buckets with income and expenses', () => {
    const transactions: DashboardTransaction[] = []
    for (let i = 0; i < 12; i++) {
      const month = dayjs('2024-06-15').subtract(i, 'month')
      transactions.push(
        makeTransaction(`inc-${i}`, 'income', 100000 + i * 1000, 'USD', month.format('YYYY-MM-15'))
      )
      transactions.push(
        makeTransaction(`exp-${i}`, 'expense', 20000 + i * 500, 'USD', month.format('YYYY-MM-10'))
      )
    }

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.trend.months).toHaveLength(12)
    const currentMonth = result.trend.months.find((m) => m.isCurrent)
    expect(currentMonth?.income).toBe(100000)
    expect(currentMonth?.expenses).toBe(20000)
    expect(currentMonth?.net).toBe(80000)
    expect(result.trend.totalNet).toBe(result.trend.totalIncome - result.trend.totalExpenses)
  })

  it('converts through preferred currency and sums integer centavos', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('eur', 'expense', 10000, 'EUR', '2024-06-10'),
      makeTransaction('usd', 'expense', 20000, 'USD', '2024-06-11'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.conversion.kind).toBe('complete')
    expect(result.pace.spentMTD).toBe(Math.round(10000 * 1.1) + 20000)
    expect(result.trend.months.find((m) => m.isCurrent)?.expenses).toBe(
      Math.round(10000 * 1.1) + 20000
    )
  })

  it('falls back to a single source currency when preferred conversion is missing', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('mxn1', 'expense', 100000, 'MXN', '2024-06-05'),
      makeTransaction('mxn2', 'expense', 50000, 'MXN', '2024-06-10'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: [], // no MXN rate
      now: FIXED_NOW,
    })

    expect(result.conversion.kind).toBe('fallback')
    expect(result.conversion.currency).toBe('MXN')
    expect(result.pace.spentMTD).toBe(150000)
    expect(result.trend.months.find((m) => m.isCurrent)?.expenses).toBe(150000)
  })

  it('keeps out-of-range currencies from disabling current dashboard analytics', () => {
    const result = buildDashboardAnalytics({
      transactions: [
        makeTransaction('current', 'expense', 10000, 'USD', '2024-06-10'),
        makeTransaction('ancient', 'expense', 10000, 'MXN', '2010-01-01'),
      ],
      splits: [],
      preferredCurrency: 'USD',
      rates: [],
      now: FIXED_NOW,
    })

    expect(result.cashFlowConversion.kind).toBe('complete')
    expect(result.pace.conversion.kind).toBe('complete')
    expect(result.trend.conversion.kind).toBe('complete')
    expect(result.categories.conversion.kind).toBe('complete')
    expect(result.pace.spentMTD).toBe(10000)
  })

  it('isolates conversion gaps to the displayed panel horizons', () => {
    const result = buildDashboardAnalytics({
      transactions: [
        makeTransaction('current', 'expense', 10000, 'USD', '2024-06-10'),
        makeTransaction('previous', 'expense', 10000, 'USD', '2024-05-10'),
        makeTransaction('prior-1', 'expense', 10000, 'USD', '2024-04-10'),
        makeTransaction('prior-2', 'expense', 10000, 'USD', '2024-03-10'),
        makeTransaction('prior-3', 'expense', 10000, 'USD', '2024-02-10'),
        makeTransaction('older-visible', 'expense', 10000, 'MXN', '2023-09-10'),
      ],
      splits: [],
      preferredCurrency: 'USD',
      rates: [],
      now: FIXED_NOW,
    })

    expect(result.cashFlowConversion.kind).toBe('complete')
    expect(result.pace.conversion.kind).toBe('complete')
    expect(result.trend.conversion.kind).toBe('incomplete')
    expect(result.categories.conversion.kind).toBe('incomplete')
  })

  it('fails closed on mixed currencies with missing rates', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('usd', 'expense', 10000, 'USD', '2024-06-05'),
      makeTransaction('mxn', 'expense', 10000, 'MXN', '2024-06-10'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: [],
      now: FIXED_NOW,
    })

    expect(result.conversion.kind).toBe('incomplete')
    expect(result.pace.spentMTD).toBe(0)
    expect(result.trend.months.find((m) => m.isCurrent)?.expenses).toBe(0)
  })

  it('uses splits for category composition and does not double-count parent', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('split-parent', 'expense', 30000, 'USD', '2024-06-10', {
        category_id: 'cat-parent',
      }),
    ]
    const splits: DashboardSplit[] = [
      {
        transaction_id: 'split-parent',
        category_id: 'cat-food',
        category_name: 'Food',
        category_color: '#34D399',
        amount: 20000,
        date: '2024-06-10',
      },
      {
        transaction_id: 'split-parent',
        category_id: 'cat-transport',
        category_name: 'Transport',
        category_color: '#F59E0B',
        amount: 10000,
        date: '2024-06-10',
      },
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits,
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    const breakdown = result.categories.currentMonthBreakdown
    expect(breakdown).toHaveLength(2)
    expect(breakdown.find((b) => b.categoryId === 'cat-food')?.amount).toBe(20000)
    expect(breakdown.find((b) => b.categoryId === 'cat-transport')?.amount).toBe(10000)
    // Pace still counts the full parent transaction once.
    expect(result.pace.spentMTD).toBe(30000)
  })

  it('exposes a split integrity notice when split amounts do not reconcile', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('split-parent', 'expense', 30000, 'USD', '2024-06-10'),
    ]
    const splits: DashboardSplit[] = [
      {
        transaction_id: 'split-parent',
        category_id: 'cat-food',
        category_name: 'Food',
        category_color: null,
        amount: 25000,
        date: '2024-06-10',
      },
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits,
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.categories.splitIntegrityNotices).toHaveLength(1)
    expect(result.categories.splitIntegrityNotices[0].transactionId).toBe('split-parent')
    expect(result.categories.splitIntegrityNotices[0].difference).toBe(5000)
  })

  it('groups non-split expenses into Uncategorized', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('plain', 'expense', 15000, 'USD', '2024-06-10'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    const breakdown = result.categories.currentMonthBreakdown
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0].categoryId).toBe('uncategorized')
    expect(breakdown[0].name).toBe('Uncategorized')
    expect(breakdown[0].amount).toBe(15000)
  })

  it('uses category id and name for non-split expenses when available', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('plain', 'expense', 15000, 'USD', '2024-06-10', {
        category_id: 'cat-food',
        category_name: 'Food',
        category_color: '#34D399',
      }),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    const breakdown = result.categories.currentMonthBreakdown
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0].categoryId).toBe('cat-food')
    expect(breakdown[0].name).toBe('Food')
    expect(breakdown[0].color).toBe('#34D399')
    expect(breakdown[0].amount).toBe(15000)
  })

  it('only includes current month transactions up to the fixed now date', () => {
    const transactions: DashboardTransaction[] = [
      makeTransaction('before', 'expense', 10000, 'USD', '2024-06-14'),
      makeTransaction('after', 'expense', 90000, 'USD', '2024-06-16'),
    ]

    const result = buildDashboardAnalytics({
      transactions,
      splits: [],
      preferredCurrency: 'USD',
      rates: USD_RATES,
      now: FIXED_NOW,
    })

    expect(result.pace.spentMTD).toBe(10000)
    expect(result.trend.months.find((m) => m.isCurrent)?.expenses).toBe(10000)
  })
})

describe('formatDashboardNotice', () => {
  it('renders fallback notice', () => {
    const notice = formatDashboardNotice({
      kind: 'fallback',
      currency: 'MXN',
      missingTarget: 'USD',
      missingCurrencies: ['MXN'],
    })
    expect(notice).toBe('Showing MXN; USD conversion unavailable')
  })

  it('renders single missing currency notice', () => {
    const notice = formatDashboardNotice({
      kind: 'incomplete',
      currency: 'USD',
      missingCurrencies: ['EUR'],
    })
    expect(notice).toBe('Conversion unavailable for EUR')
  })

  it('renders multiple missing currencies notice', () => {
    const notice = formatDashboardNotice({
      kind: 'incomplete',
      currency: 'USD',
      missingCurrencies: ['EUR', 'MXN'],
    })
    expect(notice).toBe('Conversion unavailable for EUR, MXN')
  })

  it('returns null for complete conversion', () => {
    const notice = formatDashboardNotice({
      kind: 'complete',
      currency: 'USD',
      missingCurrencies: [],
    })
    expect(notice).toBeNull()
  })
})
