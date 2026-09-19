import { describe, expect, it } from 'vitest'
import {
  applyMetadataCorrection,
  clearConsumptionClassificationInEvidence,
  consumptionCoverage,
  consumptionRoles,
  netConsumption,
  setConsumptionClassificationInEvidence,
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
  it('does not silently omit a financially effective unresolved placeholder', () => {
    const data: ConsumptionEvidence = {
      transactions: [
        {
          id: 'p',
          type: 'expense',
          amount: 1000,
          currency: 'USD',
          date: '2026-09-01',
          status: 'posted',
          ledger_treatment: 'normal',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
          is_placeholder: 1,
          placeholder_status: 'unresolved',
        },
      ],
      splits: [],
      classifications: [],
    }
    expect(netConsumption(data, '2026-09-01', '2026-09-30')).toMatchObject({
      classificationComplete: false,
      unresolvedIds: ['p'],
      totalsByCurrency: [],
    })
  })
  it('keeps stable classification IDs and blocks dependent remap or clear', () => {
    const data = evidence()
    const dependent = {
      id: 'r',
      transaction_id: 'refund',
      split_id: null,
      role: 'refund' as const,
      referenced_purchase_id: 'p',
    }
    const linked = { ...data, classifications: [...data.classifications, dependent] }
    expect(() =>
      setConsumptionClassificationInEvidence(linked, {
        ...data.classifications[0],
        role: 'fee',
      })
    ).toThrow(/referencing/)
    expect(() => clearConsumptionClassificationInEvidence(linked, 'p')).toThrow(/referencing/)
    expect(() =>
      setConsumptionClassificationInEvidence(data, {
        ...data.classifications[0],
        id: 'replacement-id',
      })
    ).toThrow(/stable classification ID/)
  })
  it('shares independent contiguous account/source coverage semantics', () => {
    const rows = [
      {
        account_id: 'a',
        source_namespace: 'bank',
        period_start: '2026-01-01',
        period_end: '2026-01-15',
        status: 'verified',
      },
      {
        account_id: 'a',
        source_namespace: 'bank',
        period_start: '2026-01-16',
        period_end: '2026-01-31',
        status: 'verified',
      },
    ]
    expect(consumptionCoverage(['a'], rows, '2026-01-01', '2026-01-31')).toEqual({
      coverageComplete: true,
      uncoveredAccountIds: [],
    })
    expect(consumptionCoverage(['a', 'b'], rows, '2026-01-01', '2026-01-31')).toEqual({
      coverageComplete: false,
      uncoveredAccountIds: ['b'],
    })
  })
  it('marks pending and staged ordinary rows incomplete rather than complete zero', () => {
    const data = evidence()
    expect(
      netConsumption(
        {
          ...data,
          classifications: [],
          transactions: [
            { ...data.transactions[0], id: 'pending', status: 'pending' },
            {
              ...data.transactions[0],
              id: 'staged',
              ledger_treatment: 'staged_no_balance_impact',
            },
          ],
        },
        '2026-01-01',
        '2026-01-31'
      )
    ).toMatchObject({ classificationComplete: false, unresolvedIds: ['pending', 'staged'] })
  })
  it('rejects split classifications when the parent amount or aggregate is unsafe', () => {
    const data: ConsumptionEvidence = {
      transactions: [
        {
          id: 'unsafe',
          type: 'expense',
          amount: Number.MAX_SAFE_INTEGER + 1,
          currency: 'USD',
          date: '2026-09-01',
        },
      ],
      splits: [
        {
          id: 's1',
          transaction_id: 'unsafe',
          amount: 4503599627370496,
          category_id: 'food',
        },
        {
          id: 's2',
          transaction_id: 'unsafe',
          amount: 4503599627370496,
          category_id: 'food',
        },
      ],
      classifications: [
        {
          id: 'c1',
          transaction_id: 'unsafe',
          split_id: 's1',
          role: 'cash_withdrawal',
          referenced_purchase_id: null,
        },
        {
          id: 'c2',
          transaction_id: 'unsafe',
          split_id: 's2',
          role: 'cash_withdrawal',
          referenced_purchase_id: null,
        },
      ],
    }
    expect(() => validateConsumptionEvidence(data)).toThrow(/positive safe parent|split allocation/)
    expect(netConsumption(data, '2026-01-01', '2026-12-31')).toMatchObject({
      classificationComplete: false,
      unresolvedIds: ['s1', 's2'],
      totalsByCurrency: [],
    })
  })
})
