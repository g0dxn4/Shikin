import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(async (fn) => {
    const { query, execute } = await import('@/lib/database')
    return fn({ query, execute })
  }),
}))
vi.mock('@/lib/ulid', () => ({ generateId: vi.fn(() => 'goal-test-id') }))

import { execute, query } from '@/lib/database'
import { useCurrencyStore } from '../currency-store'
import { useGoalStore } from '../goal-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

function form(currency = 'USD') {
  return {
    name: 'Emergency Fund',
    targetAmount: 1000,
    currentAmount: 250,
    deadline: '2026-12-31',
    accountId: 'account-1',
    icon: 'shield',
    color: '#ef4444',
    notes: 'For emergencies',
    currency,
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'goal-1',
    name: 'Vacation Fund',
    target_amount: 200_000,
    current_amount: 100_000,
    deadline: '2027-06-01',
    account_id: 'account-1',
    icon: 'plane',
    color: '#3b82f6',
    notes: null,
    currency: 'USD',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    account_name: 'Savings',
    ...overrides,
  }
}

describe('goal-store durable denomination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGoalStore.setState({ goals: [], isLoading: false, fetchError: null, error: null })
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'USD',
      manualRates: [],
      loadRates: vi.fn(async () => {}),
    })
  })

  it('loads native progress and current main conversion without account writes', async () => {
    mockQuery.mockResolvedValueOnce([row()])
    await useGoalStore.getState().fetch()

    expect(useGoalStore.getState().goals[0]).toMatchObject({
      currency: 'USD',
      accountName: 'Savings',
      progress: 50,
      mainConversion: {
        complete: true,
        toCurrency: 'USD',
        target: { amountCentavos: 200_000 },
        saved: { amountCentavos: 100_000 },
      },
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('creates in configured main inside the write transaction', async () => {
    mockQuery.mockResolvedValueOnce([{ value: 'USD' }]).mockResolvedValueOnce([])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })

    await useGoalStore.getState().add(form())

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO goals'),
      expect.arrayContaining([
        'goal-test-id',
        'Emergency Fund',
        100_000,
        25_000,
        'account-1',
        'USD',
      ])
    )
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE accounts'))).toBe(
      false
    )
  })

  it('writes nothing when main is unset or changes while a draft is open', async () => {
    mockQuery.mockResolvedValueOnce([])
    await expect(useGoalStore.getState().add(form())).rejects.toThrow('Configure a main currency')
    expect(mockExecute).not.toHaveBeenCalled()

    mockQuery.mockResolvedValueOnce([{ value: 'EUR' }])
    await expect(useGoalStore.getState().add(form('USD'))).rejects.toThrow(
      'changed while this goal form was open'
    )
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('edits recorded goal-currency values without relabeling or moving bank money', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })
    mockQuery.mockResolvedValueOnce([])

    await useGoalStore.getState().update('goal-1', form('EUR'))

    const update = mockExecute.mock.calls[0]
    expect(update[0]).toContain('UPDATE goals SET name = ?, target_amount = ?, current_amount = ?')
    expect(update[0]).not.toContain('currency =')
    expect(update[1]).not.toContain('EUR')
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE accounts'))).toBe(
      false
    )
  })

  it('keeps mixed native goal values separate when main conversion is missing', async () => {
    useCurrencyStore.setState({ mainCurrency: 'MXN', preferredCurrency: 'MXN', manualRates: [] })
    mockQuery.mockResolvedValueOnce([
      row({ currency: 'USD' }),
      row({ id: 'goal-2', currency: 'EUR' }),
    ])

    await useGoalStore.getState().fetch()

    expect(useGoalStore.getState().goals.every((goal) => !goal.mainConversion.complete)).toBe(true)
    expect(useGoalStore.getState().goals.map((goal) => goal.currency)).toEqual(['USD', 'EUR'])
  })
})
