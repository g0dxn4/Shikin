import { describe, expect, it } from 'vitest'
import {
  classificationContribution,
  financialTreatments,
  resolveClassificationTypeRevision,
  type ClassificationTypeRevision,
  type ConsumptionRole,
} from './classification-policy.js'
import {
  netConsumption,
  validateConsumptionEvidence,
  setConsumptionClassificationInEvidence,
  type ConsumptionEvidence,
} from './corrections.js'

const revision: ClassificationTypeRevision = {
  id: 'v1',
  type_id: 'type',
  version: 1,
  name: 'Family support',
  financial_treatment: 'other_income',
  created_at: '2026-01-01',
}
function evidence(role: ConsumptionRole = 'other_income'): ConsumptionEvidence {
  return {
    transactions: [
      {
        id: 't',
        type: role === 'asset_acquisition' ? 'expense' : 'income',
        amount: 123,
        currency: 'USD',
        date: '2026-01-01',
      },
    ],
    splits: [],
    classifications: [
      { id: 'c', transaction_id: 't', split_id: null, role, referenced_purchase_id: null },
    ],
  }
}
describe('fixed classification treatment contributions', () => {
  it.each(financialTreatments)(
    'publishes fixed centavos and directions for $role',
    (definition) => {
      const expected = {
        consumptionCentavos: 0,
        earnedIncomeCentavos: 0,
        otherIncomeCentavos: 0,
        principalRecoveryCentavos: 0,
        assetAcquisitionCentavos: 0,
      }
      if (definition.contributionField)
        expected[definition.contributionField] = definition.contributionSign * 123
      expect(classificationContribution(definition.role, 123)).toEqual(expected)
      expect(classificationContribution(definition.role, 0)).toEqual({
        consumptionCentavos: 0,
        earnedIncomeCentavos: 0,
        otherIncomeCentavos: 0,
        principalRecoveryCentavos: 0,
        assetAcquisitionCentavos: 0,
      })
      for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(() => classificationContribution(definition.role, amount)).toThrow(/safe centavos/)
    }
  )
  it.each(['other_income', 'principal_recovery', 'asset_acquisition'] as const)(
    'reports %s separately without altering source data',
    (role) => {
      const data = evidence(role)
      const before = JSON.stringify(data)
      expect(netConsumption(data, '2026-01-01', '2026-01-31')).toEqual({
        basis: 'net_consumption',
        classificationComplete: true,
        unresolvedIds: [],
        totalsByCurrency: [{ currency: 'USD', ...classificationContribution(role, 123) }],
        byCategory: [],
      })
      expect(JSON.stringify(data)).toBe(before)
      expect(() =>
        validateConsumptionEvidence({
          ...data,
          classifications: [{ ...data.classifications[0]!, referenced_purchase_id: 'invented' }],
        })
      ).toThrow(/Only refunds/)
    }
  )
  it.each(['other_income', 'principal_recovery', 'asset_acquisition'] as const)(
    'does not publish unsafe %s aggregates as complete',
    (role) => {
      const data = evidence(role)
      data.transactions = [
        { ...data.transactions[0]!, amount: Number.MAX_SAFE_INTEGER },
        { ...data.transactions[0]!, id: 't2' },
      ]
      data.classifications = [
        ...data.classifications,
        { ...data.classifications[0]!, id: 'c2', transaction_id: 't2' },
      ]
      const report = netConsumption(data, '2026-01-01', '2026-01-31')
      expect(report.classificationComplete).toBe(false)
      expect(report.unresolvedIds).toEqual(['t2'])
      expect(report.totalsByCurrency).toEqual([
        { currency: 'USD', ...classificationContribution(role, Number.MAX_SAFE_INTEGER) },
      ])
    }
  )
})
describe('pinned immutable custom revision meaning', () => {
  it('accepts omitted/null builtin revisions and requires pinned evidence without head fallback', () => {
    const data = evidence()
    expect(() => validateConsumptionEvidence(data)).not.toThrow()
    data.classifications = [{ ...data.classifications[0]!, type_revision_id: null }]
    expect(() => validateConsumptionEvidence(data)).not.toThrow()
    data.classifications = [{ ...data.classifications[0]!, type_revision_id: 'v1' }]
    expect(() => validateConsumptionEvidence(data)).toThrow(/revision is missing/)
    expect(netConsumption(data, '2026-01-01', '2026-01-31').classificationComplete).toBe(false)
    const next = {
      ...revision,
      id: 'v2',
      version: 2,
      name: 'Salary',
      financial_treatment: 'earned_income' as const,
    }
    data.typeRevisions = [revision, next]
    expect(() => validateConsumptionEvidence(data)).not.toThrow()
    expect(resolveClassificationTypeRevision(data.classifications[0]!, data.typeRevisions)).toEqual(
      revision
    )
    expect(netConsumption(data, '2026-01-01', '2026-01-31').totalsByCurrency[0]).toMatchObject({
      earnedIncomeCentavos: 0,
      otherIncomeCentavos: 123,
    })
    expect(() =>
      setConsumptionClassificationInEvidence(data, {
        ...data.classifications[0]!,
        type_revision_id: 'v2',
      })
    ).toThrow(/must match/)
    expect(() => validateConsumptionEvidence({ ...data, typeRevisions: [next] })).toThrow(
      /revision is missing/
    )
    expect(() =>
      validateConsumptionEvidence({ ...data, typeRevisions: [revision, revision] })
    ).toThrow(/ambiguous/)
  })
  it('validates custom purchase revisions even when only their refund is in period', () => {
    const data = evidence('refund')
    data.transactions = [
      ...data.transactions,
      { id: 'p', type: 'expense', amount: 123, currency: 'USD', date: '2025-12-01' },
    ]
    data.classifications = [
      { ...data.classifications[0]!, referenced_purchase_id: 'pc' },
      {
        id: 'pc',
        transaction_id: 'p',
        split_id: null,
        role: 'purchase',
        referenced_purchase_id: null,
        type_revision_id: 'purchase-v1',
      },
    ]
    expect(() => validateConsumptionEvidence(data)).toThrow(/revision is missing/)
    data.typeRevisions = [{ ...revision, id: 'purchase-v1', financial_treatment: 'purchase' }]
    expect(
      netConsumption(data, '2026-01-01', '2026-01-31').totalsByCurrency[0]?.consumptionCentavos
    ).toBe(-123)
    data.transactions = data.transactions.map((row) =>
      row.id === 'p' ? { ...row, currency: 'MXN' } : row
    )
    expect(() => validateConsumptionEvidence(data)).toThrow(/currency differs/)
  })
})

