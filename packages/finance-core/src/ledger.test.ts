import { describe, expect, it } from 'vitest'
import {
  calculateSignedLedgerDeltas,
  getEffectiveLedgerStatus,
  normalizePostingStatus,
  type LedgerAccountContext,
  type LedgerEntry,
} from './ledger.js'

const checking: LedgerAccountContext = {
  accountId: 'checking',
  currency: 'MXN',
  accountMode: 'transactional',
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    type: 'expense',
    amountCentavos: 500,
    currency: 'MXN',
    account: checking,
    ...overrides,
  }
}

describe('effective ledger semantics', () => {
  it('treats legacy empty status as posted and pending as non-posting', () => {
    expect(normalizePostingStatus(null)).toBe('posted')
    expect(normalizePostingStatus('  ')).toBe('posted')
    expect(getEffectiveLedgerStatus({ status: 'pending' })).toEqual({
      postsToLedger: false,
      postingStatus: 'pending',
      reason: 'pending',
    })
  })

  it('produces signed source and destination deltas for normalized same-currency transfers', () => {
    expect(
      calculateSignedLedgerDeltas(
        entry({
          type: 'transfer',
          amountCentavos: 12_345,
          currency: ' mxn ',
          transferToAccount: {
            accountId: 'savings',
            currency: 'mxn',
            accountMode: 'transactional',
          },
          status: 'cleared',
        })
      )
    ).toMatchObject({
      status: 'applied',
      deltas: [
        { accountId: 'checking', deltaCentavos: -12_345 },
        { accountId: 'savings', deltaCentavos: 12_345 },
      ],
    })
  })

  it.each([
    ['blank', '   ', 'currency must not be empty'],
    ['malformed', 'US-D', 'currency must be a 2-10 character asset or currency code'],
    ['mismatched', 'USD', 'Transaction currency USD does not match source account currency MXN'],
  ])('rejects a %s transaction currency before calculating deltas', (_label, currency, message) => {
    expect(() => calculateSignedLedgerDeltas(entry({ currency }))).toThrowError(
      new TypeError(message)
    )
  })

  it('posts reconciliation bridges but excludes archived transfer mirrors with active flags', () => {
    expect(
      calculateSignedLedgerDeltas(
        entry({ type: 'income', transactionKind: 'reconciliation_bridge' })
      )
    ).toMatchObject({
      status: 'applied',
      deltas: [{ accountId: 'checking', deltaCentavos: 500 }],
    })

    expect(
      calculateSignedLedgerDeltas(
        entry({ type: 'income', transactionKind: 'archived_transfer_mirror', isArchived: false })
      )
    ).toMatchObject({
      status: 'excluded',
      effectiveStatus: { reason: 'archived_provenance' },
      deltas: [],
    })
  })

  it.each([undefined, null, false, 0])('accepts %s as an active archive flag', (isArchived) => {
    expect(calculateSignedLedgerDeltas(entry({ isArchived }))).toMatchObject({ status: 'applied' })
  })

  it.each([true, 1])('accepts %s as an archived flag', (isArchived) => {
    expect(calculateSignedLedgerDeltas(entry({ isArchived }))).toMatchObject({
      status: 'excluded',
      effectiveStatus: { reason: 'archived_provenance' },
    })
  })

  it.each(['yes', '0', 2, -1, Number.NaN, {}])(
    'rejects the malformed runtime archive flag %s',
    (isArchived) => {
      const malformedFlag = isArchived as LedgerEntry['isArchived']
      const expectedError = new TypeError(`Unsupported archive flag: ${String(isArchived)}`)
      expect(() =>
        getEffectiveLedgerStatus({ status: 'pending', isArchived: malformedFlag })
      ).toThrowError(expectedError)
      expect(() => calculateSignedLedgerDeltas(entry({ isArchived: malformedFlag }))).toThrowError(
        expectedError
      )
    }
  )

  it('keeps pending and staged rows outside the effective ledger', () => {
    expect(calculateSignedLedgerDeltas(entry({ status: 'pending' }))).toMatchObject({
      status: 'excluded',
      effectiveStatus: { reason: 'pending' },
    })
    expect(
      calculateSignedLedgerDeltas(
        entry({ status: 'cleared', ledgerTreatment: 'staged_no_balance_impact' })
      )
    ).toMatchObject({ status: 'excluded', effectiveStatus: { reason: 'staged_no_balance_impact' } })
  })

  it('rejects postings involving snapshot-only accounts', () => {
    expect(
      calculateSignedLedgerDeltas(entry({ account: { ...checking, accountMode: 'snapshot_only' } }))
    ).toEqual({ status: 'rejected', reason: 'snapshot_only_account', deltas: [] })
    expect(
      calculateSignedLedgerDeltas(
        entry({
          type: 'transfer',
          transferToAccount: {
            accountId: 'observed',
            currency: 'MXN',
            accountMode: 'snapshot_only',
          },
        })
      )
    ).toEqual({ status: 'rejected', reason: 'snapshot_only_account', deltas: [] })
  })

  it('rejects same-account and cross-currency transfers', () => {
    expect(
      calculateSignedLedgerDeltas(entry({ type: 'transfer', transferToAccount: { ...checking } }))
    ).toEqual({ status: 'rejected', reason: 'same_account_transfer', deltas: [] })
    expect(
      calculateSignedLedgerDeltas(
        entry({
          type: 'transfer',
          transferToAccount: {
            accountId: 'usd-savings',
            currency: 'USD',
            accountMode: 'transactional',
          },
        })
      )
    ).toEqual({ status: 'rejected', reason: 'cross_currency_transfer', deltas: [] })
  })

  it('does not let malformed runtime discriminants fall through to calculations', () => {
    expect(() =>
      calculateSignedLedgerDeltas(entry({ type: 'refund' as LedgerEntry['type'] }))
    ).toThrowError(new TypeError('Unsupported transaction type: refund'))
    expect(() =>
      calculateSignedLedgerDeltas(
        entry({ ledgerTreatment: 'deferred' as LedgerEntry['ledgerTreatment'] })
      )
    ).toThrowError(new TypeError('Unsupported ledger treatment: deferred'))
    expect(() =>
      calculateSignedLedgerDeltas(
        entry({ transactionKind: 'synthetic' as LedgerEntry['transactionKind'] })
      )
    ).toThrowError(new TypeError('Unsupported transaction kind: synthetic'))
    expect(() =>
      calculateSignedLedgerDeltas(
        entry({
          account: {
            ...checking,
            accountMode: 'hybrid' as LedgerAccountContext['accountMode'],
          },
        })
      )
    ).toThrowError(new TypeError('Unsupported account mode: hybrid'))
  })
})
