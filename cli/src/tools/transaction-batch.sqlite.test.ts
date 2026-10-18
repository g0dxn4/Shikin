// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('../database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db!.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db!.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => state.db!.transaction(fn).immediate(),
}))
vi.mock('../notebook.js', () => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  appendNote: vi.fn(),
  noteExists: vi.fn(),
  listNotes: vi.fn(),
}))
import { transactionBatchTools } from './transaction-batch.js'
const tool = transactionBatchTools[0]!
const run = (input: Record<string, unknown>) => tool.execute(tool.schema.parse(input))
function snapshot() {
  return Object.fromEntries(
    ['transactions', 'transaction_splits', 'audit_log', 'accounts', 'app_data_state'].map(
      (table) => [table, state.db!.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]
    )
  )
}
beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT INTO accounts (id,name,type,currency,balance) VALUES ('checking','Checking','checking','MXN',100000);
    INSERT INTO categories (id,name,type) VALUES ('shopping','Synthetic Shopping','expense'),('home','Synthetic Home','expense'),('income','Synthetic Income','income');
    INSERT INTO subcategories (id,category_id,name) VALUES ('cleaning','home','Cleaning supplies');
  `)
  const insert = state.db.prepare(`INSERT INTO transactions
    (id,account_id,category_id,type,amount,currency,description,date,status,source,note,import_source,import_external_id)
    VALUES (?,'checking','shopping','expense',10000,'MXN',?,'2026-09-15','posted','bank statement','original bank evidence','synthetic-statement',?)`)
  for (let index = 0; index < 10; index++)
    insert.run(`amazon-${index}`, `Amazon purchase ${index}`, `bank-id-${index}`)
})
afterEach(() => state.db?.close())

describe('atomic transaction metadata workflow', () => {
  it('previews ten purchases without writes and applies all categories/subcategories in one transaction', async () => {
    const corrections = Array.from({ length: 10 }, (_, index) => ({
      transactionId: `amazon-${index}`,
      categoryId: 'home',
      subcategoryId: 'cleaning',
    }))
    const before = snapshot()
    const preview = await run({ corrections })
    expect(preview).toMatchObject({ success: true, dryRun: true, count: 10, changedCount: 10 })
    expect(snapshot()).toEqual(before)
    const result = await run({
      action: 'apply',
      corrections,
      previewToken: preview.previewToken,
      idempotencyKey: 'amazon-september',
    })
    expect(result).toMatchObject({ success: true, dryRun: false, count: 10, changedCount: 10 })
    const after = snapshot()
    expect(after.accounts).toEqual(before.accounts)
    expect(after.transactions).toEqual(
      (before.transactions as Record<string, unknown>[]).map((row) => ({
        ...row,
        category_id: 'home',
        subcategory_id: 'cleaning',
        updated_at: expect.any(String),
      }))
    )
    expect(after.audit_log).toHaveLength(11)
    expect(
      state
        .db!.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='correct-metadata'")
        .get()
    ).toEqual({ count: 10 })
  })

  it('returns a durable receipt on retries without repeating writes and rejects key reuse for different intent', async () => {
    const corrections = [{ transactionId: 'amazon-0', categoryId: 'home' }]
    const preview = await run({ corrections })
    const input = {
      action: 'apply',
      corrections,
      previewToken: preview.previewToken,
      idempotencyKey: 'retry-key',
    }
    const applied = await run(input)
    const after = snapshot()
    expect(await run(input)).toEqual({ ...applied, replayed: true })
    expect(snapshot()).toEqual(after)
    expect(
      await run({ ...input, corrections: [{ transactionId: 'amazon-1', categoryId: 'home' }] })
    ).toMatchObject({ success: false, reason: 'idempotency_conflict' })
    expect(snapshot()).toEqual(after)
  })

  it('rejects a stale database or changed intent before any write', async () => {
    const corrections = [{ transactionId: 'amazon-0', categoryId: 'home' }]
    const preview = await run({ corrections })
    state
      .db!.prepare("UPDATE transactions SET description='Corrected elsewhere' WHERE id='amazon-1'")
      .run()
    const before = snapshot()
    expect(
      await run({
        action: 'apply',
        corrections,
        previewToken: preview.previewToken,
        idempotencyKey: 'stale',
      })
    ).toMatchObject({ success: false, reason: 'stale_preview' })
    expect(snapshot()).toEqual(before)
  })

  it('rolls back every correction, audit row and revision when a later audit fails', async () => {
    const corrections = [
      { transactionId: 'amazon-0', categoryId: 'home' },
      { transactionId: 'amazon-1', categoryId: 'home' },
    ]
    const preview = await run({ corrections })
    state.db!.exec(`CREATE TRIGGER reject_second_batch_audit BEFORE INSERT ON audit_log
      WHEN NEW.entity_id='amazon-1' AND NEW.action='correct-metadata'
      BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`)
    const before = snapshot()
    await expect(
      run({
        action: 'apply',
        corrections,
        previewToken: preview.previewToken,
        idempotencyKey: 'rollback',
      })
    ).rejects.toThrow('synthetic audit failure')
    expect(snapshot()).toEqual(before)
  })

  it('uses existing split validation while preserving parent amount and import evidence', async () => {
    const corrections = [
      {
        transactionId: 'amazon-0',
        splits: [
          { categoryId: 'home', subcategoryId: 'cleaning', amountCentavos: 6000 },
          { categoryId: 'shopping', amountCentavos: 4000 },
        ],
      },
    ]
    const before = snapshot()
    const preview = await run({ corrections })
    await run({
      action: 'apply',
      corrections,
      previewToken: preview.previewToken,
      idempotencyKey: 'split',
    })
    expect(snapshot().accounts).toEqual(before.accounts)
    expect(
      state
        .db!.prepare(
          "SELECT amount,source,note,import_external_id FROM transactions WHERE id='amazon-0'"
        )
        .get()
    ).toEqual({
      amount: 10000,
      source: 'bank statement',
      note: 'original bank evidence',
      import_external_id: 'bank-id-0',
    })
    expect(
      state
        .db!.prepare(
          "SELECT SUM(amount) AS total FROM transaction_splits WHERE transaction_id='amazon-0'"
        )
        .get()
    ).toEqual({ total: 10000 })
    await expect(
      run({
        corrections: [
          {
            ...corrections[0],
            splits: [
              { categoryId: 'home', amountCentavos: 6000 },
              { categoryId: 'shopping', amountCentavos: 5000 },
            ],
          },
        ],
      })
    ).rejects.toThrow('Split amounts must equal')
  })

  it('rejects bank field changes, unknown fields, duplicates, wrong category direction and protected transfers', async () => {
    for (const field of ['amount', 'date', 'source', 'accountId', 'sql'])
      expect(() =>
        tool.schema.parse({ corrections: [{ transactionId: 'amazon-0', [field]: 'forbidden' }] })
      ).toThrow()
    const before = snapshot()
    await expect(
      run({
        corrections: [
          { transactionId: 'amazon-0', categoryId: 'home' },
          { transactionId: 'amazon-0', categoryId: 'shopping' },
        ],
      })
    ).rejects.toThrow('only once')
    await expect(
      run({ corrections: [{ transactionId: 'amazon-0', categoryId: 'income' }] })
    ).rejects.toThrow('direction')
    expect(snapshot()).toEqual(before)
    state.db!.prepare("UPDATE transactions SET is_archived=1 WHERE id='amazon-0'").run()
    await expect(
      run({ corrections: [{ transactionId: 'amazon-0', categoryId: 'home' }] })
    ).rejects.toThrow('Protected financial provenance')
  })

  it('does not generate per-transaction audit noise for an unchanged patch', async () => {
    const corrections = [{ transactionId: 'amazon-0', categoryId: 'shopping' }]
    const preview = await run({ corrections })
    expect(preview.changedCount).toBe(0)
    const result = await run({
      action: 'apply',
      corrections,
      previewToken: preview.previewToken,
      idempotencyKey: 'no-op',
    })
    expect(result.changedCount).toBe(0)
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 1 })
  })
})
