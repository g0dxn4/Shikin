import type * as ScopedReadModule from '@/lib/scoped-report-read'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/scoped-report-read', async (importOriginal) => ({
  ...(await importOriginal<typeof ScopedReadModule>()),
  readScopedSnapshot: vi.fn(),
}))
import { readScopedSnapshot } from '@/lib/scoped-report-read'
import { useBudgetStore } from '../budget-store'
import { deferred, scopedFixture, fixtureWindow } from '@/test/scoped-fixture'
const read = vi.mocked(readScopedSnapshot)
beforeEach(() => {
  read.mockReset()
  useBudgetStore.setState({ budgets: [], options: {}, fetchError: null, isLoading: false })
})
describe('budget captured read ownership', () => {
  it('keeps stored MXN and null incomplete comparisons', async () => {
    const snapshot = scopedFixture()
    snapshot.budgets[0].basis = 'net_consumption'
    read.mockResolvedValue(snapshot)
    await useBudgetStore.getState().fetch(fixtureWindow)
    expect(useBudgetStore.getState().budgets[0]).toMatchObject({
      currency: 'MXN',
      spent: null,
      remaining: null,
      percentUsed: null,
      complete: false,
    })
  })
  it('ignores a stale filter response and inspects inactive by ID', async () => {
    const old = deferred<ReturnType<typeof scopedFixture>>()
    read.mockReturnValueOnce(old.promise)
    const first = useBudgetStore.getState().fetch(fixtureWindow)
    const next = scopedFixture()
    next.budgets[0].is_active = 0
    read.mockResolvedValueOnce(next)
    await useBudgetStore.getState().fetch({ ...fixtureWindow, budgetId: 'budget' })
    expect(useBudgetStore.getState().budgets[0].is_active).toBe(0)
    old.resolve({ ...scopedFixture(), budgets: [] })
    await first
    expect(useBudgetStore.getState().budgets[0].id).toBe('budget')
  })
  it('does not compare a cross-plan range to one limit', async () => {
    read.mockResolvedValue(scopedFixture())
    await useBudgetStore
      .getState()
      .fetch({ ...fixtureWindow, start: '2025-12-01', end: '2026-01-20' })
    expect(useBudgetStore.getState().budgets[0]).toMatchObject({
      spent: 25000,
      remaining: null,
      percentUsed: null,
      comparison: { limitComparable: false },
    })
  })
})
