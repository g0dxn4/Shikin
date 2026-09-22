import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(async (fn) => {
    const { query, execute } = await import('@/lib/database')
    return fn({ query, execute })
  }),
}))
vi.mock('@/lib/budget-dated-read', () => ({ readBudgetSpending: vi.fn() }))

import { execute, query } from '@/lib/database'
import { readBudgetSpending } from '@/lib/budget-dated-read'
import { useCurrencyStore } from '../currency-store'
import { useBudgetStore } from '../budget-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)
const mockSpending = vi.mocked(readBudgetSpending)
const spending = {
  complete: true,
  currency: 'USD',
  totalCentavos: 30_000,
  knownTotalCentavos: 30_000,
  nativeTotals: [{ currency: 'USD', amountCentavos: 30_000 }],
  unresolvedIds: [],
  conversions: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function form(currency = 'USD') {
  return {
    name: 'Groceries',
    categoryId: 'cat-1',
    amount: 500,
    period: 'monthly' as const,
    currency,
  }
}

describe('budget-store durable denomination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBudgetStore.setState({ budgets: [], isLoading: false, fetchError: null, error: null })
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [],
      loadRates: vi.fn(async () => {}),
    })
    mockSpending.mockResolvedValue(spending)
  })

  it('reads native progress in budget currency and exposes main comparison', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'budget-1',
        name: 'Groceries',
        category_id: 'cat-1',
        amount: 50_000,
        period: 'monthly',
        is_active: 1,
        currency: 'USD',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        category_name: 'Food',
        category_color: '#ff0000',
      },
    ])

    await useBudgetStore.getState().fetch()

    expect(mockSpending).toHaveBeenCalledTimes(2)
    expect(mockSpending).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ categoryId: 'cat-1', currency: 'USD' })
    )
    expect(useBudgetStore.getState().budgets[0]).toMatchObject({
      currency: 'USD',
      spent: 30_000,
      remaining: 20_000,
      percentUsed: 60,
      complete: true,
      mainComparison: {
        complete: true,
        toCurrency: 'USD',
        remainingCentavos: 20_000,
      },
    })
  })

  it('refetches an initial delayed read when main currency becomes unconfigured', async () => {
    const rows = [
      {
        id: 'budget-1',
        name: 'Groceries',
        category_id: 'cat-1',
        amount: 50_000,
        period: 'monthly',
        is_active: 1,
        currency: 'USD',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        category_name: 'Food',
        category_color: '#ff0000',
      },
    ]
    const delayed = deferred<typeof rows>()
    mockQuery.mockReturnValueOnce(delayed.promise).mockResolvedValue(rows)

    const initialFetch = useBudgetStore.getState().fetch()
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
    useCurrencyStore.setState({ mainCurrency: null, preferredCurrency: 'USD' })
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2))
    delayed.resolve(rows)
    await initialFetch
    await vi.waitFor(() =>
      expect(useBudgetStore.getState().budgets[0]?.mainComparison).toMatchObject({
        complete: false,
        toCurrency: null,
        reason: 'main_currency_unconfigured',
        plan: { complete: false, reason: 'main_currency_unconfigured' },
      })
    )
  })

  it('keeps a partial native spending read explicit', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'budget-1',
        name: 'Groceries',
        category_id: 'cat-1',
        amount: 50_000,
        period: 'monthly',
        is_active: 1,
        currency: 'EUR',
        created_at: '',
        updated_at: '',
        category_name: 'Food',
        category_color: null,
      },
    ])
    mockSpending.mockResolvedValue({
      ...spending,
      complete: false,
      currency: 'EUR',
      totalCentavos: null,
      knownTotalCentavos: 10_000,
      unresolvedIds: ['tx-missing'],
    })

    await useBudgetStore.getState().fetch()
    expect(useBudgetStore.getState().budgets[0]).toMatchObject({
      currency: 'EUR',
      spent: 10_000,
      knownSpent: 10_000,
      complete: false,
    })
  })

  it('creates in the configured main currency inside the write transaction', async () => {
    mockQuery.mockResolvedValueOnce([{ value: 'USD' }]).mockResolvedValueOnce([]) // refresh budget list
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })

    await useBudgetStore.getState().add(form())

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO budgets'),
      expect.arrayContaining(['Groceries', 50_000, 'monthly', 'USD'])
    )
  })

  it('writes nothing when main is unset or changed while the draft is open', async () => {
    mockQuery.mockResolvedValueOnce([])
    await expect(useBudgetStore.getState().add(form())).rejects.toThrow('Configure a main currency')
    expect(mockExecute).not.toHaveBeenCalled()

    mockQuery.mockResolvedValueOnce([{ value: 'EUR' }])
    await expect(useBudgetStore.getState().add(form('USD'))).rejects.toThrow(
      'changed while this budget form was open'
    )
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('edits amount and metadata without relabeling durable currency', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockResolvedValueOnce([])

    await useBudgetStore.getState().update('budget-1', form('EUR'))

    const update = mockExecute.mock.calls[0]
    expect(update[0]).toContain(
      'UPDATE budgets SET name = ?, category_id = ?, amount = ?, period = ?'
    )
    expect(update[0]).not.toContain('currency =')
    expect(update[1]).not.toContain('EUR')
  })
})
