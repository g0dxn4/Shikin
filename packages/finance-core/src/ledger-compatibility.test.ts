import { describe, expect, it } from 'vitest'
import { calculateSignedLedgerDeltas, type LedgerEntry } from './ledger.js'

// Literal parent witnesses: these deliberately preserve differences from the adapters.
const account = { accountId: 'a', currency: 'USD', accountMode: 'transactional' as const }
const base: LedgerEntry = { type: 'expense', amountCentavos: 1, currency: 'USD', account }
const destination = { ...account, accountId: 'b' }
const excluded = (postingStatus: string, reason: string) => ({
  status: 'excluded',
  effectiveStatus: { postsToLedger: false, postingStatus, reason },
  deltas: [],
})
const rejected = (reason: string) => ({ status: 'rejected', reason, deltas: [] })
const applied = (deltaCentavos: number) => ({
  status: 'applied',
  effectiveStatus: { postsToLedger: true, postingStatus: 'posted', reason: 'effective' },
  deltas: [{ accountId: 'a', deltaCentavos }],
})
const unresolved = {
  status: 'unresolved',
  reason: 'missing_transfer_destination',
  effectiveStatus: { postsToLedger: true, postingStatus: 'posted', reason: 'effective' },
  deltas: [],
}

describe('strict ledger parent compatibility', () => {
  it.each<[string, Record<string, unknown>, unknown]>([
    ['E1 padded pending', { status: ' Pending ' }, excluded('pending', 'pending')],
    ['E1 Unicode pending', { status: '\u00a0PENDING\uFEFF' }, excluded('pending', 'pending')],
    ['E2 unknown status', { status: 'bogus' }, rejected('invalid_status')],
    [
      'E4 staged',
      { ledgerTreatment: 'staged_no_balance_impact' },
      excluded('posted', 'staged_no_balance_impact'),
    ],
    ['E5 numeric archive', { isArchived: 1 }, excluded('posted', 'archived_provenance')],
    ['E6 boolean archive', { isArchived: true }, excluded('posted', 'archived_provenance')],
    [
      'E8 mirror',
      { transactionKind: 'archived_transfer_mirror' },
      excluded('posted', 'archived_provenance'),
    ],
    [
      'T1 self transfer',
      { type: 'transfer', transferToAccount: account },
      rejected('same_account_transfer'),
    ],
    ['T2 missing destination', { type: 'transfer' }, unresolved],
    [
      'T3 cross currency',
      { type: 'transfer', transferToAccount: { ...destination, currency: 'EUR' } },
      rejected('cross_currency_transfer'),
    ],
    [
      'T4 snapshot source',
      {
        type: 'transfer',
        account: { ...account, accountMode: 'snapshot_only' },
        transferToAccount: destination,
      },
      rejected('snapshot_only_account'),
    ],
    [
      'T5 snapshot destination',
      { type: 'transfer', transferToAccount: { ...destination, accountMode: 'snapshot_only' } },
      rejected('snapshot_only_account'),
    ],
    [
      'T6 both snapshots',
      {
        type: 'transfer',
        account: { ...account, accountMode: 'snapshot_only' },
        transferToAccount: { ...destination, accountMode: 'snapshot_only' },
      },
      rejected('snapshot_only_account'),
    ],
    [
      'T7 snapshot expense',
      { account: { ...account, accountMode: 'snapshot_only' } },
      rejected('snapshot_only_account'),
    ],
    ['V7 signed zero', { amountCentavos: 0 }, applied(-0)],
    [
      'P1 pending cross currency',
      {
        status: 'pending',
        type: 'transfer',
        transferToAccount: { ...destination, currency: 'EUR' },
      },
      rejected('cross_currency_transfer'),
    ],
    [
      'P2 staged self transfer',
      { ledgerTreatment: 'staged_no_balance_impact', type: 'transfer', transferToAccount: account },
      rejected('same_account_transfer'),
    ],
    [
      'P4 pending missing destination',
      { status: 'pending', type: 'transfer' },
      {
        ...unresolved,
        effectiveStatus: { postsToLedger: false, postingStatus: 'pending', reason: 'pending' },
      },
    ],
    [
      'P5 invalid status before archive',
      { status: 'bogus', isArchived: 1 },
      rejected('invalid_status'),
    ],
    [
      'null defaults',
      { status: null, ledgerTreatment: null, transactionKind: null, isArchived: null },
      applied(-1),
    ],
    ['blank status', { status: '  ' }, applied(-1)],
    ['bridge', { transactionKind: 'reconciliation_bridge' }, applied(-1)],
  ])('%s', (_name, patch, expected) => {
    expect(calculateSignedLedgerDeltas({ ...base, ...patch } as LedgerEntry)).toEqual(expected)
  })

  it.each<[string, Record<string, unknown>, Error]>([
    [
      'E3 treatment',
      { ledgerTreatment: 'normal ' },
      new TypeError('Unsupported ledger treatment: normal '),
    ],
    ['E7 archive', { isArchived: 2 }, new TypeError('Unsupported archive flag: 2')],
    ['E9 kind', { transactionKind: 'bad' }, new TypeError('Unsupported transaction kind: bad')],
    [
      'T8 null mode',
      { account: { ...account, accountMode: null } },
      new TypeError('Unsupported account mode: null'),
    ],
    [
      'T8 absent mode',
      { account: { ...account, accountMode: undefined } },
      new TypeError('Unsupported account mode: undefined'),
    ],
    [
      'T9 unknown mode',
      { account: { ...account, accountMode: 'hybrid' } },
      new TypeError('Unsupported account mode: hybrid'),
    ],
    [
      'V1 negative',
      { amountCentavos: -1 },
      new RangeError('amountCentavos must be a non-negative safe integer'),
    ],
    [
      'V2 fractional',
      { amountCentavos: 0.5 },
      new RangeError('amountCentavos must be a non-negative safe integer'),
    ],
    [
      'V2 unsafe',
      { amountCentavos: 9007199254740992 },
      new RangeError('amountCentavos must be a non-negative safe integer'),
    ],
    ['V3 type', { type: 'refund' }, new TypeError('Unsupported transaction type: refund')],
    [
      'V4 currency mismatch',
      { currency: 'EUR' },
      new TypeError('Transaction currency EUR does not match source account currency USD'),
    ],
    [
      'V5 malformed currency',
      { currency: 'US-D' },
      new TypeError('currency must be a 2-10 character asset or currency code'),
    ],
    ['V5 blank currency', { currency: '' }, new TypeError('currency must not be empty')],
    [
      'V6 empty account',
      { account: { ...account, accountId: '' } },
      new TypeError('account.accountId must not be empty'),
    ],
    [
      'P3 pending invalid treatment',
      { status: 'pending', ledgerTreatment: 'bad' },
      new TypeError('Unsupported ledger treatment: bad'),
    ],
    [
      'P3 pending negative',
      { status: 'pending', amountCentavos: -1 },
      new RangeError('amountCentavos must be a non-negative safe integer'),
    ],
  ])('%s', (_name, patch, expected) => {
    expect(() => calculateSignedLedgerDeltas({ ...base, ...patch } as LedgerEntry)).toThrowError(
      expected
    )
  })
})

