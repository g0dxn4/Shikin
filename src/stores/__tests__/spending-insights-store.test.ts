import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import dayjs from 'dayjs'
import { query } from '@/lib/database'
import { useCurrencyStore } from '@/stores/currency-store'
import { useSpendingInsightsStore } from '../spending-insights-store'

const mockQuery = vi.mocked(query)

function row(overrides: Record<string, unknown> = {}) {
  return {
    category_id: 'cat-food',
    category_name: 'Food',
    category_color: '#f97316',
    currency: 'USD',
    type: 'expense',
    status: 'posted',
    reporting_treatment: 'normal',
    transaction_kind: 'standard',
    is_archived: 0,
    total: 10000,
    ...overrides,
  }
}

function resetStore() {
  useSpendingInsightsStore.setState({
    momComparisons: [],
    momCurrentTotal: 0,
    momPreviousTotal: 0,
    yoyComparisons: [],
    yoyCurrentTotal: 0,
    yoyPreviousTotal: 0,
    insights: [],
    isLoading: false,
    complete: true,
    currency: 'USD',
    missingCurrencies: [],
    reason: null,
    error: null,
  })
}

describe('spending-insights-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
    useCurrencyStore.setState({
      preferredCurrency: 'USD',
      rates: { 'EUR:USD': 2 },
      invalidRates: [],
    })
  })

  it('converts mixed available currencies before merging category totals', async () => {
    mockQuery.mockResolvedValue([
      row({ total: 10000, currency: 'USD' }),
      row({ total: 10000, currency: 'EUR' }),
    ])

    await useSpendingInsightsStore.getState().loadComparisons()

    const state = useSpendingInsightsStore.getState()
    expect(state.complete).toBe(true)
    expect(state.currency).toBe('USD')
    expect(state.momCurrentTotal).toBe(30000)
    expect(state.momComparisons[0]).toMatchObject({
      categoryName: 'Food',
      categoryColor: '#f97316',
      current: 30000,
    })
    expect(mockQuery.mock.calls[0]?.[0]).toMatch(/GROUP BY t\.category_id/)
    expect(mockQuery.mock.calls[0]?.[0]).toMatch(/t\.currency/)
  })

  it('withholds comparisons when a required rate is missing', async () => {
    mockQuery.mockResolvedValue([
      row({ total: 10000, currency: 'USD' }),
      row({ total: 8000, currency: 'JPY' }),
    ])

    await useSpendingInsightsStore.getState().loadComparisons()

    const state = useSpendingInsightsStore.getState()
    expect(state.complete).toBe(false)
    expect(state.reason).toBe('missing_exchange_rates')
    expect(state.missingCurrencies).toEqual(['JPY'])
    expect(state.momComparisons).toEqual([])
    expect(state.insights).toEqual([])
    expect(state.momCurrentTotal).toBe(0)
  })

  it('withholds comparisons for malformed split allocations', async () => {
    mockQuery.mockResolvedValue([row({ invalid_allocations: 1 })])
    await useSpendingInsightsStore.getState().loadComparisons()
    expect(useSpendingInsightsStore.getState()).toMatchObject({
      complete: false,
      reason: 'invalid_category_allocations',
      momComparisons: [],
      insights: [],
    })
  })

  it('withholds comparisons for invalid currency data', async () => {
    mockQuery.mockResolvedValue([row({ total: 5000, currency: 'US D' })])

    await useSpendingInsightsStore.getState().loadComparisons()

    const state = useSpendingInsightsStore.getState()
    expect(state.complete).toBe(false)
    expect(state.reason).toBe('invalid_currency_data')
    expect(state.momComparisons).toEqual([])
    expect(state.insights).toEqual([])
  })

  it('includes legacy blank posting status and excludes ineligible rows', async () => {
    mockQuery.mockResolvedValue([
      row({ status: null, total: 20000 }),
      row({ status: ' ', total: 10000 }),
      row({ status: '', total: 5000 }),
      row({ ledger_treatment: 'staged_no_balance_impact', total: 999999 }),
      row({ status: 'pending', total: 901000 }),
      row({ type: 'transfer', total: 902000 }),
      row({ reporting_treatment: 'exclude_from_cashflow', total: 903000 }),
      row({ transaction_kind: 'reconciliation_bridge', total: 904000 }),
      row({ is_archived: 1, total: 905000 }),
      row({ type: 'income', total: 906000 }),
    ])

    await useSpendingInsightsStore.getState().loadComparisons()

    const state = useSpendingInsightsStore.getState()
    expect(state.complete).toBe(true)
    expect(state.momCurrentTotal).toBe(35000)
  })

  it('records a read error without leaving a false complete total', async () => {
    mockQuery.mockRejectedValue(new Error('Read failed'))

    await useSpendingInsightsStore.getState().loadComparisons()

    const state = useSpendingInsightsStore.getState()
    expect(state.complete).toBe(false)
    expect(state.reason).toBe('read_error')
    expect(state.error).toContain('Read failed')
    expect(state.momComparisons).toEqual([])
    expect(state.momCurrentTotal).toBe(0)
  })

  it('rejects stale responses after a newer load starts', async () => {
    let resolveFirst!: (value: unknown) => void
    const firstWave = new Promise((resolve) => {
      resolveFirst = resolve
    })
    let wave = 0
    mockQuery.mockImplementation(async () => {
      const myWave = wave
      if (myWave === 0) await firstWave
      return [
        row({
          total: myWave === 0 ? 999000 : 4000,
          currency: 'USD',
        }),
      ]
    })

    const first = useSpendingInsightsStore.getState().loadComparisons()
    await Promise.resolve()
    wave = 1
    await useSpendingInsightsStore.getState().loadComparisons()
    resolveFirst([])
    await first

    const state = useSpendingInsightsStore.getState()
    expect(state.complete).toBe(true)
    expect(state.momCurrentTotal).toBe(4000)
    expect(state.momComparisons[0]?.current).toBe(4000)
  })

  it('formats new-category insight amounts in the resolved display currency', async () => {
    useCurrencyStore.setState({
      preferredCurrency: 'EUR',
      rates: { 'USD:EUR': 0.5 },
      invalidRates: [],
    })
    mockQuery.mockImplementation(async (_sql, params) => {
      const start = String(params?.[0] ?? '')
      if (start === dayjs().startOf('month').format('YYYY-MM-DD')) {
        return [row({ total: 5000, currency: 'USD' })]
      }
      return []
    })

    await useSpendingInsightsStore.getState().loadComparisons()

    const state = useSpendingInsightsStore.getState()
    expect(state.currency).toBe('EUR')
    expect(state.insights[0]?.message).toContain('€25.00')
  })
})
