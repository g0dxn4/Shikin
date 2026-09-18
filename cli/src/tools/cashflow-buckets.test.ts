// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCashflowBucketsTestHarness,
  insertAccount,
  insertTransaction,
  readAllocations,
  readAudit,
  readBuckets,
  readLedger,
  type CashflowBucketsTestHarness,
} from './cashflow-buckets.sqlite-test-helper.js'

const current = vi.hoisted(() => ({
  harness: null as CashflowBucketsTestHarness | null,
  nextId: 0,
}))

vi.mock('../database.js', () => ({
  query: (sql: string, params?: unknown[]) => current.harness!.query(sql, params),
  execute: (sql: string, params?: unknown[]) => current.harness!.execute(sql, params),
  transaction: <T>(fn: () => T) => current.harness!.transaction(fn),
}))

vi.mock('../ulid.js', () => ({
  generateId: () => `cf_${++current.nextId}`,
}))

const { cashflowBucketTools } = await import('./cashflow-buckets.js')

const createBucket = cashflowBucketTools.find((tool) => tool.name === 'create-bucket')!
const listBuckets = cashflowBucketTools.find((tool) => tool.name === 'list-buckets')!
const allocateIncome = cashflowBucketTools.find((tool) => tool.name === 'allocate-income')!
const updateBucket = cashflowBucketTools.find((tool) => tool.name === 'update-bucket')!
const deleteBucket = cashflowBucketTools.find((tool) => tool.name === 'delete-bucket')!
const reverseBucketAllocation = cashflowBucketTools.find(
  (tool) => tool.name === 'reverse-bucket-allocation'
)!
const correctBucketAllocation = cashflowBucketTools.find(
  (tool) => tool.name === 'correct-bucket-allocation'
)!

type BucketResult = {
  success: boolean
  bucket?: { id: string; name: string; description: string | null; targetAmount: number | null }
}
type AllocationResult = {
  success: boolean
  allocation?: { id: string; bucketId: string }
  reversal?: { id: string }
  replacement?: { id: string }
}

function db() {
  return current.harness!.db
}

async function createNamedBucket(name: string, extra: Record<string, unknown> = {}) {
  const result = (await createBucket.execute(
    createBucket.schema.parse({ name, ...extra })
  )) as BucketResult
  expect(result.success).toBe(true)
  return result.bucket!
}

