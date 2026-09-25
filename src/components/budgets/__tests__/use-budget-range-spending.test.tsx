import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { create } from 'zustand'

vi.mock('@/lib/budget-dated-read', () => ({ readBudgetSpending: vi.fn() }))
vi.mock('@/stores/currency-store', () => {
  const store = create(() => ({
    mainCurrency: 'USD' as string | null,
    preferredCurrency: 'USD',
    manualRates: [] as Array<{ id: string }>,
    loadRates: async () => {},
  }))
  return { useCurrencyStore: store }
})

import { readBudgetSpending, type BudgetSpendingRead } from '@/lib/budget-dated-read'
import { useCurrencyStore } from '@/stores/currency-store'
import { useBudgetRangeSpending } from '../use-budget-range-spending'

const read = vi.mocked(readBudgetSpending)
const categories = [
  { categoryId: 'food', currency: 'EUR' },
  { categoryId: 'food', currency: 'EUR' },
]
const spending = (total: number): BudgetSpendingRead => ({
  complete: true,
  currency: 'USD',
  totalCentavos: total,
  knownTotalCentavos: total,
  nativeTotals: [{ currency: 'EUR', amountCentavos: total }],
  unresolvedIds: [],
  conversions: [],
})
const deferred = () => {
  let resolve!: (result: BudgetSpendingRead) => void
  const promise = new Promise<BudgetSpendingRead>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('budget range request authority', () => {
  beforeEach(() => {
    read.mockReset()
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [],
      loadRates: async () => {},
    })
  })

  it('deduplicates categories and cancels an old range before showing the new label', async () => {
    const old = deferred()
    read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(spending(250))
    const { result, rerender } = renderHook(
      ({ preset }) => useBudgetRangeSpending(categories, preset),
      {
        initialProps: { preset: 'this-month' as 'this-month' | '3-months' },
      }
    )
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    rerender({ preset: '3-months' })
    expect(result.current.loading).toBe(true)
    expect(result.current.rows).toEqual([])
    await waitFor(() => expect(result.current.rows[0]?.spending.totalCentavos).toBe(250))
    await act(async () => old.resolve(spending(999)))
    expect(result.current.rows[0]?.spending.totalCentavos).toBe(250)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('withholds old main/rate results and retains native evidence without a main currency', async () => {
    const old = deferred()
    read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(spending(300))
    const { result } = renderHook(() => useBudgetRangeSpending(categories, 'all-time'))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    const rate = {
      id: 'new-rate',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rateDecimal: '1.2',
      effectiveFrom: '2026-01-01',
      supersedesRateId: null,
      createdAt: '2026-01-01T00:00:00Z',
      sourceNote: null,
    }
    act(() => useCurrencyStore.setState({ mainCurrency: null, manualRates: [rate] }))
    expect(result.current.rows).toEqual([])
    await waitFor(() =>
      expect(result.current.rows[0]?.spending.nativeTotals).toEqual([
        { currency: 'EUR', amountCentavos: 300 },
      ])
    )
    expect(result.current.mainCurrency).toBeNull()
    expect(read.mock.calls[1][0]).toMatchObject({ start: null, currency: 'EUR', rates: [rate] })
    await act(async () => old.resolve(spending(999)))
    expect(result.current.rows[0]?.spending.totalCentavos).toBe(300)
  })

  it('settles failed authority loads and retries', async () => {
    useCurrencyStore.setState({
      loadRates: vi
        .fn()
        .mockRejectedValueOnce(new Error('rates unavailable'))
        .mockResolvedValue(undefined),
    })
    read.mockResolvedValue(spending(100))
    const { result } = renderHook(() => useBudgetRangeSpending(categories, 'this-month'))
    await waitFor(() => expect(result.current.error).toBe('rates unavailable'))
    expect(result.current.loading).toBe(false)
    expect(read).not.toHaveBeenCalled()
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.rows[0]?.spending.totalCentavos).toBe(100))
  })

  it('settles failed reads and retries without leaving the first request pending', async () => {
    read.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(spending(100))
    const { result } = renderHook(() => useBudgetRangeSpending(categories, 'this-year'))
    await waitFor(() => expect(result.current.error).toBe('read failed'))
    expect(result.current.loading).toBe(false)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.rows[0]?.spending.totalCentavos).toBe(100))
  })
})
