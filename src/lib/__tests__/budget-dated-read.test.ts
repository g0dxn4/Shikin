import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/database', () => ({ query: vi.fn() }))
vi.mock('@/lib/reporting-read', () => ({
  CASH_FLOW_SQL: "t.type IN ('income', 'expense')",
  assertReportingReadComplete: vi.fn(async () => {}),
}))

import { query } from '@/lib/database'
import { assertReportingReadComplete } from '@/lib/reporting-read'
import { readBudgetSpending } from '../budget-dated-read'

const mockQuery = vi.mocked(query)
const rates = [
  {
    id: 'rate-1',
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    rateDecimal: '1.5',
    effectiveFrom: '2024-09-01',
    supersedesRateId: null,
    createdAt: '2024-09-01T00:00:00Z',
    sourceNote: null,
  },
  {
    id: 'rate-2',
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    rateDecimal: '2',
    effectiveFrom: '2024-09-15',
    supersedesRateId: null,
    createdAt: '2024-09-15T00:00:00Z',
    sourceNote: null,
  },
]

describe('budget dated spending read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses an unbounded lower date but validates only through today for all time', async () => {
    mockQuery.mockResolvedValue([])
    await readBudgetSpending({
      categoryId: 'food',
      start: null,
      end: '2026-03-01',
      currency: 'USD',
      rates,
    })
    expect(assertReportingReadComplete).toHaveBeenCalledWith(undefined, '2026-03-01')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND t.type = 'expense' AND t.date <= ?"),
      ['2026-03-01']
    )
  })

  it('converts every parent at its own date before summing', async () => {
    mockQuery.mockResolvedValue([
      {
        transaction_id: 'tx-1',
        amount: 1,
        currency: 'USD',
        date: '2024-09-14',
        category_id: 'food',
        split_id: null,
        split_amount: null,
        split_category_id: null,
      },
      {
        transaction_id: 'tx-2',
        amount: 1,
        currency: 'USD',
        date: '2024-09-14',
        category_id: 'food',
        split_id: null,
        split_amount: null,
        split_category_id: null,
      },
      {
        transaction_id: 'tx-3',
        amount: 100,
        currency: 'USD',
        date: '2024-09-15',
        category_id: 'food',
        split_id: null,
        split_amount: null,
        split_category_id: null,
      },
    ])

    const result = await readBudgetSpending({
      categoryId: 'food',
      start: '2024-09-01',
      end: '2024-09-30',
      currency: 'MXN',
      rates,
    })

    expect(assertReportingReadComplete).toHaveBeenCalledWith('2024-09-01', '2024-09-30')
    expect(result).toMatchObject({ complete: true, totalCentavos: 204 })
    expect(result.conversions.map((conversion) => conversion.rateId)).toEqual([
      'rate-1',
      'rate-1',
      'rate-2',
    ])
  })

  it('converts a split parent once and apportions by stable split ID', async () => {
    mockQuery.mockResolvedValue([
      {
        transaction_id: 'tx-split',
        amount: 2,
        currency: 'USD',
        date: '2024-09-14',
        category_id: null,
        split_id: 'split-b',
        split_amount: 1,
        split_category_id: 'other',
      },
      {
        transaction_id: 'tx-split',
        amount: 2,
        currency: 'USD',
        date: '2024-09-14',
        category_id: null,
        split_id: 'split-a',
        split_amount: 1,
        split_category_id: 'food',
      },
    ])

    const result = await readBudgetSpending({
      categoryId: 'food',
      start: '2024-09-01',
      end: '2024-09-30',
      currency: 'MXN',
      rates,
    })

    expect(result).toMatchObject({
      complete: true,
      totalCentavos: 2,
      nativeTotals: [{ currency: 'USD', amountCentavos: 1 }],
    })
    expect(result.conversions).toHaveLength(1)
    expect(result.conversions[0]).toMatchObject({ amountCentavos: 3 })
  })

  it('keeps split native evidence and a nullable total when one parent lacks dated FX', async () => {
    mockQuery.mockResolvedValue([
      {
        transaction_id: 'missing',
        amount: 200,
        currency: 'EUR',
        date: '2024-09-14',
        category_id: null,
        split_id: 'a',
        split_amount: 50,
        split_category_id: 'food',
      },
      {
        transaction_id: 'missing',
        amount: 200,
        currency: 'EUR',
        date: '2024-09-14',
        category_id: null,
        split_id: 'b',
        split_amount: 150,
        split_category_id: 'other',
      },
      {
        transaction_id: 'known',
        amount: 100,
        currency: 'MXN',
        date: '2024-09-14',
        category_id: 'food',
        split_id: null,
        split_amount: null,
        split_category_id: null,
      },
    ])
    const result = await readBudgetSpending({
      categoryId: 'food',
      start: null,
      end: '2024-09-14',
      currency: 'MXN',
      rates,
    })
    expect(result).toMatchObject({
      complete: false,
      totalCentavos: null,
      knownTotalCentavos: 100,
      unresolvedIds: ['missing'],
      nativeTotals: [
        { currency: 'EUR', amountCentavos: 50 },
        { currency: 'MXN', amountCentavos: 100 },
      ],
    })
  })

  it('returns known and native evidence without claiming a missing direct rate complete', async () => {
    mockQuery.mockResolvedValue([
      {
        transaction_id: 'known',
        amount: 100,
        currency: 'MXN',
        date: '2024-09-14',
        category_id: 'food',
        split_id: null,
        split_amount: null,
        split_category_id: null,
      },
      {
        transaction_id: 'missing',
        amount: 100,
        currency: 'EUR',
        date: '2024-09-14',
        category_id: 'food',
        split_id: null,
        split_amount: null,
        split_category_id: null,
      },
    ])

    const result = await readBudgetSpending({
      categoryId: 'food',
      start: '2024-09-01',
      end: '2024-09-30',
      currency: 'MXN',
      rates,
    })

    expect(result).toMatchObject({
      complete: false,
      totalCentavos: null,
      knownTotalCentavos: 100,
      unresolvedIds: ['missing'],
      nativeTotals: [
        { currency: 'EUR', amountCentavos: 100 },
        { currency: 'MXN', amountCentavos: 100 },
      ],
    })
  })
})