describe('cashflow bucket maintenance', () => {
  beforeEach(() => {
    current.nextId = 0
    current.harness = createCashflowBucketsTestHarness()
    insertAccount(db(), { id: 'acct-1', name: 'Checking', balance: 50000 })
    insertTransaction(db(), {
      id: 'tx-income',
      accountId: 'acct-1',
      amount: 20000,
      description: 'Paycheck',
    })
  })

  afterEach(() => {
    current.harness?.close()
    current.harness = null
  })

  it('exports the maintenance tools alongside the existing bucket tools', () => {
    expect(cashflowBucketTools.map((tool) => tool.name)).toEqual([
      'create-bucket',
      'list-buckets',
      'allocate-income',
      'update-bucket',
      'delete-bucket',
      'reverse-bucket-allocation',
      'correct-bucket-allocation',
    ])
  })

  it('updates listed fields, omits unchanged values, and clears nullable fields explicitly', async () => {
    const bucket = await createNamedBucket('Rent', {
      description: 'Housing',
      targetAmount: 150,
      sortOrder: 2,
    })

    const omitted = await updateBucket.execute(
      updateBucket.schema.parse({ bucketId: bucket.id, name: 'Housing' })
    )
    expect(omitted).toMatchObject({
      success: true,
      action: 'updated',
      bucket: {
        id: bucket.id,
        name: 'Housing',
        description: 'Housing',
        targetAmount: 150,
        sortOrder: 2,
        isActive: true,
      },
    })
    expect(readBuckets(db())).toEqual([
      expect.objectContaining({
        id: bucket.id,
        name: 'Housing',
        description: 'Housing',
        target_amount: 15000,
        sort_order: 2,
        is_active: 1,
      }),
    ])

    const cleared = await updateBucket.execute(
      updateBucket.schema.parse({
        bucketId: bucket.id,
        clearFields: ['description', 'targetAmount'],
      })
    )
    expect(cleared).toMatchObject({
      success: true,
      bucket: { id: bucket.id, name: 'Housing', description: null, targetAmount: null },
    })

    const conflict = await updateBucket.execute(
      updateBucket.schema.parse({
        bucketId: bucket.id,
        description: 'Nope',
        clearFields: ['description'],
      })
    )
    expect(conflict).toMatchObject({ success: false, reason: 'clear_field_conflict' })
    expect(readBuckets(db())).toEqual([
      expect.objectContaining({ id: bucket.id, description: null, target_amount: null }),
    ])
  })

  it('deletes only empty unreferenced buckets and otherwise guides deactivation', async () => {
    const empty = await createNamedBucket('Rent')
    const emptyDeletePreview = await deleteBucket.execute(
      deleteBucket.schema.parse({ bucketId: empty.id, dryRun: true })
    )
    expect(emptyDeletePreview).toMatchObject({ success: true, dryRun: true })
    expect(readBuckets(db())).toEqual([expect.objectContaining({ id: empty.id })])

    const deleted = await deleteBucket.execute(deleteBucket.schema.parse({ bucketId: empty.id }))
    expect(deleted).toMatchObject({ success: true, action: 'deleted', bucket: { id: empty.id } })
    expect(readBuckets(db())).toEqual([])

    const funded = await createNamedBucket('Savings')
    await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketId: funded.id, amount: 25, source: 'manual' })
    )

    const blocked = await deleteBucket.execute(deleteBucket.schema.parse({ bucketId: funded.id }))
    expect(blocked).toMatchObject({
      success: false,
      reason: 'bucket_not_empty',
      deactivateWith: { tool: 'update-bucket', bucketId: funded.id, active: false },
    })
    expect(readBuckets(db())).toEqual([expect.objectContaining({ id: funded.id, is_active: 1 })])

    const deactivated = await updateBucket.execute(
      updateBucket.schema.parse({ bucketId: funded.id, active: false })
    )
    expect(deactivated).toMatchObject({
      success: true,
      bucket: { isActive: false, id: funded.id },
    })
    expect(readBuckets(db())).toEqual([expect.objectContaining({ id: funded.id, is_active: 0 })])
  })

  it('keeps source-unbound manual allocations and persisted:false source accounts', async () => {
    const bucket = await createNamedBucket('Rent')
    const ledgerBefore = readLedger(db())
    const preview = await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: bucket.id,
        amount: 40,
        accountId: 'acct-1',
        dryRun: true,
      })
    )
    expect(preview).toMatchObject({
      success: true,
      dryRun: true,
      wouldAllocate: {
        allocation: { transactionId: null, amount: 40, source: 'account' },
        sourceAccount: { id: 'acct-1', currency: 'USD', persisted: false },
      },
    })
    expect(readAllocations(db())).toEqual([])
    expect(readLedger(db())).toEqual(ledgerBefore)

    const allocated = await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: bucket.id,
        amount: 40,
        accountId: 'acct-1',
      })
    )
    expect(allocated).toMatchObject({
      success: true,
      allocation: { transactionId: null, amount: 40, source: 'account' },
      sourceAccount: { id: 'acct-1', currency: 'USD', persisted: false },
    })
    expect(readAllocations(db())).toEqual([
      expect.objectContaining({
        bucket_id: bucket.id,
        transaction_id: null,
        amount: 4000,
        source: 'account',
      }),
    ])
    expect(readLedger(db())).toEqual(ledgerBefore)
  })

  it('reverses and reallocates without rewriting history or touching accounts', async () => {
    const rent = await createNamedBucket('Rent')
    await createNamedBucket('Taxes')
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: rent.id,
        transactionId: 'tx-income',
        amount: 80,
        allocationDate: '2026-05-02',
        source: 'paycheck-plan',
        note: 'May rent',
      })
    )) as AllocationResult
    expect(allocated).toMatchObject({ success: true, allocation: { amount: 80 } })
    const allocationId = allocated.allocation!.id
    const ledgerBefore = readLedger(db())

    const reversePreview = await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId, dryRun: true })
    )
    expect(reversePreview).toMatchObject({ success: true, dryRun: true })
    expect(readAllocations(db())).toHaveLength(1)
    expect(readLedger(db())).toEqual(ledgerBefore)

    const reversed = (await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId })
    )) as AllocationResult
    expect(reversed).toMatchObject({
      success: true,
      action: 'reversed',
      original: { id: allocationId, amount: 80, source: 'paycheck-plan', note: 'May rent' },
      reversal: {
        amount: -80,
        reversesAllocationId: allocationId,
        transactionId: 'tx-income',
        source: 'paycheck-plan',
      },
    })
    expect(readBuckets(db())).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: rent.id, balance: 0 })])
    )
    expect(readAllocations(db())).toEqual([
      expect.objectContaining({ id: allocationId, amount: 8000, reverses_allocation_id: null }),
      expect.objectContaining({
        amount: -8000,
        reverses_allocation_id: allocationId,
        transaction_id: 'tx-income',
      }),
    ])
    expect(readLedger(db())).toEqual(ledgerBefore)

    const doubleReverse = await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId })
    )
    expect(doubleReverse).toMatchObject({ success: false, reason: 'allocation_already_reversed' })
    const reverseReversal = await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId: reversed.reversal!.id })
    )
    expect(reverseReversal).toMatchObject({ success: false, reason: 'cannot_reverse_reversal' })
    expect(readAllocations(db())).toHaveLength(2)
    expect(readLedger(db())).toEqual(ledgerBefore)
  })

  it('corrects an allocation onto another active bucket and records signed history', async () => {
    const rent = await createNamedBucket('Rent')
    const taxes = await createNamedBucket('Taxes')
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: rent.id,
        transactionId: 'tx-income',
        amount: 50,
        source: 'paycheck-plan',
      })
    )) as AllocationResult
    const ledgerBefore = readLedger(db())

    const corrected = await correctBucketAllocation.execute(
      correctBucketAllocation.schema.parse({
        allocationId: allocated.allocation!.id,
        bucketName: 'Taxes',
        amount: 40,
      })
    )
    expect(corrected).toMatchObject({
      success: true,
      action: 'corrected',
      original: { id: allocated.allocation!.id, amount: 50 },
      reversal: { amount: -50, reversesAllocationId: allocated.allocation!.id },
      replacement: {
        amount: 40,
        bucketId: taxes.id,
        replacesAllocationId: allocated.allocation!.id,
        transactionId: 'tx-income',
        source: 'paycheck-plan',
      },
    })
    expect(readBuckets(db())).toEqual([
      expect.objectContaining({ id: rent.id, name: 'Rent', balance: 0 }),
      expect.objectContaining({ id: taxes.id, name: 'Taxes', balance: 4000 }),
    ])
    expect(readAllocations(db())).toEqual([
      expect.objectContaining({
        id: allocated.allocation!.id,
        amount: 5000,
        bucket_id: rent.id,
      }),
      expect.objectContaining({
        amount: -5000,
        reverses_allocation_id: allocated.allocation!.id,
      }),
      expect.objectContaining({
        amount: 4000,
        bucket_id: taxes.id,
        replaces_allocation_id: allocated.allocation!.id,
        transaction_id: 'tx-income',
      }),
    ])
    expect(readLedger(db())).toEqual(ledgerBefore)
    expect(readAudit(db()).map((row) => row.action)).toEqual([
      'create',
      'create',
      'allocate',
      'correct',
    ])
  })

  it('rejects wrong currency, source over-allocation, and malformed currency evidence', async () => {
    const bucket = await createNamedBucket('Rent')
    const wrongCurrency = await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: bucket.id,
        transactionId: 'tx-income',
        amount: 10,
        currency: 'EUR',
      })
    )
    expect(wrongCurrency).toMatchObject({ success: false, reason: 'bucket_currency_mismatch' })

    await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: bucket.id,
        transactionId: 'tx-income',
        amount: 150,
      })
    )
    const over = await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: bucket.id,
        transactionId: 'tx-income',
        amount: 60,
      })
    )
    expect(over).toMatchObject({
      success: false,
      reason: 'source_transaction_overallocated',
      remainingAmount: 50,
    })

    insertTransaction(db(), {
      id: 'tx-bad-currency',
      accountId: 'acct-1',
      amount: 5000,
      currency: 'US',
      description: 'Malformed',
    })
    const malformed = await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: bucket.id,
        transactionId: 'tx-bad-currency',
        amount: 10,
      })
    )
    expect(malformed).toMatchObject({ success: false, reason: 'malformed_currency' })
    expect(readAllocations(db())).toHaveLength(1)
  })

  it('includes net reversals in source caps and still allows unbound manual allocation', async () => {
    const rent = await createNamedBucket('Rent')
    const taxes = await createNamedBucket('Taxes')
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: rent.id,
        transactionId: 'tx-income',
        amount: 150,
      })
    )) as AllocationResult
    await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId: allocated.allocation!.id })
    )
    const reallocated = await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketName: 'Taxes',
        transactionId: 'tx-income',
        amount: 200,
      })
    )
    expect(reallocated).toMatchObject({
      success: true,
      allocation: { amount: 200, bucketId: taxes.id },
    })

    const unbound = await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketName: 'Taxes', amount: 15, note: 'virtual' })
    )
    expect(unbound).toMatchObject({
      success: true,
      allocation: { transactionId: null, amount: 15, note: 'virtual' },
      sourceAccount: null,
    })
  })

  it('allows reversing an inactive original but requires an active correction target', async () => {
    const rent = await createNamedBucket('Rent')
    const taxes = await createNamedBucket('Taxes')
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketId: rent.id, amount: 30, source: 'manual' })
    )) as AllocationResult
    await updateBucket.execute(updateBucket.schema.parse({ bucketId: rent.id, active: false }))

    const inactiveAllocate = await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketId: rent.id, amount: 5 })
    )
    expect(inactiveAllocate).toMatchObject({ success: false, reason: 'bucket_inactive' })

    const reversed = await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId: allocated.allocation!.id })
    )
    expect(reversed).toMatchObject({ success: true, action: 'reversed' })

    const taxesAllocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketName: 'Taxes', amount: 12, source: 'manual' })
    )) as AllocationResult
    await updateBucket.execute(updateBucket.schema.parse({ bucketName: 'Taxes', active: false }))
    const inactiveTarget = await correctBucketAllocation.execute(
      correctBucketAllocation.schema.parse({
        allocationId: taxesAllocated.allocation!.id,
        amount: 10,
      })
    )
    expect(inactiveTarget).toMatchObject({ success: false, reason: 'bucket_inactive' })
    expect(
      readAllocations(db()).filter(
        (row) => (row as { replaces_allocation_id: string | null }).replaces_allocation_id
      )
    ).toEqual([])
    expect(taxes.id).toBeTruthy()
  })

  it('revalidates a concurrently deactivated target and rolls back duplicate reversal writes', async () => {
    const rent = await createNamedBucket('Rent')
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: rent.id,
        transactionId: 'tx-income',
        amount: 20,
      })
    )) as AllocationResult
    const ledgerBefore = readLedger(db())
    current.harness!.onTransactionStart = () => {
      db().prepare('UPDATE cashflow_buckets SET is_active = 0 WHERE id = ?').run(rent.id)
    }
    await expect(
      allocateIncome.execute(
        allocateIncome.schema.parse({
          bucketId: rent.id,
          transactionId: 'tx-income',
          amount: 10,
        })
      )
    ).rejects.toThrow(/inactive or missing/)
    expect(readAllocations(db())).toHaveLength(1)
    expect(readLedger(db())).toEqual(ledgerBefore)

    current.harness!.onTransactionStart = () => {
      db().prepare('UPDATE cashflow_buckets SET is_active = 0 WHERE id = ?').run(rent.id)
    }
    const corrected = await correctBucketAllocation.execute(
      correctBucketAllocation.schema.parse({
        allocationId: allocated.allocation!.id,
        amount: 15,
      })
    )
    expect(corrected).toMatchObject({ success: false, reason: 'bucket_inactive' })
    expect(readAllocations(db())).toHaveLength(1)

    current.harness!.onTransactionStart = null
    current.harness!.failOnExecuteCall = 2
    current.harness!.executeCalls = 0
    await expect(
      reverseBucketAllocation.execute(
        reverseBucketAllocation.schema.parse({ allocationId: allocated.allocation!.id })
      )
    ).rejects.toThrow('Injected execute failure on call 2')
    expect(readAllocations(db())).toEqual([
      expect.objectContaining({
        id: allocated.allocation!.id,
        amount: 2000,
        reverses_allocation_id: null,
      }),
    ])
    expect(readLedger(db())).toEqual(ledgerBefore)
  })

  it('unwinds old source evidence on reverse without requiring replacement funding', async () => {
    const rent = await createNamedBucket('Rent')
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: rent.id,
        transactionId: 'tx-income',
        amount: 25,
      })
    )) as AllocationResult
    db()
      .prepare(
        `UPDATE transactions SET ledger_treatment = 'staged_no_balance_impact', status = 'pending'
         WHERE id = 'tx-income'`
      )
      .run()
    const ledgerBefore = readLedger(db())
    const reversed = await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId: allocated.allocation!.id })
    )
    expect(reversed).toMatchObject({
      success: true,
      reversal: { transactionId: 'tx-income' },
    })
    expect(readLedger(db())).toEqual(ledgerBefore)

    const replacement = await correctBucketAllocation.execute(
      correctBucketAllocation.schema.parse({
        allocationId: allocated.allocation!.id,
        amount: 10,
        transactionId: 'tx-income',
      })
    )
    expect(replacement).toMatchObject({ success: false, reason: 'allocation_already_reversed' })
  })

  it('validates a new source-bound replacement against current eligibility and cap', async () => {
    const rent = await createNamedBucket('Rent')
    insertTransaction(db(), {
      id: 'tx-income-2',
      accountId: 'acct-1',
      amount: 3000,
      description: 'Bonus',
      date: '2026-05-03',
    })
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketId: rent.id, amount: 40, source: 'manual' })
    )) as AllocationResult
    const over = await correctBucketAllocation.execute(
      correctBucketAllocation.schema.parse({
        allocationId: allocated.allocation!.id,
        amount: 50,
        transactionId: 'tx-income-2',
      })
    )
    expect(over).toMatchObject({ success: false, reason: 'source_transaction_overallocated' })

    const corrected = await correctBucketAllocation.execute(
      correctBucketAllocation.schema.parse({
        allocationId: allocated.allocation!.id,
        amount: 20,
        transactionId: 'tx-income-2',
      })
    )
    expect(corrected).toMatchObject({
      success: true,
      replacement: { amount: 20, transactionId: 'tx-income-2' },
    })
    expect(readAllocations(db())).toEqual([
      expect.objectContaining({
        id: allocated.allocation!.id,
        amount: 4000,
        transaction_id: null,
      }),
      expect.objectContaining({
        amount: -4000,
        reverses_allocation_id: allocated.allocation!.id,
      }),
      expect.objectContaining({
        amount: 2000,
        transaction_id: 'tx-income-2',
        replaces_allocation_id: allocated.allocation!.id,
      }),
    ])
  })

  it('lists signed allocation totals after reversals and records full audit transitions', async () => {
    const rent = await createNamedBucket('Rent')
    const allocated = (await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketId: rent.id, amount: 60, source: 'manual' })
    )) as AllocationResult
    await reverseBucketAllocation.execute(
      reverseBucketAllocation.schema.parse({ allocationId: allocated.allocation!.id })
    )
    const listed = (await listBuckets.execute(listBuckets.schema.parse({ activeOnly: false }))) as {
      success: boolean
      buckets: Array<{
        id: string
        balance: number
        allocationSummary: { count: number; allocatedAmount: number }
      }>
    }
    expect(listed.success).toBe(true)
    expect(listed.buckets).toHaveLength(1)
    expect(listed.buckets[0]).toMatchObject({
      id: rent.id,
      balance: 0,
    })
    expect(listed.buckets[0]?.allocationSummary).toMatchObject({
      count: 2,
      allocatedAmount: 0,
    })
    expect(readAudit(db()).map((row) => [row.entity, row.action])).toEqual([
      ['cashflow_bucket', 'create'],
      ['cashflow_bucket_allocation', 'allocate'],
      ['cashflow_bucket_allocation', 'reverse'],
    ])
  })
})
