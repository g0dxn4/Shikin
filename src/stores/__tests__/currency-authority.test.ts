import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'

vi.mock('@/lib/database', () => ({ query: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })),
}))

import {
  assertReportingContextCurrent,
  captureReportingContext,
  reportingContextIsCurrent,
} from '@/lib/dated-reporting-read'
import { captureCurrencyAuthority, currencyAuthorityKey } from '../currency-authority'
import { useCurrencyStore } from '../currency-store'

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

describe('currency authority identity boundaries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { mainCurrency: 'USD', manualRates: [rate('r1')], expected: 'USD|r1' },
    { mainCurrency: null, manualRates: [], expected: '|' },
    { mainCurrency: 'USD', manualRates: [], expected: 'USD|' },
    { mainCurrency: 'USD', manualRates: [rate('r1'), rate('r2')], expected: 'USD|r1,r2' },
    { mainCurrency: 'USD', manualRates: [rate('r2'), rate('r1')], expected: 'USD|r2,r1' },
    { mainCurrency: ' USD ', manualRates: [rate(' r1 '), rate('r2')], expected: ' USD | r1 ,r2' },
  ])('preserves exact key bytes $expected', ({ mainCurrency, manualRates, expected }) => {
    expect(currencyAuthorityKey({ mainCurrency, manualRates })).toBe(expected)
  })

  it('captures a copied history and pinned date without treating the setup draft as authority', () => {
    const manualRates = [rate('r1')]
    const authority = captureCurrencyAuthority(
      { mainCurrency: null, preferredCurrency: 'MXN', manualRates },
      '2026-04-18'
    )

    expect(authority).toEqual({
      mainCurrency: null,
      preferredCurrency: 'MXN',
      manualRates: [rate('r1')],
      asOfDate: '2026-04-18',
      key: '|r1',
    })
    expect(authority.manualRates).not.toBe(manualRates)
    expect(authority.manualRates[0]).toBe(manualRates[0])
    expect(
      currencyAuthorityKey({
        mainCurrency: 'USD',
        manualRates: [{ ...rate('r1'), rateDecimal: '0.06' }],
      })
    ).toBe('USD|r1')
  })

  it('shares exact-key currentness with reporting on an equivalent history reload', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T12:00:00Z'))
    const manualRates = [rate('r1')]
    useCurrencyStore.setState({ mainCurrency: 'USD', preferredCurrency: 'MXN', manualRates })
    const context = captureReportingContext()

    expect(context).toEqual({ mainCurrency: 'USD', manualRates: [rate('r1')], today: '2026-04-18' })
    expect(context.manualRates).toBe(manualRates)
    expect(reportingContextIsCurrent(context)).toBe(true)
    expect(() => assertReportingContextCurrent(context)).not.toThrow()

    useCurrencyStore.setState({ preferredCurrency: 'EUR', isLoading: true })
    expect(reportingContextIsCurrent(context)).toBe(true)
    useCurrencyStore.setState({ manualRates: [rate('r1')] })

    expect(currencyAuthorityKey(useCurrencyStore.getState())).toBe('USD|r1')
    expect(
      currencyAuthorityKey({
        mainCurrency: context.mainCurrency,
        manualRates: [...context.manualRates],
      })
    ).toBe('USD|r1')
    expect(reportingContextIsCurrent(context)).toBe(true)
    expect(() => assertReportingContextCurrent(context)).not.toThrow()

    useCurrencyStore.setState({ mainCurrency: 'MXN', manualRates })
    expect(reportingContextIsCurrent(context)).toBe(false)
  })
})
