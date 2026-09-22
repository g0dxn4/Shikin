import { describe, expect, it } from 'vitest'
import { projectDatedNetConsumption } from './dated-consumption.js'
import type { ConsumptionEvidence } from './corrections.js'

const evidence: ConsumptionEvidence = {
  transactions: [
    {
      id: 'parent',
      type: 'expense',
      amount: 3,
      currency: 'USD',
      date: '2026-01-02',
      status: 'posted',
    },
  ],
  splits: [
    { id: 'a', transaction_id: 'parent', amount: 1, category_id: 'one' },
    { id: 'b', transaction_id: 'parent', amount: 2, category_id: 'two' },
  ],
  classifications: [
    {
      id: 'ca',
      transaction_id: 'parent',
      split_id: 'a',
      role: 'purchase',
      referenced_purchase_id: null,
    },
    {
      id: 'cb',
      transaction_id: 'parent',
      split_id: 'b',
      role: 'asset_acquisition',
      referenced_purchase_id: null,
    },
  ],
}

describe('dated consumption projection', () => {
  it('apportions the converted parent before applying every fixed contribution', () => {
    const report = projectDatedNetConsumption({
      evidence,
      start: '2026-01-01',
      end: '2026-01-31',
      coverageComplete: true,
      conversion: {
        complete: true,
        toCurrency: 'MXN',
        reason: null,
        converted: [{ id: 'parent', complete: true, amountCentavos: 17 }],
      },
    })
    expect(report.allocations).toMatchObject([
      { allocationId: 'a', amountCentavos: 6, consumptionCentavos: 6, assetAcquisitionCentavos: 0 },
      {
        allocationId: 'b',
        amountCentavos: 11,
        consumptionCentavos: 0,
        assetAcquisitionCentavos: 11,
      },
    ])
    expect(report).toMatchObject({ consumptionCentavos: 6, assetAcquisitionCentavos: 11 })
  })

  it('keeps known subtotals but nulls full totals when a dated rate is missing', () => {
    const report = projectDatedNetConsumption({
      evidence,
      start: '2026-01-01',
      end: '2026-01-31',
      coverageComplete: true,
      conversion: {
        complete: false,
        toCurrency: 'MXN',
        reason: 'missing_direct_rate',
        converted: [{ id: 'parent', complete: false, amountCentavos: null }],
      },
    })
    expect(report).toMatchObject({
      complete: false,
      consumptionCentavos: null,
      knownConsumptionCentavos: 0,
      assetAcquisitionCentavos: null,
      knownAssetAcquisitionCentavos: 0,
    })
    expect(report.allocations[0].consumptionCentavos).toBeNull()
  })
})
