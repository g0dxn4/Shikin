import { describe, expect, it } from 'vitest'
import type { LedgerTreatment, TransactionKind } from './ledger.js'
import { getCashFlowEligibility, isCashFlowEligible, type ReportingTreatment } from './reporting.js'

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
