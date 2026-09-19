import { describe, expect, it } from 'vitest'
import {
  applyMetadataCorrection,
  consumptionRoles,
  netConsumption,
  validateConsumptionEvidence,
  type ConsumptionEvidence,
  type ConsumptionRole,
} from './corrections'
const evidence = (): ConsumptionEvidence => ({
  transactions: [
    {
      id: 'buy',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      date: '2026-01-01',
      category_id: 'food',
    },
    {
      id: 'refund',
      type: 'income',
      amount: 50,
      currency: 'USD',
      date: '2026-02-01',
      category_id: 'other',
    },
    { id: 'principal', type: 'expense', amount: 100, currency: 'USD', date: '2026-02-01' },
  ],
  splits: [],
  classifications: [
    {
      id: 'p',
      transaction_id: 'buy',
      split_id: null,
      role: 'purchase',
      referenced_purchase_id: null,
    },
  ],
})
describe('shared correction policy', () => {
  it('preserves all nonmetadata fields including finalization and rejects split parent reinterpretation', () => {
    const row = {
      ...evidence().transactions[0],
      finalization_id: 'final',
      source: 'original',
      note: 'original note',
      notes: 'user',
    }
    expect(applyMetadataCorrection(row, { notes: null }, false)).toEqual({ ...row, notes: null })
    expect(() => applyMetadataCorrection(row, { category_id: 'other' }, true)).toThrow(
      /split replacement/
    )
    expect(() =>
      applyMetadataCorrection(
        { ...row, matched_transaction_id: 'mirror' },
        { description: 'new' },
        false
      )
    ).toThrow(/provenance/)
  })
  it.each(consumptionRoles)(
    'enforces direction and purchase references for %s',
    (role: ConsumptionRole) => {
      const data = evidence()
      const expense = ['purchase', 'fee', 'principal', 'cash_withdrawal'].includes(role)
      const item = {
        id: 'c',
        transaction_id: expense ? 'principal' : 'refund',
        split_id: null,
        role,
        referenced_purchase_id: ['principal', 'refund'].includes(role) ? 'p' : null,
      }
      expect(() =>
        validateConsumptionEvidence({ ...data, classifications: [...data.classifications, item] })
      ).not.toThrow()
      expect(() =>
        validateConsumptionEvidence({
          ...data,
          classifications: [
            ...data.classifications,
            { ...item, transaction_id: expense ? 'refund' : 'principal' },
          ],
        })
      ).toThrow(/direction/)
    }
  )
  it('caps refunds and principal separately, attributes refund on its own date and never guesses', () => {
    const data = evidence()
    const classifications = [
      ...data.classifications,
      {
        id: 'r',
        transaction_id: 'refund',
        split_id: null,
        role: 'refund' as const,
        referenced_purchase_id: 'p',
      },
      {
        id: 'pr',
        transaction_id: 'principal',
        split_id: null,
        role: 'principal' as const,
        referenced_purchase_id: 'p',
      },
    ]
    expect(() => validateConsumptionEvidence({ ...data, classifications })).not.toThrow()
    const result = netConsumption({ ...data, classifications }, '2026-02-01', '2026-02-28')
    expect(result.byCategory).toEqual([
      { currency: 'USD', categoryId: 'food', amountCentavos: -50 },
    ])
    expect(netConsumption(data, '2026-02-01', '2026-02-28').unresolvedIds).toEqual([
      'refund',
      'principal',
    ])
    expect(() =>
      validateConsumptionEvidence({
        ...data,
        classifications,
        transactions: data.transactions.map((row) =>
          row.id === 'refund' ? { ...row, amount: 101 } : row
        ),
      })
    ).toThrow(/capacity/)
  })
  it('reports invalid currency and invalid ordinary status as unresolved, not a complete zero', () => {
    const data = evidence()
    const invalidCurrency = {
      ...data,
      transactions: data.transactions.map((row) =>
        row.id === 'buy' ? { ...row, currency: 'US D' } : row
      ),
    }
    expect(netConsumption(invalidCurrency, '2026-01-01', '2026-01-31')).toMatchObject({
      classificationComplete: false,
      unresolvedIds: ['buy'],
      totalsByCurrency: [],
    })
    expect(
      netConsumption(
        {
          ...data,
          classifications: [],
          transactions: [{ ...data.transactions[0], status: 'broken' }],
        },
        '2026-01-01',
        '2026-01-31'
      )
    ).toMatchObject({ classificationComplete: false, unresolvedIds: ['buy'] })
  })
})