// M4's archived profile matrix is recorded in .unknot/round3/ledger.md.
// The transitional interface is retired: every consumer now uses this strict policy.
describe('strict ledger format and validation boundary', () => {
  it.each([' Pending ', '\u00a0PENDING\uFEFF', 'pending', 'PENDING'])(
    'keeps recognized pending %j neutral',
    (status) => {
      expect(calculateSignedLedgerDeltas({ ...base, status })).toEqual(
        excluded('pending', 'pending')
      )
    }
  )
  it.each(['', ' ', null, undefined, ' POSTED ', 'Posted'])(
    'retains posted grammar %j',
    (status) => {
      expect(calculateSignedLedgerDeltas({ ...base, status })).toEqual(applied(-1))
    }
  )
  it.each(['normal ', 'NORMAL', '', 'bad'])(
    'refuses unknown treatment %j even while pending',
    (ledgerTreatment) => {
      expect(() =>
        calculateSignedLedgerDeltas({ ...base, status: 'pending', ledgerTreatment } as LedgerEntry)
      ).toThrow(`Unsupported ledger treatment: ${ledgerTreatment}`)
    }
  )
  it.each([2, '1', 'true', 'false'])(
    'refuses unknown archive %j even while staged',
    (isArchived) => {
      expect(() =>
        calculateSignedLedgerDeltas({
          ...base,
          ledgerTreatment: 'staged_no_balance_impact',
          isArchived,
        } as LedgerEntry)
      ).toThrow(`Unsupported archive flag: ${isArchived}`)
    }
  )
  it.each([-1, 0.5, 9007199254740992, NaN, Infinity])(
    'refuses unsafe pending amount %j',
    (amountCentavos) => {
      expect(() =>
        calculateSignedLedgerDeltas({ ...base, status: 'pending', amountCentavos })
      ).toThrow('amountCentavos must be a non-negative safe integer')
    }
  )
  it.each(['USD', ' usd ', '\u00a0usd\uFEFF'])(
    'compares currency %j without rewriting evidence',
    (currency) => {
      const input = {
        ...base,
        currency,
        type: 'transfer' as const,
        transferToAccount: { ...destination, currency },
      }
      expect(calculateSignedLedgerDeltas(input)).toMatchObject({
        status: 'applied',
        deltas: [
          { accountId: 'a', deltaCentavos: -1 },
          { accountId: 'b', deltaCentavos: 1 },
        ],
      })
      expect(input.currency).toBe(currency)
    }
  )
})
