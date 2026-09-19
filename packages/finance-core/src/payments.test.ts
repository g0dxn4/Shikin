import { describe, expect, it } from 'vitest'
import {
  assertPaymentLinkCapacity,
  planStatementPaymentLink,
  planStatementPaymentUnlink,
  planStatementTotalsEdit,
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

  it('accepts report-excluded ordinary repayment evidence and keeps known classifications effective', () => {
    const excludedBankPayment = row({
      type: 'expense',
      transfer_to_account_id: null,
      reporting_treatment: 'exclude_from_cashflow',
    })
    expect(
      resolvePaymentEvidence({
        transactionId: 'payment',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: true,
        evidence: evidence([excludedBankPayment]),
      })
    ).toMatchObject({ shape: 'ordinary_bank_expense', capacity: 1000 })

    expect(() =>
      resolvePaymentEvidence({
        transactionId: 'payment',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: true,
        evidence: evidence([excludedBankPayment], {
          classifications: [
            {
              id: 'known-purchase',
              transaction_id: 'payment',
              split_id: null,
              role: 'purchase',
              referenced_purchase_id: null,
            },
          ],
        }),
      })
    ).toThrow(/no eligible/)

    const excludedCardIncome = row({
      account_id: 'card',
      type: 'income',
      transfer_to_account_id: null,
      reporting_treatment: 'exclude_from_cashflow',
    })
    expect(
      resolvePaymentEvidence({
        transactionId: 'payment',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: true,
        evidence: evidence([excludedCardIncome]),
      })
    ).toMatchObject({ shape: 'ordinary_card_income', capacity: 1000 })
  })

  it('rejects unknown reporting treatments rather than treating them as unclassified evidence', () => {
    expect(() =>
      resolvePaymentEvidence({
        transactionId: 'payment',
        cardAccountId: 'card',
        explicitRepaymentConfirmation: true,
        evidence: evidence([
          row({
            type: 'expense',
            transfer_to_account_id: null,
            reporting_treatment: 'mystery',
          }),
        ]),
      })
    ).toThrow(/unknown reporting treatment/)
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

  it('plans link, unlink and explicit totals with equation and legacy-overpaid safeguards', () => {
    const statement = {
      statementBalance: 1000,
      paidAmount: 600,
      unattributedPaidAmount: 600,
      dueDate: '2026-03-15',
      status: 'partial' as const,
    }
    const linked = planStatementPaymentLink({
      statement,
      activeLinkedAmount: 0,
      amount: 400,
      mode: 'attribute_existing',
      today: '2026-03-01',
    })
    expect(linked.after).toMatchObject({ paidAmount: 600, unattributedPaidAmount: 200 })
    expect(
      planStatementPaymentUnlink({
        statement: linked.after,
        activeLinkedAmount: 400,
        amount: 400,
        mode: 'attribute_existing',
        today: '2026-03-01',
      }).after
    ).toEqual(statement)
    expect(() =>
      planStatementTotalsEdit({
        statement,
        activeLinkedAmount: 0,
        statementBalance: 500,
        today: '2026-03-01',
      })
    ).toThrow(/overpayment/)
    const legacy = { ...statement, paidAmount: 1200, unattributedPaidAmount: 1200 }
    expect(
      planStatementTotalsEdit({
        statement: legacy,
        activeLinkedAmount: 0,
        today: '2026-03-01',
      }).legacyOverpaidAfter
    ).toBe(true)
    expect(() =>
      planStatementTotalsEdit({
        statement: legacy,
        activeLinkedAmount: 0,
        paidAmount: 1300,
        today: '2026-03-01',
      })
    ).toThrow(/overpayment/)
  })

  it.each([
    { status: 'pending' },
    { ledger_treatment: 'staged_no_balance_impact' },
    { transaction_kind: 'reconciliation_bridge' },
    { reporting_treatment: 'mystery' },
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
