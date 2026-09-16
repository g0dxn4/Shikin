import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import {
  getOverviewComparisonDateRange,
  prepareAccountComparison,
  reconcileComparisonSelection,
  type ConvertToPreferred,
} from '@/components/dashboard/overview-account-comparison-helpers'

const checking = { id: 'checking', name: 'Nu', currency: 'USD', type: 'checking' }
const card = { id: 'card', name: 'BBVA', currency: 'USD', type: 'credit_card' }
const sameCurrency: ConvertToPreferred = (amount, currency) => ({
  complete: true,
  preferredCurrency: currency,
  amountCentavos: amount,
  missingCurrencies: [],
})

describe('overview account comparison helpers', () => {
  it('creates bounded period dates ending today and leaves all-time unbounded at the start', () => {
    const today = dayjs('2026-04-18')
    expect(getOverviewComparisonDateRange('3m', today)).toEqual({
      startDate: '2026-01-18',
      endDate: '2026-04-18',
    })
    expect(getOverviewComparisonDateRange('1y', today)).toEqual({
      startDate: '2025-04-18',
      endDate: '2026-04-18',
    })
    expect(getOverviewComparisonDateRange('all', today)).toEqual({
      startDate: null,
      endDate: '2026-04-18',
    })
  })

  it('keeps two different active accounts when a selection is removed or duplicated', () => {
    expect(reconcileComparisonSelection(['a', 'b', 'c'], ['missing', 'b'])).toEqual(['a', 'b'])
    expect(reconcileComparisonSelection(['a', 'b'], ['a', 'a'])).toEqual(['a', 'b'])
    expect(reconcileComparisonSelection(['a'], ['a', 'b'])).toEqual(['a', ''])
  })

  it('uses a common date axis without filling gaps and preserves negative card balances', () => {
    const result = prepareAccountComparison(
      [
        { date: '2026-01-01', balance: 100_000 },
        { date: '2026-03-01', balance: 130_000 },
      ],
      [
        { date: '2026-02-01', balance: -20_000 },
        { date: '2026-03-01', balance: -5_000 },
      ],
      checking,
      card,
      'balance',
      sameCurrency
    )

    expect(result.complete).toBe(true)
    expect(result.points).toEqual([
      { date: '2026-01-01', first: 100_000, second: null },
      { date: '2026-02-01', first: null, second: -20_000 },
      { date: '2026-03-01', first: 130_000, second: -5_000 },
    ])
  })

  it('calculates change from each account’s exact first recorded date', () => {
    const result = prepareAccountComparison(
      [
        { date: '2026-01-01', balance: 100_000 },
        { date: '2026-03-01', balance: 130_000 },
      ],
      [
        { date: '2026-02-01', balance: -20_000 },
        { date: '2026-03-01', balance: -5_000 },
      ],
      checking,
      card,
      'change',
      sameCurrency
    )

    expect(result.firstStartDate).toBe('2026-01-01')
    expect(result.secondStartDate).toBe('2026-02-01')
    expect(result.points).toEqual([
      { date: '2026-01-01', first: 0, second: null },
      { date: '2026-02-01', first: null, second: 0 },
      { date: '2026-03-01', first: 30_000, second: 15_000 },
    ])
  })

  it('converts mixed currencies using current rates and withholds every point if a rate is missing', () => {
    const euroAccount = { ...card, currency: 'EUR' }
    let euroRate: number | null = 2
    const convert: ConvertToPreferred = (amount, currency) =>
      currency === 'USD' || euroRate !== null
        ? {
            complete: true,
            preferredCurrency: 'USD',
            amountCentavos: currency === 'EUR' ? amount * euroRate! : amount,
            missingCurrencies: [],
          }
        : {
            complete: false,
            preferredCurrency: 'USD',
            missingCurrencies: ['EUR'],
            reason: 'missing_exchange_rates',
          }

    expect(
      prepareAccountComparison(
        [{ date: '2026-01-01', balance: 100 }],
        [{ date: '2026-01-01', balance: -100 }],
        checking,
        euroAccount,
        'balance',
        convert
      ).points
    ).toEqual([{ date: '2026-01-01', first: 100, second: -200 }])

    euroRate = null
    const unavailable = prepareAccountComparison(
      [{ date: '2026-01-01', balance: 100 }],
      [{ date: '2026-01-01', balance: -100 }],
      checking,
      euroAccount,
      'balance',
      convert
    )
    expect(unavailable.complete).toBe(false)
    expect(unavailable.points).toEqual([])
    expect(unavailable.missingCurrencies).toEqual(['EUR'])
  })
})
