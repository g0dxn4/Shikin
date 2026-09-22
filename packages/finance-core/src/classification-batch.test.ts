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
