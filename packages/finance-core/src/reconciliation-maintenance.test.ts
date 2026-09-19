import { describe, expect, it } from 'vitest'
import {
  assertReconciliationPeriodCovered,
  planReconciliationBridgeSupersession,
  planStatementFinalization,
  selectReconciliationCoverage,
  selectStagedReconciliationRows,
  type ReconciliationSelectionRow,
  type SourceCoverageEvidence,
} from './reconciliation.js'

function row(
  id: string,
  amount: number,
  options: Partial<ReconciliationSelectionRow> = {}
): ReconciliationSelectionRow {
  return {
    id,
    date: '2025-01-15',
    type: 'income',
    amount,
    currency: 'USD',
    account_id: 'a',
    transfer_to_account_id: null,
    matched_transaction_id: null,
    status: 'posted',
    ledger_treatment: 'staged_no_balance_impact',
    transaction_kind: 'standard',
    reporting_treatment: 'normal',
    is_archived: 0,
    source_account_id: 'a',
    source_currency: 'USD',
    source_account_mode: 'transactional',
    destination_account_id: null,
    destination_currency: null,
    destination_account_mode: null,
    finalization_id: null,
    reconciliation_id: null,
    import_source: 'Bank',
    staging_batch_id: 'batch',
    ...options,
  }
}

function coverage(
  id: string,
  options: Partial<SourceCoverageEvidence> = {}
): SourceCoverageEvidence {
  return {
    id,
    account_id: 'a',
    source_namespace: 'Bank',
    period_start: '2025-01-01',
    period_end: '2025-01-31',
    status: 'verified',
    zero_rows: 0,
    document_ref: 'statement.pdf',
    source: null,
    note: null,
    ...options,
  }
}

describe('statement-history maintenance policy', () => {
  it('selects exact disjoint/multi-batch rows without promoting pending or reusing finalized membership', () => {
    const rows = [
      row('b', 200, { staging_batch_id: 'second' }),
      row('a', 100),
      row('hold', 300, { status: 'pending' }),
      row('used', 400, { finalization_id: 'observation' }),
    ]
    expect(
      selectStagedReconciliationRows({
        rows,
        accountId: 'a',
        accountCurrency: 'USD',
        accountMode: 'transactional',
        transactionIds: ['b', 'a'],
      }).map((candidate) => candidate.id)
    ).toEqual(['a', 'b'])
    expect(() =>
      selectStagedReconciliationRows({
        rows,
        accountId: 'a',
        accountCurrency: 'USD',
        accountMode: 'transactional',
        transactionIds: ['hold'],
      })
    ).toThrow('posted/cleared')
    expect(() =>
      selectStagedReconciliationRows({
        rows,
        accountId: 'a',
        accountCurrency: 'USD',
        accountMode: 'transactional',
        transactionIds: ['used'],
      })
    ).toThrow('Already-finalized')
  })

  it('requires exact source coverage, rejects gaps/zero rows, and keeps provisional acknowledgment explicit', () => {
    const selected = [row('a', 100)]
    expect(() =>
      selectReconciliationCoverage({
        coverage: [coverage('case', { source_namespace: 'bank' })],
        coverageIds: ['case'],
        accountId: 'a',
        rows: selected,
        boundary: '2025-01-31',
      })
    ).toThrow('coverage')
    expect(() =>
      selectReconciliationCoverage({
        coverage: [coverage('zero', { zero_rows: 1 })],
        coverageIds: ['zero'],
        accountId: 'a',
        rows: selected,
        boundary: '2025-01-31',
      })
    ).toThrow('coverage')
    expect(() =>
      selectReconciliationCoverage({
        coverage: [coverage('provisional', { status: 'provisional' })],
        coverageIds: ['provisional'],
        accountId: 'a',
        rows: selected,
        boundary: '2025-01-31',
      })
    ).toThrow('acknowledgeProvisional')
    const accepted = selectReconciliationCoverage({
      coverage: [coverage('provisional', { status: 'provisional' })],
      coverageIds: ['provisional'],
      accountId: 'a',
      rows: selected,
      boundary: '2025-01-31',
      acknowledgeProvisional: true,
      provisionalProvenance: 'Operator reviewed the missing page',
    })
    expect(accepted).toHaveLength(1)
    expect(() =>
      assertReconciliationPeriodCovered(
        [coverage('sparse', { period_start: '2025-01-15', period_end: '2025-01-15' })],
        selected,
        '2025-01-01',
        '2025-01-31'
      )
    ).toThrow('full declared period')
  })

  it('plans activation plus positive, negative, and zero residuals with safe cents', () => {
    const selected = row('selected', 400)
    const finalized = planStatementFinalization({
      rows: [selected],
      selectedRows: [selected],
      accountId: 'a',
      accountBalance: 0,
      date: '2025-01-31',
      today: '2025-02-01',
      observedBalance: 1_000,
      laterAnchorDates: [],
    })
    expect(finalized).toMatchObject({
      asOfLedgerBefore: 0,
      stagedBalanceEffect: 400,
      adjustment: 600,
      currentBalanceAfter: 1_000,
    })

    for (const [amount, type, residual] of [
      [400, 'income', 600],
      [1_500, 'income', -500],
      [1_000, 'income', 0],
      [300, 'expense', 1_300],
    ] as const) {
      const bridge = row('bridge', 1_000, {
        ledger_treatment: 'normal',
        transaction_kind: 'reconciliation_bridge',
        reporting_treatment: 'exclude_from_cashflow',
        reconciliation_id: 'original',
        date: '2025-01-31',
      })
      const replacement = row('replacement', amount, { type })
      const plan = planReconciliationBridgeSupersession({
        rows: [bridge, replacement],
        selectedRows: [replacement],
        accountId: 'a',
        accountBalance: 1_000,
        original: {
          id: 'original',
          account_id: 'a',
          reconciliation_date: '2025-01-31',
          actual_balance: 1_000,
          adjustment_amount: 1_000,
          adjustment_transaction_id: 'bridge',
        },
        bridge,
        observations: [],
      })
      expect(plan.successorSignedBridge).toBe(residual)
      expect(plan.replacementEffect + plan.successorSignedBridge).toBe(plan.originalSignedBridge)
    }
  })
})
