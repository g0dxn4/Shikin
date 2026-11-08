import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'

vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })),
}))

import { useCurrencyStore } from '@/stores/currency-store'
import { currencyAuthorityKey } from '@/stores/currency-authority'
import {
  assertReportingContextCurrent,
  captureReportingContext,
  convertReportingAmount,
  projectGrossRows,
  reportingContextIsCurrent,
} from '../dated-reporting-read'

function rate(id: string): DatedExchangeRate {
  return {
    id,
    fromCurrency: 'MXN',
    toCurrency: 'USD',
    rateDecimal: '0.05',
    effectiveFrom: '2026-01-01',
    supersedesRateId: null,
    createdAt: '2026-01-01T00:00:00Z',
    sourceNote: null,
  }
}

const expense = {
  id: 'expense',
  date: '2026-04-18',
  type: 'expense',
  amount: 10000,
  currency: 'MXN',
}

describe('dated reporting authority', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T12:00:00Z'))
    useCurrencyStore.setState({
      mainCurrency: 'USD',
      preferredCurrency: 'EUR',
      manualRates: [rate('r1')],
    })
  })

  afterEach(() => vi.useRealTimers())

  it('pins equivalent reload currentness independently from exact conversion evidence', () => {
    const context = captureReportingContext()
    useCurrencyStore.setState({ manualRates: [rate('r1')] })

    expect(currencyAuthorityKey(useCurrencyStore.getState())).toBe('USD|r1')
    expect(context.manualRates).not.toBe(useCurrencyStore.getState().manualRates)
    expect(reportingContextIsCurrent(context)).toBe(true)
    expect(() => assertReportingContextCurrent(context)).not.toThrow()
    expect(projectGrossRows([expense], context)).toMatchObject({
      complete: true,
      currency: 'USD',
      totalCentavos: 500,
      parents: [{ convertedAmount: 500, conversion: { rateId: 'r1' } }],
    })
  })

  it.each([
    { change: 'appended correction', mainCurrency: 'USD', ids: ['r1', 'r2', 'r3'] },
    { change: 'reordered history', mainCurrency: 'USD', ids: ['r2', 'r1'] },
    { change: 'main currency', mainCurrency: 'MXN', ids: ['r1', 'r2'] },
    { change: 'lost authority', mainCurrency: null, ids: [] },
  ])('invalidates a captured report after $change', ({ mainCurrency, ids }) => {
    useCurrencyStore.setState({ manualRates: [rate('r1'), rate('r2')] })
    const context = captureReportingContext()
    useCurrencyStore.setState({ mainCurrency, manualRates: ids.map(rate) })

    expect(reportingContextIsCurrent(context)).toBe(false)
    expect(() => assertReportingContextCurrent(context)).toThrow(
      'Currency authority changed; refresh the report.'
    )
  })

  it('keeps the pinned date and ignores setup draft and loading notifications', () => {
    const context = captureReportingContext()
    vi.setSystemTime(new Date('2026-04-19T12:00:00Z'))
    useCurrencyStore.setState({ preferredCurrency: 'MXN', isLoading: true })

    expect(context.today).toBe('2026-04-18')
    expect(reportingContextIsCurrent(context)).toBe(true)
    expect(() => assertReportingContextCurrent(context)).not.toThrow()
    expect(convertReportingAmount(context, 10000, 'MXN')).toMatchObject({
      complete: true,
      amountCentavos: 500,
      rateId: 'r1',
    })
  })

  it('keeps missing main authority incomplete even with a draft and direct rate', () => {
    useCurrencyStore.setState({ mainCurrency: null, preferredCurrency: 'USD' })
    const context = captureReportingContext()

    expect(reportingContextIsCurrent(context)).toBe(true)
    expect(convertReportingAmount(context, 10000, 'MXN')).toBeNull()
    expect(projectGrossRows([expense], context)).toMatchObject({
      complete: false,
      currency: null,
      totalCentavos: null,
      knownTotalCentavos: 0,
      nativeTotals: [{ currency: 'MXN', amountCentavos: 10000 }],
      missingCurrencies: ['MXN'],
      unresolvedIds: ['expense'],
      reason: 'main_currency_unconfigured',
      parents: [{ convertedAmount: null, conversion: null }],
    })
    expect(projectGrossRows([], context)).toMatchObject({
      complete: false,
      totalCentavos: null,
      reason: 'main_currency_unconfigured',
    })
  })
})
