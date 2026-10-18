// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionClient } from '@/lib/database'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema'

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database, id: 0 }))
vi.mock('@/lib/ulid', () => ({ generateId: () => `ui-receipt-${++state.id}` }))
vi.mock('@/lib/database', () => ({
  withTransaction: async <T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> => {
    state.db.exec('BEGIN IMMEDIATE')
    try {
      const result = await callback({
        query: async <Row>(sql: string, params: unknown[] = []) =>
          state.db.prepare(sql).all(...params) as Row[],
        execute: async (sql: string, params: unknown[] = []) => {
          const result = state.db.prepare(sql).run(...params)
          return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
        },
      })
      state.db.exec('COMMIT')
      return result
    } catch (error) {
      state.db.exec('ROLLBACK')
      throw error
    }
  },
}))
import { changeReceivablePayment, readReceivablePayments } from '../receivable-payment-service'

function ledger() {
  return {
    accounts: state.db.prepare('SELECT * FROM accounts ORDER BY id').all(),
    transactions: state.db.prepare('SELECT * FROM transactions ORDER BY id').all(),
  }
}

beforeEach(() => {
  state.id = 0
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT INTO accounts (id, name, type, currency, balance) VALUES ('bank', 'Bank', 'checking', 'USD', 47000);
    INSERT INTO receivables (id, payer, amount, currency, due_date, status, account_id)
      VALUES ('invoice', 'Client', 20000, 'USD', '2026-10-20', 'open', 'bank');
    INSERT INTO transactions (id, account_id, type, amount, currency, description, date, status)
      VALUES ('first', 'bank', 'income', 8000, 'USD', 'First installment', '2026-10-01', 'posted'),
             ('last', 'bank', 'income', 12000, 'USD', 'Final installment', '2026-10-10', 'cleared'),
             ('pending', 'bank', 'income', 1000, 'USD', 'Expected only', '2026-10-12', 'pending');
  `)
})
afterEach(() => state.db.close())

describe('receivable browser/Tauri payment service on isolated SQLite', () => {
  it('reads posted bank candidates and previews a partial receipt without any database writes', async () => {
    const before = state.db.prepare('SELECT total_changes() AS changes').get()
    const view = await readReceivablePayments('invoice')
    expect(view.candidates.map((income) => income.id)).toEqual(['last', 'first'])
    expect(view.summary).toMatchObject({ receivedAmount: 0, remainingAmount: 20000 })
    expect(
      await changeReceivablePayment({
        receivableId: 'invoice',
        action: 'match',
        transactionId: 'first',
      })
    ).toMatchObject({
      changed: true,
      after: { receivedAmount: 8000, remainingAmount: 12000, status: 'partial' },
    })
    expect(state.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before)
  })

  it('rejects a stale preview, applies two installments, and safely replays a completed apply', async () => {
    const original = ledger()
    const firstInput = { receivableId: 'invoice', action: 'match' as const, transactionId: 'first' }
    const lastInput = { receivableId: 'invoice', action: 'match' as const, transactionId: 'last' }
    const firstPreview = await changeReceivablePayment(firstInput)
    const staleLastPreview = await changeReceivablePayment(lastInput)
    await changeReceivablePayment({ ...firstInput, apply: true, expectedToken: firstPreview.token })
    await expect(
      changeReceivablePayment({ ...lastInput, apply: true, expectedToken: staleLastPreview.token })
    ).rejects.toThrow(/changed.*Preview/)
    const freshLastPreview = await changeReceivablePayment(lastInput)
    await changeReceivablePayment({
      ...lastInput,
      apply: true,
      expectedToken: freshLastPreview.token,
    })
    const beforeReplay = state.db.prepare('SELECT total_changes() AS changes').get()
    expect(
      await changeReceivablePayment({
        ...lastInput,
        apply: true,
        expectedToken: freshLastPreview.token,
      })
    ).toMatchObject({
      changed: false,
      after: { status: 'received', receivedAmount: 20000, activePaymentCount: 2 },
    })
    expect(state.db.prepare('SELECT total_changes() AS changes').get()).toEqual(beforeReplay)
    expect((await readReceivablePayments('invoice')).candidates).toEqual([])
    expect(ledger()).toEqual(original)
  })

  it('rejects changed source evidence between preview and apply', async () => {
    const input = { receivableId: 'invoice', action: 'match' as const, transactionId: 'first' }
    const preview = await changeReceivablePayment(input)
    state.db.exec("UPDATE transactions SET amount = 7900 WHERE id = 'first'")
    await expect(
      changeReceivablePayment({ ...input, apply: true, expectedToken: preview.token })
    ).rejects.toThrow(/changed.*Preview/)
    expect((await readReceivablePayments('invoice')).summary.receivedAmount).toBe(0)
  })

  it('rolls back a failed reversal and retains the original bank snapshot after recovery', async () => {
    await changeReceivablePayment({
      receivableId: 'invoice',
      action: 'match',
      transactionId: 'first',
      apply: true,
    })
    await changeReceivablePayment({
      receivableId: 'invoice',
      action: 'match',
      transactionId: 'last',
      apply: true,
    })
    const before = await readReceivablePayments('invoice')
    const payment = before.payments.find((entry) => entry.transaction_id === 'first')!
    const input = { receivableId: 'invoice', action: 'reverse' as const, paymentId: payment.id }
    const preview = await changeReceivablePayment(input)
    state.db.exec(
      "CREATE TRIGGER fail_receipt_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END"
    )
    await expect(
      changeReceivablePayment({ ...input, apply: true, expectedToken: preview.token })
    ).rejects.toThrow(/injected audit failure/)
    expect(await readReceivablePayments('invoice')).toEqual(before)
    state.db.exec('DROP TRIGGER fail_receipt_audit')
    await changeReceivablePayment({ ...input, apply: true, expectedToken: preview.token })
    const after = await readReceivablePayments('invoice')
    expect(after.summary).toMatchObject({
      receivedAmount: 12000,
      status: 'partial',
      matchedTransactionId: 'last',
    })
    expect(after.payments.find((entry) => entry.id === payment.id)).toMatchObject({
      transaction_snapshot_json: payment.transaction_snapshot_json,
      reversal_source: 'frontend',
      reversed_at: expect.any(String),
    })
    expect(
      await changeReceivablePayment({ ...input, apply: true, expectedToken: preview.token })
    ).toMatchObject({ changed: false })
    state.db.exec(
      "UPDATE transactions SET description = 'Corrected bank description' WHERE id = 'first'"
    )
    expect(
      (await readReceivablePayments('invoice')).payments.find((entry) => entry.id === payment.id)!
        .transaction_snapshot_json
    ).toBe(payment.transaction_snapshot_json)
  })
})
