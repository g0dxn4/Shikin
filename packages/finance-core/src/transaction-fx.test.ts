import { describe, expect, it } from 'vitest'
import {
  assertTransactionFxAcceptanceGuard,
  buildTransactionFxEvidenceSnapshot,
  resolveTransactionFxPreview,
} from './transaction-fx.js'
import type { DatedExchangeRate } from './fx.js'

const rates: DatedExchangeRate[] = [
  {
    id: 'rate-17',
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    rateDecimal: '17',
    effectiveFrom: '2026-09-14',
    supersedesRateId: null,
    createdAt: '2026-09-01T00:00:00Z',
    sourceNote: null,
  },
  {
    id: 'rate-18',
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    rateDecimal: '18',
    effectiveFrom: '2026-09-15',
    supersedesRateId: null,
    createdAt: '2026-09-02T00:00:00Z',
    sourceNote: null,
  },
]

function preview(overrides: Partial<Parameters<typeof resolveTransactionFxPreview>[0]> = {}) {
  return resolveTransactionFxPreview({
    inputAmountCentavos: 10_000,
    inputCurrency: 'USD',
    accountId: 'main',
    accountCurrency: 'MXN',
    mainCurrency: 'MXN',
    transactionDate: '2026-09-14',
    transactionType: 'expense',
    status: 'posted',
    ledgerTreatment: 'normal',
    rates,
    ...overrides,
  })
}

describe('transaction FX acceptance', () => {
  it('resolves dated integer account money and snapshots signed resulting contribution', () => {
    const accepted = preview()
    expect(accepted.accountAmountCentavos).toBe(170_000)
    expect(accepted.accountBalanceDeltaCentavos).toBe(-170_000)
    expect(accepted.acceptanceGuard).toMatchObject({
      accountId: 'main',
      mainCurrency: 'MXN',
      rateId: 'rate-17',
      rateDecimal: '17',
      transactionDate: '2026-09-14',
    })
    expect(
      buildTransactionFxEvidenceSnapshot({
        id: 'evidence',
        transactionId: 'transaction',
        createdAt: '2026-09-14T12:00:00Z',
        preview: accepted,
      })
    ).toMatchObject({
      inputAmountCentavos: 10_000,
      inputCurrency: 'USD',
      accountAmountCentavos: 170_000,
      accountCurrency: 'MXN',
      accountBalanceDeltaCentavos: -170_000,
      rateId: 'rate-17',
    })
  })

  it('uses exact half-away centavo rounding and rejects a rounded-zero positive movement', () => {
    expect(
      preview({ inputAmountCentavos: 1, rates: [{ ...rates[0], rateDecimal: '0.5' }] })
        .accountAmountCentavos
    ).toBe(1)
    expect(() =>
      preview({ inputAmountCentavos: 1, rates: [{ ...rates[0], rateDecimal: '0.49' }] })
    ).toThrow('rounds to zero')
  })

  it('records pending/staged neutrality and supports explicit same-currency replacement evidence', () => {
    expect(preview({ status: 'pending' }).accountBalanceDeltaCentavos).toBe(0)
    expect(
      preview({ ledgerTreatment: 'staged_no_balance_impact' }).accountBalanceDeltaCentavos
    ).toBe(0)
    expect(
      preview({
        inputCurrency: 'MXN',
        accountCurrency: 'MXN',
        inputAmountCentavos: 1234,
      })
    ).toMatchObject({
      accountAmountCentavos: 1234,
      conversion: { rateId: null, rateDecimal: '1', direction: 'MXN->MXN' },
    })
  })

  it('rejects foreign-to-foreign and stale guard identity', () => {
    expect(() => preview({ accountCurrency: 'EUR' })).toThrow('Foreign-to-foreign')
    const accepted = preview()
    expect(() =>
      assertTransactionFxAcceptanceGuard(
        { ...accepted.acceptanceGuard, rateId: 'changed' },
        accepted.acceptanceGuard
      )
    ).toThrow('stale')
    expect(() =>
      assertTransactionFxAcceptanceGuard(accepted.acceptanceGuard, accepted.acceptanceGuard)
    ).not.toThrow()
  })
})
