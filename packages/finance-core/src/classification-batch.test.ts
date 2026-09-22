import { describe, expect, it } from 'vitest'
import {
  classificationCatalog,
  planConsumptionClassificationBatch,
  type ClassificationType,
  type ClassificationTypeRevision,
} from './index.js'
import type { ConsumptionEvidence } from './corrections.js'

const evidence: ConsumptionEvidence = {
  transactions: [
    { id: 'purchase', type: 'expense', amount: 100, currency: 'USD', status: 'posted' },
    { id: 'refund-a', type: 'income', amount: 60, currency: 'USD', status: 'posted' },
    { id: 'refund-b', type: 'income', amount: 40, currency: 'USD', status: 'posted' },
  ],
  splits: [],
  classifications: [
    {
      id: 'p',
      transaction_id: 'purchase',
      split_id: null,
      role: 'purchase',
      referenced_purchase_id: null,
    },
    {
      id: 'a',
      transaction_id: 'refund-a',
      split_id: null,
      role: 'other_income',
      referenced_purchase_id: null,
    },
    {
      id: 'b',
      transaction_id: 'refund-b',
      split_id: null,
      role: 'other_income',
      referenced_purchase_id: null,
    },
  ],
}

const type: ClassificationType = {
  id: 'custom',
  current_revision_id: 'revision',
  archived: 0,
  created_at: 'now',
  updated_at: 'now',
}
const revision: ClassificationTypeRevision = {
  id: 'revision',
  type_id: 'custom',
  version: 1,
  name: 'Returned purchase',
  financial_treatment: 'refund',
  created_at: 'now',
}

