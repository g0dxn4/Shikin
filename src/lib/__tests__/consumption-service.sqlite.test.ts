// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema'

const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db!.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db!.prepare(sql).run(...params).changes,
    lastInsertId: 0,
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

import {
  clearConsumptionClassification,
  readConsumptionClassificationContext,
  readNetConsumptionReport,
  setConsumptionClassification,
} from '../consumption-service'

function snapshot() {
  return {
    transactions: state.db!.prepare('SELECT * FROM transactions ORDER BY id').all(),
    classifications: state
      .db!.prepare('SELECT * FROM transaction_consumption_classifications ORDER BY id')
      .all(),
    audit: state.db!.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  }
}

function addTransaction(
  id: string,
  type: 'expense' | 'income',
  amount: number,
  date: string,
  category: string,
  currency = 'USD'
) {
  state
    .db!.prepare(
      'INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(id, 'account', category, type, amount, currency, `Synthetic ${id}`, date)
}

beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db!.exec(`
    INSERT INTO accounts (id, name, type, currency, balance) VALUES ('account', 'Synthetic', 'checking', 'USD', 0);
    INSERT INTO categories (id, name, type) VALUES
      ('food', 'Synthetic food', 'expense'),
      ('other', 'Synthetic other', 'income');
  `)
  addTransaction('purchase', 'expense', 1000, '2026-01-10', 'food')
  addTransaction('refund', 'income', 250, '2026-02-10', 'other')
})

afterEach(() => state.db?.close())

describe('frontend consumption service on SQLite', () => {
  it('sets stable audited roles, enforces references/caps, and attributes refunds on their posting date', async () => {
    const before = snapshot().transactions
    const purchase = await setConsumptionClassification({
      transactionId: 'purchase',
      role: 'purchase',
    })
    const same = await setConsumptionClassification({ transactionId: 'purchase', role: 'purchase' })
    expect(same.id).toBe(purchase.id)
    await setConsumptionClassification({
      transactionId: 'refund',
      role: 'refund',
      referencedPurchaseId: purchase.id,
    })
    expect(snapshot().transactions).toEqual(before)
    expect(snapshot().audit).toHaveLength(3)

    state
      .db!.prepare(
        "INSERT INTO source_coverage (id, account_id, source_namespace, period_start, period_end, status) VALUES ('coverage', 'account', 'bank', '2026-02-01', '2026-02-28', 'verified')"
      )
      .run()
    const report = await readNetConsumptionReport('2026-02-01', '2026-02-28')
    expect(report).toMatchObject({
      complete: true,
      totalsByCurrency: [{ currency: 'USD', consumptionCentavos: -250, earnedIncomeCentavos: 0 }],
      byCategory: [
        {
          currency: 'USD',
          categoryId: 'food',
          categoryName: 'Synthetic food',
          amountCentavos: -250,
        },
      ],
    })
    await expect(clearConsumptionClassification(purchase.id)).rejects.toThrow(/referencing/)
  })

  it('classifies split allocations independently with exact safe parent/category ownership', async () => {
    state.db!.exec(`
      INSERT INTO transaction_splits (id, transaction_id, category_id, amount) VALUES
        ('split-a', 'purchase', 'food', 400),
        ('split-b', 'purchase', 'food', 600);
    `)
    const context = await readConsumptionClassificationContext('purchase')
    expect(context.allocations.map((row) => [row.splitId, row.amountCentavos])).toEqual([
      ['split-a', 400],
      ['split-b', 600],
    ])
    await setConsumptionClassification({
      transactionId: 'purchase',
      splitId: 'split-a',
      role: 'purchase',
    })
    const report = await readNetConsumptionReport('2026-01-01', '2026-01-31')
    expect(report.classificationComplete).toBe(false)
    expect(report.unresolvedIds).toEqual(['split-b'])
    expect(report.totalsByCurrency[0].consumptionCentavos).toBe(400)
  })

  it('keeps reads write-free and rolls a classification back when audit insertion fails', async () => {
    const beforeRead = snapshot()
    await readNetConsumptionReport('2026-01-01', '2026-01-31')
    expect(snapshot()).toEqual(beforeRead)

    state.db!.exec(
      "CREATE TRIGGER reject_consumption_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END"
    )
    const beforeMutation = snapshot()
    await expect(
      setConsumptionClassification({ transactionId: 'purchase', role: 'purchase' })
    ).rejects.toThrow('synthetic audit failure')
    expect(snapshot()).toEqual(beforeMutation)
  })

  it('does not invalidate active payment capacity with a new purchase role', async () => {
    state.db!.exec(`
      INSERT INTO accounts (id, name, type, currency, balance) VALUES ('card', 'Synthetic card', 'credit_card', 'USD', 0);
      INSERT INTO credit_card_statements (id, account_id, statement_end_date, due_date, statement_balance)
      VALUES ('statement', 'card', '2026-01-31', '2026-02-15', 1000);
      INSERT INTO card_statement_payment_links
        (id, statement_id, transaction_id, original_statement_id, original_transaction_id, amount, mode)
      VALUES ('payment-link', 'statement', 'purchase', 'statement', 'purchase', 100, 'apply_to_unpaid');
    `)
    const before = snapshot()
    await expect(
      setConsumptionClassification({ transactionId: 'purchase', role: 'purchase' })
    ).rejects.toThrow(/Unlink active payments/)
    expect(snapshot()).toEqual(before)
  })

  it('rejects protected and receivable evidence without writing', async () => {
    state.db!.exec(`
      INSERT INTO receivables (id, payer, amount, currency, due_date, status, matched_transaction_id)
      VALUES ('receivable', 'Synthetic', 250, 'USD', '2026-02-10', 'received', 'refund');
    `)
    const before = snapshot()
    await expect(
      setConsumptionClassification({ transactionId: 'refund', role: 'earned_income' })
    ).rejects.toThrow(/protected/i)
    expect(snapshot()).toEqual(before)
  })
})
