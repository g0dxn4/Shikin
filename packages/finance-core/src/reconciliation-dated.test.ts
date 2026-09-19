import { describe, expect, it } from 'vitest'
import {
  accountValuationDeclaration,
  planDatedReconciliation,
  projectDatedLedger,
  type DatedLedgerRow,
} from './reconciliation.js'
const row = (overrides: Partial<DatedLedgerRow> = {}): DatedLedgerRow => ({
  id: 'source',
  date: '2025-01-30',
  type: 'transfer',
  amount: 1000,
  currency: 'USD',
  account_id: 'a',
  transfer_to_account_id: 'b',
  matched_transaction_id: 'mirror',
  status: 'posted',
  ledger_treatment: 'normal',
  transaction_kind: 'standard',
  reporting_treatment: 'exclude_from_cashflow',
  is_archived: 0,
  source_account_id: 'a',
  source_currency: 'USD',
  source_account_mode: 'transactional',
  destination_account_id: 'b',
  destination_currency: 'USD',
  destination_account_mode: 'transactional',
  ...overrides,
})
const mirror = (overrides: Partial<DatedLedgerRow> = {}) =>
  row({
    id: 'mirror',
    date: '2025-02-02',
    type: 'income',
    account_id: 'b',
    source_account_id: 'b',
    transfer_to_account_id: null,
    destination_account_id: null,
    destination_currency: null,
    destination_account_mode: null,
    matched_transaction_id: 'source',
    is_archived: 1,
    transaction_kind: 'archived_transfer_mirror',
    ...overrides,
  })
describe('pure dated account projection', () => {
  it('keeps source debit and mirror credit on their original dates, regardless of row order', () => {
    const rows = [mirror(), row()]
    expect(projectDatedLedger(rows, 'a', '2025-01-30')).toBe(-1000)
    expect(projectDatedLedger(rows, 'b', '2025-01-31')).toBe(0)
    expect(projectDatedLedger(rows, 'b', '2025-02-02')).toBe(1000)
    expect(projectDatedLedger(rows, 'b')).toBe(1000)
  })
  it.each<Partial<DatedLedgerRow>>([
    { matched_transaction_id: null },
    { amount: 900 },
    { amount: 0 },
    { currency: 'EUR' },
    { source_currency: 'EUR' },
    { type: 'expense' },
    { is_archived: 0 },
    { transaction_kind: 'standard' },
    { ledger_treatment: 'staged_no_balance_impact' },
    { status: 'pending' },
    { status: null },
    { reporting_treatment: 'normal' },
    { account_id: 'a' },
    { transfer_to_account_id: 'a' },
    { date: '2025-02-30' },
  ])('rejects corrupted mirror evidence %j rather than guessing', (change) => {
    expect(() => projectDatedLedger([row(), mirror(change)], 'b', '2025-01-01')).toThrow()
  })
  it.each<Partial<DatedLedgerRow>>([
    { matched_transaction_id: null },
    { type: 'expense' },
    { is_archived: 1 },
    { transaction_kind: 'reconciliation_bridge' },
    { status: 'pending' },
    { destination_currency: 'EUR' },
    { source_account_mode: 'snapshot_only' },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects corrupted canonical evidence %j', (change) => {
    expect(() => projectDatedLedger([row(change), mirror()], 'a')).toThrow()
  })
  it('rejects missing and duplicate evidence; unmatched transfers use one date', () => {
    expect(() => projectDatedLedger([row()], 'a')).toThrow()
    expect(() => projectDatedLedger([row(), mirror(), mirror()], 'a')).toThrow('Duplicate')
    expect(projectDatedLedger([row({ matched_transaction_id: null })], 'b', '2025-01-30')).toBe(
      1000
    )
  })
  it('detects sum/delta overflow, future observations, and later-anchor changes', () => {
    const ordinary = row({
      type: 'income',
      matched_transaction_id: null,
      transfer_to_account_id: null,
      amount: Number.MAX_SAFE_INTEGER,
    })
    expect(() =>
      projectDatedLedger([ordinary, { ...ordinary, id: 'second', amount: 1 }], 'a')
    ).toThrow('safe integer')
    const input = {
      rows: [ordinary],
      accountId: 'a',
      date: '2025-01-31',
      today: '2025-02-01',
      observedBalance: -1,
      storedBalance: 0,
      laterAnchorDates: [],
    }
    expect(() => planDatedReconciliation(input)).toThrow('safe integer')
    expect(() =>
      planDatedReconciliation({ ...input, observedBalance: 0, date: '2025-02-02' })
    ).toThrow('future')
    expect(() =>
      planDatedReconciliation({ ...input, observedBalance: 0, laterAnchorDates: ['2025-02-01'] })
    ).toThrow('later anchor')
    expect(
      planDatedReconciliation({
        ...input,
        storedBalance: Number.MAX_SAFE_INTEGER,
        observedBalance: Number.MAX_SAFE_INTEGER,
        laterAnchorDates: ['2025-02-01'],
      }).adjustment
    ).toBe(0)
  })
  it('prioritizes explicit ownership, preserving unresolved legacy and snapshot fallback', () => {
    expect(accountValuationDeclaration({ type: 'investment', accountMode: 'transactional' })).toBe(
      'unresolved'
    )
    expect(accountValuationDeclaration({ type: 'crypto', accountMode: 'snapshot_only' })).toBe(
      'portfolio_snapshot'
    )
    expect(
      accountValuationDeclaration({
        type: 'crypto',
        accountMode: 'snapshot_only',
        valuationMode: 'cash_plus_holdings',
      })
    ).toBe('cash_plus_holdings')
    expect(() =>
      accountValuationDeclaration({ type: 'crypto', accountMode: 'snapshot_only', creating: true })
    ).toThrow('explicit')
  })
})