describe('classification batch policy', () => {
  it('snapshots native source context so equal amounts in different currencies stay distinguishable', () => {
    const usd = {
      id: 'usd-income',
      type: 'income',
      amount: 100,
      currency: ' usd ',
      category_id: 'salary',
      description: 'USD income',
      date: '2026-03-01',
      account_id: 'usd-account',
      status: 'posted',
    }
    const mxn = {
      id: 'mxn-income',
      type: 'income',
      amount: 100,
      currency: 'mxn',
      category_id: 'gift',
      description: 'MXN income',
      date: '2026-03-02',
      account_id: 'mxn-account',
      status: 'posted',
    }
    const usdSplit = {
      id: 'usd-split',
      transaction_id: usd.id,
      amount: 100,
      category_id: 'salary',
    }
    const plan = planConsumptionClassificationBatch({
      evidence: { transactions: [usd, mxn], splits: [usdSplit], classifications: [] },
      types: [],
      revisions: [],
      targets: [
        { transactionId: usd.id, splitId: usdSplit.id, builtinRole: 'earned_income' },
        { transactionId: mxn.id, builtinRole: 'other_income' },
      ],
    })

    expect(plan.items.map((item) => item.amountCentavos)).toEqual([100, 100])
    expect(plan.items[0]?.source).toEqual({
      transaction: usd,
      split: usdSplit,
      currency: 'USD',
    })
    expect(plan.items[1]?.source).toEqual({ transaction: mxn, split: null, currency: 'MXN' })
  })

  it('includes known source context on invalid plans', () => {
    const transaction = {
      id: 'pending',
      type: 'income',
      amount: 100,
      currency: ' usd ',
      description: 'Pending income',
      date: '2026-03-03',
      status: 'pending',
    }
    const plan = planConsumptionClassificationBatch({
      evidence: { transactions: [transaction], splits: [], classifications: [] },
      types: [],
      revisions: [],
      targets: [{ transactionId: transaction.id, builtinRole: 'earned_income' }],
    })

    expect(plan.applicable).toBe(false)
    expect(plan.items[0]?.source).toEqual({ transaction, split: null, currency: 'USD' })
  })

  it('keeps new preview placeholders distinct from every existing classification ID', () => {
    const collidingId = '__new__:["income",null]'
    const plan = planConsumptionClassificationBatch({
      evidence: {
        transactions: [
          { id: 'purchase', type: 'expense', amount: 100, currency: 'USD', status: 'posted' },
          { id: 'income', type: 'income', amount: 100, currency: 'USD', status: 'posted' },
        ],
        splits: [],
        classifications: [
          {
            id: collidingId,
            transaction_id: 'purchase',
            split_id: null,
            role: 'purchase',
            referenced_purchase_id: null,
          },
        ],
      },
      types: [],
      revisions: [],
      targets: [{ transactionId: 'income', builtinRole: 'earned_income' }],
    })

    expect(plan.applicable).toBe(true)
    expect(plan.items[0]?.after?.id).not.toBe(collidingId)
    expect(new Set(plan.classifications.map((item) => item.id)).size).toBe(
      plan.classifications.length
    )
  })

  it('validates caps against final state independent of target order', () => {
    const targets = [
      {
        transactionId: 'refund-b',
        customTypeId: 'custom',
        expectedRevisionId: 'revision',
        referencedPurchaseId: 'p',
      },
      { transactionId: 'refund-a', builtinRole: 'refund' as const, referencedPurchaseId: 'p' },
    ]
    for (const ordered of [targets, [...targets].reverse()]) {
      const plan = planConsumptionClassificationBatch({
        evidence,
        types: [type],
        revisions: [revision],
        targets: ordered,
      })
      expect(plan.applicable).toBe(true)
      expect(plan.changed).toBe(true)
      expect(plan.items.map((item) => item.resolved?.role).sort()).toEqual(['refund', 'refund'])
    }
  })

  it('rejects duplicate targets, stale custom heads, invented references, and aggregate over-capacity', () => {
    expect(
      planConsumptionClassificationBatch({
        evidence,
        types: [type],
        revisions: [revision],
        targets: [
          { transactionId: 'refund-a', builtinRole: 'refund', referencedPurchaseId: 'p' },
          { transactionId: 'refund-a', builtinRole: 'refund', referencedPurchaseId: 'p' },
        ],
      }).errors
    ).toContain('Duplicate allocation target in batch.')
    expect(
      planConsumptionClassificationBatch({
        evidence,
        types: [type],
        revisions: [revision],
        targets: [
          {
            transactionId: 'refund-a',
            customTypeId: 'custom',
            expectedRevisionId: 'stale',
            referencedPurchaseId: 'p',
          },
        ],
      }).applicable
    ).toBe(false)
    expect(
      planConsumptionClassificationBatch({
        evidence,
        types: [type],
        revisions: [revision],
        targets: [
          { transactionId: 'refund-a', builtinRole: 'refund', referencedPurchaseId: 'invented' },
        ],
      }).errors.join(' ')
    ).toMatch(/existing confirmed purchase/)
    expect(
      planConsumptionClassificationBatch({
        evidence: {
          ...evidence,
          transactions: evidence.transactions.map((row) =>
            row.id === 'refund-b' ? { ...row, amount: 60 } : row
          ),
        },
        types: [type],
        revisions: [revision],
        targets: [
          { transactionId: 'refund-a', builtinRole: 'refund', referencedPurchaseId: 'p' },
          { transactionId: 'refund-b', builtinRole: 'refund', referencedPurchaseId: 'p' },
        ],
      }).errors.join(' ')
    ).toMatch(/exceed purchase capacity/)
  })

  it('discovers fixed effects and preserves custom current names', () => {
    const catalog = classificationCatalog([type], [revision])
    expect(catalog.find((entry) => entry.id === 'other_income')).toMatchObject({
      direction: 'income',
      contribution: { otherIncomeCentavos: 1 },
    })
    expect(catalog.find((entry) => entry.id === 'custom')).toMatchObject({
      name: 'Returned purchase',
      role: 'refund',
      revisionId: 'revision',
    })
  })
})