it('preserves the exact ten fixed treatment effects, independently of catalog implementation', () => {
  const matrix = [
    ['purchase', 'expense', false, [7, 0, 0, 0, 0]],
    ['fee', 'expense', false, [7, 0, 0, 0, 0]],
    ['earned_income', 'income', false, [0, 7, 0, 0, 0]],
    ['refund', 'income', true, [-7, 0, 0, 0, 0]],
    ['internal_inflow', 'income', false, [0, 0, 0, 0, 0]],
    ['cash_withdrawal', 'expense', false, [0, 0, 0, 0, 0]],
    ['principal', 'expense', true, [0, 0, 0, 0, 0]],
    ['other_income', 'income', false, [0, 0, 7, 0, 0]],
    ['principal_recovery', 'income', false, [0, 0, 0, 7, 0]],
    ['asset_acquisition', 'expense', false, [0, 0, 0, 0, 7]],
  ] as const
  expect(financialTreatments.map((entry) => entry.role)).toEqual(matrix.map(([role]) => role))
  for (const [role, direction, requiresPurchase, values] of matrix) {
    expect(financialTreatments.find((entry) => entry.role === role)).toMatchObject({
      direction,
      requiresPurchase,
    })
    const contribution = classificationContribution(role, 7)
    expect([
      contribution.consumptionCentavos,
      contribution.earnedIncomeCentavos,
      contribution.otherIncomeCentavos,
      contribution.principalRecoveryCentavos,
      contribution.assetAcquisitionCentavos,
    ]).toEqual(values)
  }
})
