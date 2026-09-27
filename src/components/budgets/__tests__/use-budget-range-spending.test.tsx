import type * as ScopedReadModule from '@/lib/scoped-report-read'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { projectScopedReport, resolveReportWindow } from '@shikin/finance-core'
vi.mock('@/lib/scoped-report-read', async (original) => ({
  ...(await original<typeof ScopedReadModule>()),
  readScopedReport: vi.fn(),
}))
import { readScopedReport, type ScopedRead } from '@/lib/scoped-report-read'
import { scopedFixture, fixtureWindow, deferred } from '@/test/scoped-fixture'
import { useBudgetRangeSpending } from '../use-budget-range-spending'
import { useCurrencyStore } from '@/stores/currency-store'
const read = vi.mocked(readScopedReport)
const categories = [
  { categoryId: 'food', currency: 'EUR' },
  { categoryId: 'food', currency: 'EUR' },
]
function response(s = scopedFixture()): ScopedRead {
  const window = resolveReportWindow(fixtureWindow)
  return {
    result: projectScopedReport({
      dataset: s.dataset,
      scope: { categoryIds: ['food'] },
      window,
      currency: 'MXN',
      basis: 'gross_cashflow',
    }),
    window,
    accounts: s.accounts,
    categories: s.categories,
    mainCurrency: 'MXN',
  }
}
beforeEach(() => {
  read.mockReset()
  read.mockResolvedValue(response())
  useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'EUR', manualRates: [] })
})
describe('canonical category actuals', () => {
  it('selects unique categories once without a plan currency fallback', async () => {
    const { result } = renderHook(() => useBudgetRangeSpending(categories, 'this-month'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(read.mock.calls[0][0]).toMatchObject({
      basis: 'gross_cashflow',
      groupBy: 'category',
      scope: { categoryIds: ['food'] },
    })
    expect(read.mock.calls[0][0].currency).toBeUndefined()
    expect(result.current).toMatchObject({
      mainCurrency: 'MXN',
      rows: [{ categoryId: 'food', spending: { totalCentavos: 25000 } }],
    })
  })
  it.each(['income', 'expense'] as const)(
    'uses expense completeness when a selected %s lacks FX',
    async (type) => {
      const snapshot = scopedFixture()
      snapshot.dataset.transactions = [
        ...snapshot.dataset.transactions,
        {
          ...snapshot.dataset.transactions[0],
          id: 'missing-fx',
          type,
          amount: 10000,
          currency: 'EUR',
        },
      ]
      read.mockResolvedValue(response(snapshot))
      const { result } = renderHook(() => useBudgetRangeSpending(categories, 'this-month'))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.result?.complete).toBe(false)
      expect(result.current.rows[0].spending).toMatchObject({
        complete: type === 'income',
        totalCentavos: type === 'income' ? 25000 : null,
        knownTotalCentavos: 25000,
        unresolvedIds: type === 'income' ? [] : ['missing-fx'],
      })
    }
  )
  it('withholds old range and currency-authority responses, stops updates after unmount', async () => {
    const old = deferred<ScopedRead>()
    read.mockReturnValueOnce(old.promise)
    const { result, rerender, unmount } = renderHook(
      ({ preset }) => useBudgetRangeSpending(categories, preset),
      { initialProps: { preset: 'this-month' as 'this-month' | 'all-time' } }
    )
    rerender({ preset: 'all-time' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => old.resolve({ ...response(), mainCurrency: 'EUR' }))
    expect(result.current.mainCurrency).toBe('MXN')
    const pending = deferred<ScopedRead>()
    read.mockReturnValueOnce(pending.promise)
    act(() => useCurrencyStore.setState({ mainCurrency: 'MXN' }))
    expect(result.current.loading).toBe(true)
    unmount()
    await act(async () => pending.resolve(response()))
  })
})
