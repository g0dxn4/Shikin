// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionClient } from '@/lib/database'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema'

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('@/lib/database', () => {
  const client: TransactionClient = {
    query: async <Row>(sql: string, params: unknown[] = []) =>
      state.db.prepare(sql).all(...params) as Row[],
    execute: async (sql: string, params: unknown[] = []) => {
      const result = state.db.prepare(sql).run(...params)
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
  }
  return {
    ...client,
    withTransaction: async <T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> => {
      state.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await callback(client)
        state.db.exec('COMMIT')
        return result
      } catch (error) {
        state.db.exec('ROLLBACK')
        throw error
      }
    },
  }
})

import { changeReceivablePayment } from '../receivable-payment-service'
import {
  applyConsumptionClassifications,
  previewConsumptionClassifications,
} from '../classification-type-service'
import { createSplits } from '../split-service'
import { getTransactionById, queryTransactionPage } from '../transaction-query'

beforeEach(async () => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT INTO accounts (id,name,type,currency,balance) VALUES ('bank','Synthetic bank','checking','USD',12000);
    INSERT INTO categories (id,name,type) VALUES ('sales','Synthetic sales','income');
    INSERT INTO receivables (id,payer,amount,currency,due_date,status,account_id)
      VALUES ('invoice','Synthetic client',10000,'USD','2026-10-20','open','bank');
    INSERT INTO transactions (id,account_id,category_id,type,amount,currency,description,date,status)
      VALUES ('first','bank','sales','income',4000,'USD','First installment','2026-10-01','posted'),
             ('second','bank','sales','income',6000,'USD','Final installment','2026-10-10','cleared'),
             ('free','bank','sales','income',2000,'USD','Unallocated income','2026-10-12','posted');
  `)
  for (const transactionId of ['first', 'second'])
    await changeReceivablePayment({
      receivableId: 'invoice',
      action: 'match',
      transactionId,
      apply: true,
    })
  expect(
    state.db.prepare("SELECT matched_transaction_id FROM receivables WHERE id='invoice'").get()
  ).toEqual({ matched_transaction_id: null })
})
afterEach(() => state.db.close())

describe('receipt evidence guards after multiple installments', () => {
  it('marks every receipt source protected and excludes it from the unclassified review queue', async () => {
    const before = state.db.prepare('SELECT total_changes() AS changes').get()
    const page = await queryTransactionPage({})
    expect(page.rows.filter((row) => row.id !== 'free')).toHaveLength(2)
    for (const row of page.rows.filter((row) => row.id !== 'free')) {
      expect(row.is_receivable_payment).toBe(1)
      expect(row.is_consumption_unclassified).toBe(0)
    }
    expect((await getTransactionById('first'))?.is_receivable_payment).toBe(1)
    const unclassified = await queryTransactionPage({ reviewReason: 'unclassified' })
    expect(unclassified.rows.map((row) => row.id)).toEqual(['free'])
    expect(unclassified.reviewCounts.unclassified).toBe(1)
    expect(state.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before)
  })

  it('rejects classification and split changes before applying protected receipt evidence', async () => {
    const before = state.db.prepare('SELECT total_changes() AS changes').get()
    const targets = ['first', 'second'].map((transactionId) => ({
      transactionId,
      builtinRole: 'earned_income' as const,
    }))
    const preview = await previewConsumptionClassifications(targets)
    expect(preview.applicable).toBe(false)
    for (const item of preview.items)
      expect(item.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/Protected receivable/)])
      )
    await expect(
      applyConsumptionClassifications({ targets, previewToken: preview.previewToken })
    ).rejects.toThrow(/invalid/)
    await expect(
      createSplits(
        'first',
        [
          { categoryId: 'sales', amount: 2000 },
          { categoryId: 'sales', amount: 2000 },
        ],
        4000
      )
    ).rejects.toThrow(/Protected financial provenance/)
    expect(state.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before)
  })

  it('allows a new reviewed correction after the chosen receipt is reversed', async () => {
    const payment = state.db
      .prepare("SELECT id FROM receivable_payment_links WHERE transaction_id='first'")
      .get() as { id: string }
    await changeReceivablePayment({
      receivableId: 'invoice',
      action: 'reverse',
      paymentId: payment.id,
      apply: true,
    })
    expect((await getTransactionById('first'))?.is_receivable_payment).toBe(0)
    expect((await getTransactionById('second'))?.is_receivable_payment).toBe(1)
    expect(
      await previewConsumptionClassifications([
        { transactionId: 'first', builtinRole: 'earned_income' },
      ])
    ).toMatchObject({ applicable: true })
    await createSplits(
      'first',
      [
        { categoryId: 'sales', amount: 2000 },
        { categoryId: 'sales', amount: 2000 },
      ],
      4000
    )
    expect(
      state.db
        .prepare(
          "SELECT COUNT(*) AS count, SUM(amount) AS amount FROM transaction_splits WHERE transaction_id='first'"
        )
        .get()
    ).toEqual({ count: 2, amount: 4000 })
    expect(state.db.prepare("SELECT amount FROM transactions WHERE id='first'").get()).toEqual({
      amount: 4000,
    })
    expect(
      state.db.prepare('SELECT COUNT(*) AS count FROM receivable_payment_links').get()
    ).toEqual({ count: 2 })
  })
})
