import type { AccountMode } from './ledger.js'

export type ReconciliationInput =
  | {
      accountMode: 'transactional'
      observedBalanceCentavos: number
      effectiveLedgerBalanceCentavos: number
    }
  | {
      accountMode: 'snapshot_only'
      observedBalanceCentavos: number
    }

export type ReconciliationAdjustment =
  | {
      status: 'ledger_adjustment'
      accountMode: 'transactional'
      observedBalanceCentavos: number
      effectiveLedgerBalanceCentavos: number
      adjustmentCentavos: number
      bridge: null | {
        type: 'income' | 'expense'
        amountCentavos: number
        reportingTreatment: 'exclude_from_cashflow'
        transactionKind: 'reconciliation_bridge'
      }
    }
  | {
      status: 'observed_balance'
      accountMode: 'snapshot_only'
      observedBalanceCentavos: number
      effectiveLedgerBalanceCentavos: null
      adjustmentCentavos: null
      bridge: null
    }

/** Reconcile a transactional ledger or record a snapshot-only observed balance. */
export function calculateReconciliationAdjustment(
  input: ReconciliationInput
): ReconciliationAdjustment {
  assertAccountMode(input.accountMode)
  assertCentavos(input.observedBalanceCentavos, 'observedBalanceCentavos')

  if (input.accountMode === 'snapshot_only') {
    return {
      status: 'observed_balance',
      accountMode: input.accountMode,
      observedBalanceCentavos: input.observedBalanceCentavos,
      effectiveLedgerBalanceCentavos: null,
      adjustmentCentavos: null,
      bridge: null,
    }
  }

  assertCentavos(input.effectiveLedgerBalanceCentavos, 'effectiveLedgerBalanceCentavos')
  const adjustmentCentavos = input.observedBalanceCentavos - input.effectiveLedgerBalanceCentavos
  if (!Number.isSafeInteger(adjustmentCentavos)) {
    throw new RangeError('reconciliation adjustment exceeds the safe integer range')
  }

  return {
    status: 'ledger_adjustment',
    accountMode: input.accountMode,
    observedBalanceCentavos: input.observedBalanceCentavos,
    effectiveLedgerBalanceCentavos: input.effectiveLedgerBalanceCentavos,
    adjustmentCentavos,
    bridge:
      adjustmentCentavos === 0
        ? null
        : {
            type: adjustmentCentavos > 0 ? 'income' : 'expense',
            amountCentavos: Math.abs(adjustmentCentavos),
            reportingTreatment: 'exclude_from_cashflow',
            transactionKind: 'reconciliation_bridge',
          },
  }
}

function assertAccountMode(value: unknown): asserts value is AccountMode {
  if (value !== 'transactional' && value !== 'snapshot_only') {
    throw new TypeError(`Unsupported account mode: ${String(value)}`)
  }
}

function assertCentavos(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`)
}
