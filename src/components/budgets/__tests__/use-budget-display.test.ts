import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useBudgetDisplay } from '../use-budget-display'
import { useCurrencyStore } from '@/stores/currency-store'
import { query } from '@/lib/database'
import type { BudgetWithStatus } from '@/stores/budget-store'
vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
const budgets = [
  { id: 'budget', name: 'Food', amount: 100000, period: 'monthly' },
] as BudgetWithStatus[]
const expense = { budget_id: 'budget', type: 'expense', amount: 10000, currency: 'USD' }

describe('budget currency-safe display reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCurrencyStore.setState({
      preferredCurrency: 'USD',
      rates: { 'EUR:USD': 2 },
      invalidRates: [],
    })
  })
  it('converts all eligible spending and updates when rates change', async () => {
    vi.mocked(query).mockResolvedValue([
      { ...expense, status: null },
      { ...expense, currency: 'EUR', status: ' ' },
      { ...expense, type: 'transfer', currency: 'XXX' },
      { ...expense, status: 'pending', currency: 'XXX' },
      { ...expense, ledger_treatment: 'staged_no_balance_impact', currency: 'XXX' },
      { ...expense, transaction_kind: 'reconciliation_bridge', currency: 'XXX' },
      { ...expense, reporting_treatment: 'exclude_from_cashflow', currency: 'XXX' },
      { ...expense, is_archived: 1, currency: 'XXX' },
    ])
    const { result } = renderHook(() => useBudgetDisplay(budgets))
    expect(result.current.complete).toBe(false)
    await waitFor(() => expect(result.current.complete).toBe(true))
    expect(result.current.budgets[0]).toMatchObject({
      amount: 100000,
      spent: 30000,
      remaining: 70000,
      percentUsed: 30,
      currency: 'USD',
    })
    act(() => useCurrencyStore.setState({ rates: { 'EUR:USD': 3 } }))
    expect(result.current.budgets[0].spent).toBe(40000)
    expect(vi.mocked(query).mock.calls[0][1]).toHaveLength(6)
  })
  it('never marks a missing-rate partial sum complete', async () => {
    vi.mocked(query).mockResolvedValue([{ ...expense }, { ...expense, currency: 'JPY' }])
    const { result } = renderHook(() => useBudgetDisplay(budgets))
    await waitFor(() => expect(result.current.budgets[0].spent).toBe(10000))
    expect(result.current.complete).toBe(false)
    expect(result.current.budgets[0].complete).toBe(false)
  })
  it('marks malformed split allocations incomplete', async () => {
    vi.mocked(query).mockResolvedValue([{ ...expense, invalid_allocations: 1 }])
    const { result } = renderHook(() => useBudgetDisplay(budgets))
    await waitFor(() => expect(query).toHaveBeenCalled())
    expect(result.current.complete).toBe(false)
    expect(result.current.budgets[0].spent).toBe(0)
  })
  it('converts both the USD plan and spending when preferred currency changes', async () => {
    useCurrencyStore.setState({ preferredCurrency: 'EUR', rates: { 'USD:EUR': 0.5 } })
    vi.mocked(query).mockResolvedValue([expense])
    const { result } = renderHook(() => useBudgetDisplay(budgets))
    await waitFor(() => expect(result.current.complete).toBe(true))
    expect(result.current.budgets[0]).toMatchObject({
      amount: 50000,
      spent: 5000,
      remaining: 45000,
      percentUsed: 10,
      currency: 'EUR',
    })
  })
  it('keeps totals unavailable when the read fails', async () => {
    vi.mocked(query).mockRejectedValue(new Error('Read failed'))
    const { result } = renderHook(() => useBudgetDisplay(budgets))
    await waitFor(() => expect(result.current.error).toContain('Read failed'))
    expect(result.current.complete).toBe(false)
  })
})
