import { describe, expect, it } from 'vitest'
import type { LedgerTreatment, TransactionKind } from './ledger.js'
import {
  getCashFlowEligibility,
  getCashFlowIntegrityFailure,
  isCashFlowEligible,
  type CashFlowIntegrityRow,
  type ReportingTreatment,
} from './reporting.js'

describe('cash-flow eligibility', () => {
  it('requires posted or cleared income/expense with normal reporting provenance', () => {
    expect(isCashFlowEligible({ type: 'income', status: 'posted' })).toBe(true)
    expect(isCashFlowEligible({ type: 'expense', status: 'cleared' })).toBe(true)
    expect(getCashFlowEligibility({ type: 'expense', status: 'pending' })).toMatchObject({
      eligible: false,
      reason: 'not_posted_or_cleared',
    })
    expect(
      getCashFlowEligibility({
        type: 'income',
        status: 'posted',
        reportingTreatment: 'exclude_from_cashflow',
      })
    ).toMatchObject({ eligible: false, reason: 'excluded_reporting_treatment' })
    expect(isCashFlowEligible({ type: 'transfer', status: 'posted' })).toBe(false)
    expect(isCashFlowEligible({ type: 'income', status: 'posted', isArchived: 2 })).toBe(false)
  })

  it.each([
    [undefined, true],
    [null, true],
    ['normal', true],
    ['staged_no_balance_impact', false],
    ['invalid', false],
  ])('validates ledger treatment %s', (ledgerTreatment, eligible) => {
    expect(
      isCashFlowEligible({
        type: 'expense',
        status: 'posted',
        ledgerTreatment: ledgerTreatment as LedgerTreatment,
      })
    ).toBe(eligible)
  })

  it('normalizes legacy statuses but never admits invalid or staged states', () => {
    for (const status of [undefined, null, '', '  ', ' POSTED ', 'Cleared']) {
      expect(isCashFlowEligible({ type: 'expense', status })).toBe(true)
    }
    for (const status of ['pending', 'void', 'unknown']) {
      expect(isCashFlowEligible({ type: 'expense', status })).toBe(false)
    }
    expect(
      getCashFlowEligibility({ type: 'expense', ledgerTreatment: 'invalid' as LedgerTreatment })
    ).toMatchObject({ reason: 'invalid_ledger_treatment' })
    expect(
      getCashFlowEligibility({
        type: 'expense',
        status: 'cleared',
        ledgerTreatment: 'staged_no_balance_impact',
      })
    ).toMatchObject({ reason: 'staged_no_balance_impact' })
  })

  it('excludes reconciliation provenance regardless of reporting defaults', () => {
    expect(
      getCashFlowEligibility({
        type: 'income',
        status: 'posted',
        transactionKind: 'reconciliation_bridge',
      })
    ).toMatchObject({ eligible: false, reason: 'excluded_transaction_kind' })
    expect(
      getCashFlowEligibility({
        type: 'income',
        status: 'posted',
        transactionKind: 'archived_transfer_mirror',
      })
    ).toMatchObject({ eligible: false, reason: 'archived_provenance' })
  })

  it('rejects malformed runtime transaction, reporting, and kind discriminants', () => {
    expect(getCashFlowEligibility({ type: 'refund', status: 'posted' })).toMatchObject({
      eligible: false,
      reason: 'invalid_transaction_type',
    })
    expect(
      getCashFlowEligibility({
        type: 'income',
        reportingTreatment: 'cash_only' as ReportingTreatment,
      })
    ).toMatchObject({ eligible: false, reason: 'invalid_reporting_treatment' })
    expect(
      getCashFlowEligibility({
        type: 'income',
        transactionKind: 'synthetic' as TransactionKind,
      })
    ).toMatchObject({ eligible: false, reason: 'invalid_transaction_kind' })
    expect(
      getCashFlowEligibility({
        type: 'income',
        isArchived: 'yes' as unknown as boolean,
      })
    ).toMatchObject({ eligible: false, reason: 'invalid_archive_flag' })
  })
})

function integrityRow(
  id: string,
  overrides: Partial<CashFlowIntegrityRow> = {}
): CashFlowIntegrityRow {
  return {
    id,
    type: 'expense',
    amount: 100,
    currency: 'USD',
    split_count: 0,
    split_total: null,
    invalid_splits: 0,
    ...overrides,
  }
}

describe('cash-flow integrity', () => {
  it('accepts empty reads, zero parents, normalized currencies and complete split allocations', () => {
    expect(getCashFlowIntegrityFailure([])).toBeNull()
    expect(
      getCashFlowIntegrityFailure([
        integrityRow('zero', { amount: 0, currency: '\u00a0usd\t' }),
        integrityRow('split', { split_count: 2, split_total: 100 }),
      ])
    ).toBeNull()
  })

  it('accumulates currency and transaction type independently', () => {
    expect(
      getCashFlowIntegrityFailure([
        integrityRow('usd-expense', { amount: Number.MAX_SAFE_INTEGER }),
        integrityRow('usd-income', { type: 'income', amount: Number.MAX_SAFE_INTEGER }),
        integrityRow('eur-expense', { currency: 'EUR', amount: Number.MAX_SAFE_INTEGER }),
      ])
    ).toBeNull()
  })

  it.each([null, '', 'US D', 'US', 'USDD', '123'])('rejects invalid currency %s', (currency) => {
    expect(getCashFlowIntegrityFailure([integrityRow('invalid', { currency })])).toEqual({
      reason: 'invalid_currency_data',
      transactionId: 'invalid',
    })
  })

  it.each([
    { amount: -1 },
    { amount: 1.5 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { split_count: 2, split_total: 99 },
    { split_count: 2, split_total: 100, invalid_splits: 1 },
    { split_count: 1, split_total: null },
  ])('rejects invalid centavos or split evidence %j', (overrides) => {
    expect(getCashFlowIntegrityFailure([integrityRow('invalid', overrides)])).toEqual({
      reason: 'invalid_category_allocations',
      transactionId: 'invalid',
    })
  })

  it('reports the first overflowing row after combining normalized currency keys', () => {
    expect(
      getCashFlowIntegrityFailure([
        integrityRow('first', { amount: Number.MAX_SAFE_INTEGER }),
        integrityRow('overflow', { amount: 1, currency: '\u00a0usd\t' }),
        integrityRow('later', { currency: null }),
      ])
    ).toEqual({ reason: 'unsafe_cashflow_total', transactionId: 'overflow' })
  })

  it('prioritizes currency over allocations, and allocations over the same-row overflow', () => {
    expect(
      getCashFlowIntegrityFailure([
        integrityRow('currency', { currency: null, amount: -1 }),
        integrityRow('later', { amount: -1 }),
      ])
    ).toEqual({ reason: 'invalid_currency_data', transactionId: 'currency' })
    expect(
      getCashFlowIntegrityFailure([
        integrityRow('first', { amount: Number.MAX_SAFE_INTEGER }),
        integrityRow('allocation', { amount: 1, split_count: 1, split_total: 2 }),
        integrityRow('later', { currency: null }),
      ])
    ).toEqual({ reason: 'invalid_category_allocations', transactionId: 'allocation' })
  })
})
