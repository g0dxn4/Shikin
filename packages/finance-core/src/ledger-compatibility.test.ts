import { describe, expect, it } from 'vitest'
import {
  calculateLegacyLedgerLegs,
  calculateSignedLedgerDeltas,
  type LedgerEntry,
  type LegacyLedgerInput,
  type LegacyLedgerPolicy,
} from './ledger.js'

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
    ['E2 unknown status', { status: 'bogus' }, excluded('invalid', 'invalid_status')],
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
      excluded('pending', 'pending'),
    ],
    [
      'P5 invalid status before archive',
      { status: 'bogus', isArchived: 1 },
      excluded('invalid', 'invalid_status'),
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

type ExpectedLegs = Array<[string, number]>
const debit: ExpectedLegs = [['a', -1]]
const transfer: ExpectedLegs = [
  ['a', -1],
  ['b', 1],
]
const selfTransfer: ExpectedLegs = [
  ['a', -1],
  ['a', 1],
]
const legacyBase: LegacyLedgerInput = {
  type: 'expense',
  amountCentavos: 1,
  accountId: 'a',
  status: 'posted',
  ledgerTreatment: 'normal',
  isArchived: 0,
}

describe('closed legacy ledger profiles', () => {
  it.each<[string, Record<string, unknown>, ExpectedLegs | 'missing', ExpectedLegs, ExpectedLegs]>([
    ['ordinary', {}, debit, debit, debit],
    ['E1 padded pending', { status: ' Pending ' }, debit, debit, debit],
    ['E1 Unicode pending', { status: '\u00a0PENDING\uFEFF' }, debit, debit, debit],
    ['E2 unknown status', { status: 'bogus' }, debit, debit, debit],
    ['E3 unknown treatment', { ledgerTreatment: 'normal ' }, debit, [], debit],
    ['E4 staged', { ledgerTreatment: 'staged_no_balance_impact' }, [], [], debit],
    ['E5 numeric archive', { isArchived: 1 }, [], [], debit],
    ['E6 boolean archive', { isArchived: true }, debit, debit, debit],
    ['E7 unknown archive', { isArchived: 2 }, debit, debit, debit],
    ['E7 string archive', { isArchived: '1' }, debit, debit, debit],
    [
      'T1 self transfer',
      { type: 'transfer', transferToAccountId: 'a' },
      selfTransfer,
      selfTransfer,
      selfTransfer,
    ],
    ['T2 missing transfer', { type: 'transfer' }, 'missing', debit, []],
    ['T2 empty transfer', { type: 'transfer', transferToAccountId: '' }, 'missing', debit, []],
    ['transfer', { type: 'transfer', transferToAccountId: 'b' }, transfer, transfer, transfer],
    [
      'T4 snapshot source',
      { type: 'transfer', transferToAccountId: 'b', sourceAccountMode: 'snapshot_only' },
      transfer,
      [['b', 1]],
      transfer,
    ],
    [
      'T5 snapshot destination',
      { type: 'transfer', transferToAccountId: 'b', transferAccountMode: 'snapshot_only' },
      transfer,
      debit,
      transfer,
    ],
    [
      'T6 both snapshots',
      {
        type: 'transfer',
        transferToAccountId: 'b',
        sourceAccountMode: 'snapshot_only',
        transferAccountMode: 'snapshot_only',
      },
      transfer,
      [],
      transfer,
    ],
    ['T7 snapshot expense', { sourceAccountMode: 'snapshot_only' }, debit, [], debit],
    ['T8 null mode', { sourceAccountMode: null }, debit, debit, debit],
    ['T9 unknown mode', { sourceAccountMode: 'hybrid' }, debit, [], debit],
    ['V1 negative', { amountCentavos: -1 }, [['a', 1]], [['a', 1]], [['a', 1]]],
    ['V2 fractional', { amountCentavos: 0.5 }, [['a', -0.5]], [['a', -0.5]], [['a', -0.5]]],
    [
      'V2 unsafe',
      { amountCentavos: 9007199254740992 },
      [['a', -9007199254740992]],
      [['a', -9007199254740992]],
      [['a', -9007199254740992]],
    ],
    ['V3 unknown type', { type: 'refund' }, debit, debit, debit],
    ['V6 empty account', { accountId: '' }, [['', -1]], [['', -1]], [['', -1]]],
    [
      'V7 zero legs (summing is adapter-owned)',
      { amountCentavos: 0 },
      [['a', -0]],
      [['a', -0]],
      [['a', -0]],
    ],
    [
      'P2 staged self transfer',
      { ledgerTreatment: 'staged_no_balance_impact', type: 'transfer', transferToAccountId: 'a' },
      [],
      [],
      selfTransfer,
    ],
    ['P3 pending invalid treatment', { status: 'pending', ledgerTreatment: 'bad' }, [], [], []],
    ['P3 pending negative', { status: 'pending', amountCentavos: -1 }, [], [], []],
    ['P4 pending missing transfer', { status: 'pending', type: 'transfer' }, [], [], []],
    ['P5 invalid status and archive', { status: 'bogus', isArchived: 1 }, [], [], debit],
    [
      'null defaults',
      { status: null, ledgerTreatment: null, isArchived: null },
      debit,
      debit,
      debit,
    ],
    ['blank status', { status: '' }, debit, debit, debit],
  ])('%s preserves each profile independently', (_name, patch, cli, frontend, undo) => {
    const cases: Array<[LegacyLedgerPolicy, ExpectedLegs | 'missing']> = [
      ['cli-mutation', cli],
      ['frontend-mutation', frontend],
      ['generic-undo', undo],
    ]
    for (const [policy, expected] of cases) {
      expect(
        calculateLegacyLedgerLegs({ ...legacyBase, ...patch } as LegacyLedgerInput, policy)
      ).toEqual(
        expected === 'missing'
          ? { status: 'missing_transfer_destination', legs: [] }
          : {
              status: 'ready',
              legs: expected.map(([accountId, deltaCentavos]) => ({ accountId, deltaCentavos })),
            }
      )
    }
  })
})
