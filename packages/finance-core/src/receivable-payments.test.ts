import { describe, expect, it } from 'vitest'
import {
  planReceivablePayment,
  planReceivablePaymentReversal,
  assertReceivablePaymentState,
  type ReceivablePaymentState,
  type ReceivablePaymentLink,
  type ReceivableIncomeEvidence,
} from './receivable-payments'

const receivable: ReceivablePaymentState = {
  id: 'invoice',
  amount: 20000,
  received_amount: 0,
  unattributed_received_amount: 0,
  currency: 'MXN',
  status: 'open',
  account_id: 'bank',
  matched_transaction_id: null,
}
const income: ReceivableIncomeEvidence = {
  id: 'payment',
  account_id: 'bank',
  type: 'income',
  amount: 8000,
  currency: 'MXN',
  status: 'posted',
  ledger_treatment: 'normal',
  transaction_kind: 'standard',
  matched_transaction_id: null,
  is_archived: 0,
  date: '2026-10-17',
  description: 'Installment',
}
const link: ReceivablePaymentLink = {
  id: 'link',
  receivable_id: 'invoice',
  transaction_id: 'payment',
  amount: 8000,
  currency: 'MXN',
  transaction_date: '2026-10-17',
  transaction_snapshot_json: '{}',
  source: 'test',
  note: null,
  created_at: '2026-10-17T00:00:00Z',
  reversed_at: null,
  reversal_source: null,
  reversal_note: null,
}
const partial: ReceivablePaymentState = {
  ...receivable,
  received_amount: 8000,
  status: 'partial',
  matched_transaction_id: 'payment',
}

describe('receivable receipt invariants', () => {
  it('plans an installment and then a final receipt without changing source inputs', () => {
    const before = JSON.stringify({ receivable, income })
    expect(planReceivablePayment({ receivable, income, payments: [] }).after).toMatchObject({
      receivedAmount: 8000,
      remainingAmount: 12000,
      activePaymentCount: 1,
      status: 'partial',
    })
    expect(
      planReceivablePayment({
        receivable: partial,
        income: { ...income, id: 'final', amount: 12000 },
        payments: [link],
      }).after
    ).toMatchObject({
      receivedAmount: 20000,
      remainingAmount: 0,
      activePaymentCount: 2,
      matchedTransactionId: null,
      status: 'received',
    })
    expect(JSON.stringify({ receivable, income })).toBe(before)
  })

  it('treats an active match replay as a no-op and rejects reuse across invoices', () => {
    expect(planReceivablePayment({ receivable: partial, income, payments: [link] })).toMatchObject({
      replayed: true,
    })
    expect(() =>
      planReceivablePayment({
        receivable: { ...receivable, id: 'another' },
        income,
        payments: [link],
      })
    ).toThrow(/another receivable/)
  })

  it.each([
    { amount: 20001 },
    { amount: 0 },
    { amount: 0.5 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'USD' },
    { account_id: 'other' },
    { type: 'expense' },
    { status: 'pending' },
    { ledger_treatment: 'staged_no_balance_impact' },
    { reporting_treatment: 'exclude_from_cashflow' },
    { is_archived: 1 },
    { account_mode: 'snapshot_only' },
    { is_card_payment: 1 },
    { is_non_income_classification: 1 },
  ])('rejects ineligible or excessive source evidence %j', (patch) => {
    expect(() =>
      planReceivablePayment({ receivable, payments: [], income: { ...income, ...patch } })
    ).toThrow()
  })

  it('retains legacy unattributed receipts when reversing a bank link', () => {
    const legacy: ReceivablePaymentState = {
      ...partial,
      unattributed_received_amount: 3000,
      received_amount: 11000,
    }
    const plan = planReceivablePaymentReversal({
      receivable: legacy,
      payments: [link],
      paymentId: 'link',
    })
    expect(plan.after).toMatchObject({
      receivedAmount: 3000,
      linkedAmount: 0,
      status: 'partial',
      matchedTransactionId: null,
    })
  })

  it('requires explicit selection for multiple links and supports idempotent selected reversal', () => {
    const second = { ...link, id: 'link2', transaction_id: 'payment2', amount: 12000 }
    const paid: ReceivablePaymentState = {
      ...receivable,
      received_amount: 20000,
      status: 'received',
    }
    expect(() =>
      planReceivablePaymentReversal({ receivable: paid, payments: [link, second] })
    ).toThrow(/several payments/)
    expect(
      planReceivablePaymentReversal({ receivable: paid, payments: [link, second], all: true }).after
        .receivedAmount
    ).toBe(0)
    const reversed = { ...link, reversed_at: '2026-10-18T00:00:00Z' }
    expect(
      planReceivablePaymentReversal({ receivable, payments: [reversed], paymentId: link.id })
    ).toMatchObject({ replayed: true, paymentIds: [] })
  })

  it('refuses inconsistent totals or a stale single-link compatibility mirror', () => {
    expect(() => assertReceivablePaymentState(receivable, [link])).toThrow(/do not agree/)
    expect(() =>
      assertReceivablePaymentState({ ...partial, matched_transaction_id: null }, [link])
    ).toThrow(/do not agree/)
  })
})
