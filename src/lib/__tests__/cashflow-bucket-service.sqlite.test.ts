// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { TransactionClient } from '@/lib/database'
import {
  createCashflowBucketsTestDatabase,
  insertAccount,
  insertTransaction,
  readAllocations,
  readAudit,
  readLedger,
} from '../../../cli/src/tools/cashflow-buckets.sqlite-test-helper'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  id: 0,
  failExecuteAt: null as number | null,
  executeCount: 0,
}))

vi.mock('@/lib/ulid', () => ({ generateId: () => `ui-bucket-${++state.id}` }))
vi.mock('@/lib/database', () => ({
  withTransaction: async <T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> => {
    const db = state.db!
    db.exec('BEGIN IMMEDIATE')
    try {
      const tx: TransactionClient = {
        query: async <Row>(sql: string, values: unknown[] = []) =>
          db.prepare(sql).all(...values) as Row[],
        execute: async (sql: string, values: unknown[] = []) => {
          state.executeCount += 1
          if (state.failExecuteAt === state.executeCount) throw new Error('injected write failure')
          const result = db.prepare(sql).run(...values)
          return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
        },
      }
      const result = await callback(tx)
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  },
}))

const service = await import('../cashflow-bucket-service')

function db() {
  return state.db!
}

function revision() {
  return db().prepare("SELECT value FROM settings WHERE key = 'financial_data_revision'").get() as
    | { value: string }
    | undefined
}

describe('cashflow bucket browser/Tauri service with SQLite', () => {
  beforeEach(() => {
    state.db = createCashflowBucketsTestDatabase()
    state.id = 0
    state.failExecuteAt = null
    state.executeCount = 0
    insertAccount(db(), { id: 'account-1', name: 'Checking', balance: 99_00 })
    insertTransaction(db(), {
      id: 'income-1',
      accountId: 'account-1',
      amount: 100_00,
      description: 'Pay',
      status: 'posted',
    })
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('creates, patches, clears and deletes only empty buckets', async () => {
    const bucket = await service.createCashflowBucket({
      name: 'Rent',
      description: 'Housing',
      targetAmountCentavos: 75_00,
      currency: 'usd',
    })
    const updated = await service.updateCashflowBucket(bucket.id, { name: 'Home' })
    expect(updated).toMatchObject({
      id: bucket.id,
      name: 'Home',
      description: 'Housing',
      targetAmountCentavos: 75_00,
    })
    await expect(
      service.updateCashflowBucket(bucket.id, {
        targetAmountCentavos: 20_00,
        clearFields: ['targetAmount'],
      })
    ).rejects.toMatchObject({ reason: 'clear_field_conflict' })
    expect(
      await service.updateCashflowBucket(bucket.id, { clearFields: ['targetAmount'] })
    ).toMatchObject({ targetAmountCentavos: null })
    await service.deleteCashflowBucket(bucket.id)
    expect((await service.listCashflowBuckets()).buckets).toEqual([])
  })

  it('uses eligible income or explicit unbound virtual funding without changing the ledger', async () => {
    const bucket = await service.createCashflowBucket({ name: 'Rent', currency: 'USD' })
    const ledgerBefore = readLedger(db())
    const bound = await service.allocateCashflow({
      bucketId: bucket.id,
      amountCentavos: 60_00,
      transactionId: 'income-1',
    })
    const unbound = await service.allocateCashflow({
      bucketId: bucket.id,
      amountCentavos: 5_00,
      transactionId: null,
    })
    expect(bound).toMatchObject({ transactionId: 'income-1', source: 'income-transaction' })
    expect(unbound).toMatchObject({ transactionId: null, source: 'virtual-unbound' })
    expect(readLedger(db())).toEqual(ledgerBefore)
    await expect(
      service.allocateCashflow({
        bucketId: bucket.id,
        amountCentavos: 41_00,
        transactionId: 'income-1',
      })
    ).rejects.toMatchObject({ reason: 'source_transaction_overallocated' })
  })

  it.each([
    ['pending', 'normal', 'standard', 'source_transaction_not_posted'],
    ['posted', 'staged_no_balance_impact', 'standard', 'source_transaction_staged'],
    ['posted', 'normal', 'reconciliation_bridge', 'source_transaction_technical'],
  ])('rejects ineligible %s/%s/%s source rows', async (status, ledger, kind, reason) => {
    const bucket = await service.createCashflowBucket({ name: 'Rent', currency: 'USD' })
    db()
      .prepare(
        'UPDATE transactions SET status = ?, ledger_treatment = ?, transaction_kind = ? WHERE id = ?'
      )
      .run(status, ledger, kind, 'income-1')
    await expect(
      service.allocateCashflow({
        bucketId: bucket.id,
        amountCentavos: 1_00,
        transactionId: 'income-1',
      })
    ).rejects.toMatchObject({ reason })
    expect(readAllocations(db())).toEqual([])
  })

  it('reverses once, allows inactive unwind, and requires active allocation targets', async () => {
    const bucket = await service.createCashflowBucket({ name: 'Rent', currency: 'USD' })
    const original = await service.allocateCashflow({
      bucketId: bucket.id,
      amountCentavos: 25_00,
      transactionId: 'income-1',
    })
    await service.updateCashflowBucket(bucket.id, { active: false })
    await expect(
      service.allocateCashflow({ bucketId: bucket.id, amountCentavos: 1, transactionId: null })
    ).rejects.toMatchObject({ reason: 'bucket_inactive' })
    expect(await service.reverseCashflowAllocation(original.id)).toMatchObject({
      amountCentavos: -25_00,
      reversesAllocationId: original.id,
    })
    await expect(service.reverseCashflowAllocation(original.id)).rejects.toMatchObject({
      reason: 'allocation_already_reversed',
    })
  })

  it('requires a reviewed current correction plan and rolls back every mutation on failure', async () => {
    const rent = await service.createCashflowBucket({ name: 'Rent', currency: 'USD' })
    const tax = await service.createCashflowBucket({ name: 'Tax', currency: 'USD' })
    const original = await service.allocateCashflow({
      bucketId: rent.id,
      amountCentavos: 40_00,
      transactionId: 'income-1',
    })
    const preview = await service.previewCashflowCorrection({
      allocationId: original.id,
      bucketId: tax.id,
      amountCentavos: 30_00,
    })
    expect(preview.balances).toEqual({
      originalAfterCentavos: 0,
      targetAfterCentavos: 30_00,
    })

    db().prepare('UPDATE cashflow_buckets SET balance = balance + 1 WHERE id = ?').run(tax.id)
    await expect(service.applyCashflowCorrection(preview)).rejects.toMatchObject({
      reason: 'stale_preview',
    })
    expect(readAllocations(db())).toHaveLength(1)

    db().prepare('UPDATE cashflow_buckets SET balance = balance - 1 WHERE id = ?').run(tax.id)
    const refreshed = await service.previewCashflowCorrection({
      allocationId: original.id,
      bucketId: tax.id,
      amountCentavos: 30_00,
    })
    const ledgerBefore = readLedger(db())
    const allocationsBefore = readAllocations(db())
    const auditsBefore = readAudit(db())
    const revisionBefore = revision()
    state.executeCount = 0
    state.failExecuteAt = 3
    await expect(service.applyCashflowCorrection(refreshed)).rejects.toThrow(
      'injected write failure'
    )
    expect(readAllocations(db())).toEqual(allocationsBefore)
    expect(readAudit(db())).toEqual(auditsBefore)
    expect(revision()).toEqual(revisionBefore)
    expect(readLedger(db())).toEqual(ledgerBefore)

    state.failExecuteAt = null
    state.executeCount = 0
    const applied = await service.applyCashflowCorrection(refreshed)
    expect(applied.reversal).toMatchObject({ amountCentavos: -40_00 })
    expect(applied.replacement).toMatchObject({
      amountCentavos: 30_00,
      bucketId: tax.id,
      replacesAllocationId: original.id,
    })
    expect(readLedger(db())).toEqual(ledgerBefore)
  })

  it('rejects malformed currency and unsafe locked snapshots', async () => {
    const bucket = await service.createCashflowBucket({ name: 'Rent', currency: 'USD' })
    db().prepare("UPDATE transactions SET currency = 'US' WHERE id = 'income-1'").run()
    await expect(
      service.allocateCashflow({
        bucketId: bucket.id,
        amountCentavos: 1,
        transactionId: 'income-1',
      })
    ).rejects.toMatchObject({ reason: 'malformed_currency' })
    db()
      .prepare('UPDATE cashflow_buckets SET balance = ? WHERE id = ?')
      .run(Number.MAX_SAFE_INTEGER, bucket.id)
    await expect(
      service.allocateCashflow({ bucketId: bucket.id, amountCentavos: 1, transactionId: null })
    ).rejects.toMatchObject({ reason: 'unsafe_amount' })
    expect(readAllocations(db())).toEqual([])
  })
})
