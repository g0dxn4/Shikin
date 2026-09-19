import { describe, expect, it } from 'vitest'
import {
  assertPaymentLinkCapacity,
  resolvePaymentEvidence,
  type PaymentEvidence,
  type PaymentTransaction,
} from './payments.js'

const accounts = [
  { id: 'bank', type: 'checking', currency: 'USD', account_mode: 'transactional' },
  { id: 'card', type: 'credit_card', currency: 'USD', account_mode: 'transactional' },
]
const row = (patch: Partial<PaymentTransaction> = {}): PaymentTransaction => ({
  id: 'payment',
  account_id: 'bank',
  transfer_to_account_id: 'card',
  type: 'transfer',
  amount: 1000,
  currency: 'USD',
  status: 'posted',
  ledger_treatment: 'normal',
  reporting_treatment: 'normal',
  transaction_kind: 'standard',
  is_archived: 0,
  ...patch,
})
const evidence = (transactions: PaymentTransaction[], patch: Partial<PaymentEvidence> = {}) => ({
  accounts,
  transactions,
  splits: [],
  classifications: [],
  activeLinks: [],
  ...patch,
})

describe('payment evidence policy', () => {
  it('resolves a native transfer and shares the cap between statements', () => {
    const resolved = resolvePaymentEvidence({
      transactionId: 'payment',
      cardAccountId: 'card',
      explicitRepaymentConfirmation: false,
      evidence: evidence([row()]),
    })
    expect(resolved).toMatchObject({
      canonicalTransactionId: 'payment',
      shape: 'canonical_transfer',
      capacity: 1000,
    })
    expect(
      assertPaymentLinkCapacity({
        resolved,
        activeLinks: [
          { id: 'one', transaction_id: 'payment', amount: 400 },
          { id: 'two', transaction_id: 'payment', amount: 300 },
        ],
        additionalAmount: 300,
      })
    ).toEqual({ activeAmount: 700, remainingCapacity: 0 })
    expect(() =>
      assertPaymentLinkCapacity({
        resolved,
        activeLinks: [{ id: 'one', transaction_id: 'payment', amount: 700 }],
        additionalAmount: 301,
      })
    ).toThrow(/exceed/)
  })

  it('canonicalizes a fully validated archived mirror and rejects broken pairs', () => {
    const source = row({
      matched_transaction_id: 'mirror',
      reporting_treatment: 'exclude_from_cashflow',
    })
    const mirror = row({
      id: 'mirror',
      account_id: 'card',
      transfer_to_account_id: null,
      type: 'income',
      matched_transaction_id: 'payment',
      reporting_treatment: 'exclude_from_cashflow',
      transaction_kind: 'archived_transfer_mirror',
      is_archived: 1,
    })
    expect(
      resolvePaymentEvidence({
        transactionId: 'mirror',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: false,
        evidence: evidence([source, mirror]),
      })
    ).toMatchObject({
      requestedTransactionId: 'mirror',
      canonicalTransactionId: 'payment',
      aliasTransactionIds: ['mirror', 'payment'],
    })
    expect(() =>
      resolvePaymentEvidence({
        transactionId: 'mirror',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: false,
        evidence: evidence([source, { ...mirror, amount: 999 }]),
      })
    ).toThrow(/fully validated/)
  })

  it('requires confirmation for ordinary evidence and excludes classified spend', () => {
    const ordinary = row({
      type: 'expense',
      transfer_to_account_id: null,
      amount: 1000,
    })
    const splits = [
      { id: 'principal', transaction_id: 'payment', category_id: null, amount: 600 },
      { id: 'purchase', transaction_id: 'payment', category_id: null, amount: 400 },
    ]
    const classifications = [
      {
        id: 'c1',
        transaction_id: 'payment',
        split_id: 'principal',
        role: 'principal' as const,
        referenced_purchase_id: 'purchase-role',
      },
      {
        id: 'purchase-role',
        transaction_id: 'purchase-row',
        split_id: null,
        role: 'purchase' as const,
        referenced_purchase_id: null,
      },
      {
        id: 'c2',
        transaction_id: 'payment',
        split_id: 'purchase',
        role: 'purchase' as const,
        referenced_purchase_id: null,
      },
    ]
    const purchase = row({
      id: 'purchase-row',
      type: 'expense',
      amount: 1000,
      transfer_to_account_id: null,
    })
    const data = evidence([ordinary, purchase], { splits, classifications })
    expect(() =>
      resolvePaymentEvidence({
        transactionId: 'payment',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: false,
        evidence: data,
      })
    ).toThrow(/confirmation/)
    expect(
      resolvePaymentEvidence({
        transactionId: 'payment',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: true,
        evidence: data,
      }).capacity
    ).toBe(600)
  })

  it.each(['purchase', 'fee', 'cash_withdrawal'] as const)(
    'excludes %s expense allocations from repayment capacity',
    (role) => {
      const ordinary = row({ type: 'expense', transfer_to_account_id: null })
      expect(() =>
        resolvePaymentEvidence({
          transactionId: 'payment',
          cardAccountId: 'card',
          explicitRepaymentConfirmation: true,
          evidence: evidence([ordinary], {
            classifications: [
              {
                id: 'classification',
                transaction_id: 'payment',
                split_id: null,
                role,
                referenced_purchase_id: null,
              },
            ],
          }),
        })
      ).toThrow(/no eligible/)
    }
  )

  it.each([
    { status: 'pending' },
    { ledger_treatment: 'staged_no_balance_impact' },
    { transaction_kind: 'reconciliation_bridge' },
    { currency: 'EUR' },
  ])('rejects ineligible transfer evidence %o', (patch) => {
    expect(() =>
      resolvePaymentEvidence({
        transactionId: 'payment',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: false,
        evidence: evidence([row(patch)]),
      })
    ).toThrow()
  })
})
