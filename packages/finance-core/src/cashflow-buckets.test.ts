import { describe, expect, it } from 'vitest'
import {
  planBucketAllocation,
  planBucketCorrection,
  planBucketPatch,
  planBucketReversal,
  validateBucketIncomeSource,
  type AllocationPolicySnapshot,
  type BucketPolicySnapshot,
} from './cashflow-buckets.js'

const bucket = (overrides: Partial<BucketPolicySnapshot> = {}): BucketPolicySnapshot => ({
  id: 'rent',
  name: 'Rent',
  description: 'Housing',
  targetAmountCentavos: 100_00,
  balanceCentavos: 40_00,
  currency: 'USD',
  sortOrder: 1,
  isActive: true,
  ...overrides,
})

const allocation = (
  overrides: Partial<AllocationPolicySnapshot> = {}
): AllocationPolicySnapshot => ({
  id: 'allocation-1',
  bucketId: 'rent',
  transactionId: 'income-1',
  amountCentavos: 40_00,
  currency: 'USD',
  allocationDate: '2026-05-01',
  source: 'income-transaction',
  note: null,
  reversesAllocationId: null,
  replacesAllocationId: null,
  ...overrides,
})

describe('cashflow bucket policy', () => {
  it('patches only supplied fields and requires explicit clears', () => {
    expect(planBucketPatch(bucket(), { name: 'Home' })).toMatchObject({
      success: true,
      plan: { name: 'Home', description: 'Housing', targetAmountCentavos: 100_00 },
    })
    expect(planBucketPatch(bucket(), { clearFields: ['targetAmount'] })).toMatchObject({
      success: true,
      plan: { targetAmountCentavos: null, description: 'Housing' },
    })
    expect(
      planBucketPatch(bucket(), {
        targetAmountCentavos: 1,
        clearFields: ['targetAmount'],
      })
    ).toMatchObject({ success: false, reason: 'clear_field_conflict', field: 'targetAmount' })
  })

  it('accepts only eligible posted or cleared ordinary income', () => {
    const source = {
      id: 'income-1',
      accountId: 'account-1',
      type: 'income',
      amountCentavos: 100_00,
      currency: 'usd',
      status: 'cleared',
      ledgerTreatment: 'normal',
      transactionKind: 'standard',
    }
    expect(validateBucketIncomeSource(source)).toEqual({
      success: true,
      plan: { amountCentavos: 100_00, currency: 'USD' },
    })
    expect(validateBucketIncomeSource({ ...source, status: 'pending' })).toMatchObject({
      success: false,
      reason: 'source_transaction_not_posted',
    })
    expect(
      validateBucketIncomeSource({ ...source, ledgerTreatment: 'staged_no_balance_impact' })
    ).toMatchObject({ success: false, reason: 'source_transaction_staged' })
    expect(validateBucketIncomeSource({ ...source, currency: 'US' })).toMatchObject({
      success: false,
      reason: 'malformed_currency',
    })
    expect(
      validateBucketIncomeSource({ ...source, amountCentavos: Number.MAX_VALUE })
    ).toMatchObject({
      success: false,
      reason: 'unsafe_amount',
    })
  })

  it('enforces active/currency/safe balance and net source funding caps', () => {
    expect(
      planBucketAllocation({
        bucket: bucket({ isActive: false }),
        amountCentavos: 1,
        currency: 'USD',
      })
    ).toMatchObject({ success: false, reason: 'bucket_inactive' })
    expect(
      planBucketAllocation({ bucket: bucket(), amountCentavos: 1, currency: 'EUR' })
    ).toMatchObject({ success: false, reason: 'bucket_currency_mismatch' })
    expect(
      planBucketAllocation({
        bucket: bucket(),
        amountCentavos: 30_00,
        currency: 'USD',
        sourceTransactionId: 'income-1',
        sourceAmountCentavos: 100_00,
        sourceAllocatedCentavos: 80_00,
      })
    ).toMatchObject({
      success: false,
      reason: 'source_transaction_overallocated',
      remainingCentavos: 20_00,
    })
    expect(
      planBucketAllocation({
        bucket: bucket(),
        amountCentavos: 100_00,
        currency: 'USD',
        sourceTransactionId: 'income-1',
        sourceAmountCentavos: 100_00,
        sourceAllocatedCentavos: 40_00,
        sourceUnwindCentavos: 40_00,
      })
    ).toMatchObject({ success: true, plan: { nextSourceAllocatedCentavos: 100_00 } })
    expect(
      planBucketAllocation({
        bucket: bucket({ balanceCentavos: Number.MAX_SAFE_INTEGER }),
        amountCentavos: 1,
        currency: 'USD',
      })
    ).toMatchObject({ success: false, reason: 'unsafe_amount' })
  })

  it('plans exactly one reversal and correction deltas without requiring an active old bucket', () => {
    expect(
      planBucketReversal({
        original: allocation(),
        bucket: bucket({ isActive: false }),
        alreadyReversed: false,
      })
    ).toMatchObject({
      success: true,
      plan: { reversalAmountCentavos: -40_00, nextBalanceCentavos: 0 },
    })
    expect(
      planBucketReversal({ original: allocation(), bucket: bucket(), alreadyReversed: true })
    ).toMatchObject({ success: false, reason: 'allocation_already_reversed' })

    expect(
      planBucketCorrection({
        original: allocation(),
        originalBucket: bucket(),
        targetBucket: bucket({ id: 'tax', name: 'Tax', balanceCentavos: 20_00 }),
        replacementAmountCentavos: 30_00,
        replacementCurrency: 'USD',
        alreadyReversed: false,
        sourceTransactionId: 'income-1',
        sourceAmountCentavos: 100_00,
        sourceAllocatedCentavos: 80_00,
      })
    ).toMatchObject({
      success: true,
      plan: {
        reversalAmountCentavos: -40_00,
        originalNextBalanceCentavos: 0,
        targetNextBalanceCentavos: 50_00,
        nextSourceAllocatedCentavos: 70_00,
      },
    })
  })
})
