import { describe, expect, it } from 'vitest'
import {
  checkReceivableAccount,
  planReceivableRemoval,
  planReceivableUpdate,
  receivableStatusForAmounts,
  type ReceivablePolicyRow,
} from './receivable-policy.js'

const existing: ReceivablePolicyRow = {
  amount: 100,
  received_amount: 0,
  currency: 'USD',
  account_id: null,
  status: 'open',
  matched_transaction_id: null,
  updated_at: '2020-01-01',
}

describe('receivable maintenance policy', () => {
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid centavos %s before deriving a status',
    (amount) => {
      expect(receivableStatusForAmounts(amount, 0)).toEqual({
        success: false,
        reason: 'invalid_receivable_amount',
        message: 'Receivable amount must be a positive safe integer number of centavos.',
      })
      expect(planReceivableUpdate({ ...existing, amount }, {}, null)).toMatchObject({
        success: false,
        reason: 'invalid_receivable_amount',
      })
    }
  )
  it.each([
    [0, 'open'],
    [50, 'partial'],
    [100, 'received'],
  ])('derives receipt status %s', (received, status) => {
    expect(receivableStatusForAmounts(100, Number(received))).toEqual({ success: true, status })
  })
  it.each(['cancel', 'delete'] as const)(
    'protects all receipt and link evidence from %s',
    (action) => {
      for (const status of ['open', 'partial', 'received', 'cancelled'] as const) {
        for (const evidence of [
          { received_amount: 50 },
          { matched_transaction_id: 't' },
          { matched_transaction_id: '' },
        ]) {
          expect(planReceivableRemoval({ ...existing, status, ...evidence }, action)).toMatchObject(
            { success: false, reason: 'receivable_has_receipts' }
          )
        }
      }
    }
  )
  it('makes only zero/unlinked cancelled rows idempotent', () => {
    const cancelled = { ...existing, status: 'cancelled' as const }
    expect(planReceivableRemoval(cancelled, 'cancel')).toEqual({
      success: true,
      expected: cancelled,
      changed: false,
    })
    expect(planReceivableRemoval(cancelled, 'delete')).toEqual({
      success: true,
      expected: cancelled,
      changed: true,
    })
  })
  it.each([{ amount: 25 }, { currency: 'EUR' }, { accountId: 'other' }])(
    'protects financial fields before account and below-received checks: %j',
    (changes) => {
      expect(planReceivableUpdate({ ...existing, received_amount: 50 }, changes, null)).toEqual({
        success: false,
        reason: 'receivable_has_receipts',
        message: 'Amount, currency, and account cannot change after a receipt is recorded.',
      })
    }
  )
  it.each(['USD', 'usd', ' usd ', '\tUsD\n'])(
    'compares %j canonically without retagging a full form',
    (currency) => {
      const stored = {
        ...existing,
        currency: ' usd ',
        received_amount: 50,
        status: 'partial' as const,
      }
      expect(planReceivableUpdate(stored, { currency }, null)).toEqual({
        success: true,
        expected: stored,
        amount: 100,
        currency: ' usd ',
        accountId: null,
        status: 'partial',
      })
      expect(stored.currency).toBe(' usd ')
    }
  )
  it('preserves omitted currency and cancelled status while accepting an explicit real currency change', () => {
    expect(
      planReceivableUpdate({ ...existing, currency: ' usd ', status: 'cancelled' }, {}, null)
    ).toMatchObject({ success: true, currency: ' usd ', status: 'cancelled' })
    expect(planReceivableUpdate(existing, { currency: ' eur ' }, null)).toMatchObject({
      success: true,
      currency: 'EUR',
      status: 'open',
    })
  })
  it('requires available linked accounts with canonically equal currencies, not a default currency', () => {
    expect(checkReceivableAccount(null, 'USD', null)).toBeNull()
    expect(checkReceivableAccount('bank', ' usd ', { currency: 'USD', is_archived: 0 })).toBeNull()
    for (const account of [null, { currency: 'USD', is_archived: 1 }]) {
      expect(planReceivableUpdate({ ...existing, account_id: 'bank' }, {}, account)).toMatchObject({
        success: false,
        reason: 'account_unavailable',
      })
    }
    expect(checkReceivableAccount('bank', 'USD', { currency: '', is_archived: 0 })).toMatchObject({
      success: false,
      reason: 'receivable_currency_mismatch',
    })
  })
})
