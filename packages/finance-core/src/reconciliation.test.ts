import { describe, expect, it } from 'vitest'
import type { AccountMode } from './ledger.js'
import { calculateReconciliationAdjustment, type ReconciliationInput } from './reconciliation.js'

describe('reconciliation adjustment', () => {
  it('calculates an exclude-from-cashflow bridge for transactional accounts', () => {
    expect(
      calculateReconciliationAdjustment({
        accountMode: 'transactional',
        effectiveLedgerBalanceCentavos: 90_00,
        observedBalanceCentavos: 100_00,
      })
    ).toEqual({
      status: 'ledger_adjustment',
      accountMode: 'transactional',
      observedBalanceCentavos: 100_00,
      effectiveLedgerBalanceCentavos: 90_00,
      adjustmentCentavos: 10_00,
      bridge: {
        type: 'income',
        amountCentavos: 10_00,
        reportingTreatment: 'exclude_from_cashflow',
        transactionKind: 'reconciliation_bridge',
      },
    })
    expect(
      calculateReconciliationAdjustment({
        accountMode: 'transactional',
        effectiveLedgerBalanceCentavos: 100_00,
        observedBalanceCentavos: 90_00,
      }).bridge
    ).toMatchObject({ type: 'expense', amountCentavos: 10_00 })
    expect(
      calculateReconciliationAdjustment({
        accountMode: 'transactional',
        effectiveLedgerBalanceCentavos: 100_00,
        observedBalanceCentavos: 100_00,
      }).bridge
    ).toBeNull()
  })

  it('records snapshot-only observed balances without a transaction bridge', () => {
    expect(
      calculateReconciliationAdjustment({
        accountMode: 'snapshot_only',
        observedBalanceCentavos: 123_45,
      })
    ).toEqual({
      status: 'observed_balance',
      accountMode: 'snapshot_only',
      observedBalanceCentavos: 123_45,
      effectiveLedgerBalanceCentavos: null,
      adjustmentCentavos: null,
      bridge: null,
    })
  })

  it('does not let an unknown runtime account mode use transactional behavior', () => {
    expect(() =>
      calculateReconciliationAdjustment({
        accountMode: 'hybrid' as AccountMode,
        observedBalanceCentavos: 100,
        effectiveLedgerBalanceCentavos: 90,
      } as ReconciliationInput)
    ).toThrowError(new TypeError('Unsupported account mode: hybrid'))
  })
})
