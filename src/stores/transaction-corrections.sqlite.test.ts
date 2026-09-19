// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from '../../cli/src/backend-foundation-test-schema'
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db!.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db!.prepare(sql).run(...params).changes,
  })
  return {
    query,
    execute,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.db!.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({ query, execute })
        state.db!.exec('COMMIT')
        return result
      } catch (error) {
        state.db!.exec('ROLLBACK')
        throw error
      }
    },
  }
})
vi.mock('./account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: async () => {} }) },
}))
vi.mock('@/lib/auto-categorize', () => ({ learnFromTransaction: async () => {} }))
import { useTransactionStore } from './transaction-store'
import { createSplits, deleteSplits } from '@/lib/split-service'
const row = () =>
  state.db!.prepare("SELECT * FROM transactions WHERE id='tx'").get() as Record<string, unknown>
const data = () => ({
  amount: 10,
  type: 'expense' as const,
  description: 'Corrected',
  categoryId: 'food',
  accountId: 'a',
  transferToAccountId: null,
  currency: 'USD',
  date: '2026-01-01',
  notes: 'user correction',
})
beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(
    "INSERT INTO accounts (id,name,type,balance) VALUES ('a','Synthetic','checking',-1000); INSERT INTO categories (id,name,type) VALUES ('food','Synthetic food','expense'),('other','Synthetic other','expense'); INSERT INTO transactions (id,account_id,category_id,type,amount,currency,description,date,source,note,import_source,import_external_id,import_fingerprint,import_content_fingerprint) VALUES ('tx','a','food','expense',1000,'USD','Original','2026-01-01','original source','original note','bank','opaque','identity','content')"
  )
})
afterEach(() => state.db?.close())
describe('frontend shared correction policy on real SQLite', () => {
  it('edits finalized ordinary metadata from actual form path without touching evidence or balance', async () => {
    state.db!.exec(
      "INSERT INTO account_reconciliations (id,account_id,reconciliation_date,actual_balance,stored_balance_before,ledger_balance_before,ledger_balance_after,adjustment_amount,selection_mode) VALUES ('final','a','2026-01-31',-1000,-1000,-1000,-1000,0,'explicit_rows'); UPDATE transactions SET finalization_id='final' WHERE id='tx'"
    )
    const before = row()
    const balance = state.db!.prepare('SELECT * FROM accounts').all()
    await useTransactionStore.getState().update('tx', data())
    expect(row()).toEqual({
      ...before,
      description: 'Corrected',
      notes: 'user correction',
      updated_at: row().updated_at,
    })
    expect(state.db!.prepare('SELECT * FROM accounts').all()).toEqual(balance)
    await expect(
      useTransactionStore.getState().update('tx', { ...data(), amount: 20 })
    ).rejects.toThrow(/provenance/)
    await useTransactionStore.getState().updateReviewFields('tx', { categoryId: 'other' })
    expect(row().category_id).toBe('other')
  })
  it('guards direct split APIs and financial edits with classifications, permits safe metadata and audited unclassified replacements', async () => {
    const splits = [
      { categoryId: 'food', amount: 400 },
      { categoryId: 'other', amount: 600 },
    ]
    await createSplits('tx', splits, 1000)
    const splitId = (
      state.db!.prepare('SELECT id FROM transaction_splits ORDER BY amount').get() as { id: string }
    ).id
    state
      .db!.prepare(
        "INSERT INTO transaction_consumption_classifications (id,transaction_id,split_id,role) VALUES ('c','tx',?,'purchase')"
      )
      .run(splitId)
    const originalSplits = state.db!.prepare('SELECT * FROM transaction_splits').all()
    await useTransactionStore.getState().update('tx', data())
    await expect(createSplits('tx', splits, 1000)).rejects.toThrow(/classifications/)
    await expect(deleteSplits('tx')).rejects.toThrow(/classifications/)
    await expect(
      useTransactionStore.getState().correctMetadata('tx', { category_id: 'other' })
    ).rejects.toThrow(/split replacement/)
    await expect(useTransactionStore.getState().remove('tx')).rejects.toThrow(/classifications/)
    expect(state.db!.prepare('SELECT * FROM transaction_splits').all()).toEqual(originalSplits)
    state.db!.exec('DELETE FROM transaction_consumption_classifications')
    await useTransactionStore
      .getState()
      .correctMetadata('tx', { category_id: 'other', notes: null }, splits)
    expect(row()).toMatchObject({
      category_id: 'other',
      notes: null,
      source: 'original source',
      import_content_fingerprint: 'content',
    })
    expect(state.db!.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 4 })
  })
  it('does not falsely finalize leftover staged pending rows by legacy batch name', async () => {
    state.db!.exec(
      "INSERT INTO account_reconciliations (id,account_id,reconciliation_date,actual_balance,stored_balance_before,ledger_balance_before,ledger_balance_after,adjustment_amount,staging_batch_id) VALUES ('legacy','a','2026-01-31',0,0,0,0,0,'batch'); UPDATE transactions SET staging_batch_id='batch', ledger_treatment='staged_no_balance_impact', status='pending' WHERE id='tx'"
    )
    await useTransactionStore.getState().update('tx', { ...data(), amount: 20 })
    expect(row().amount).toBe(2000)
    expect(state.db!.prepare('SELECT balance FROM accounts').get()).toEqual({ balance: -1000 })
    state.db!.exec("UPDATE transactions SET ledger_treatment='normal', status='posted'")
    await expect(useTransactionStore.getState().update('tx', data())).rejects.toThrow(/provenance/)
  })
})
