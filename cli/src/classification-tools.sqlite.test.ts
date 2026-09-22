// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db!.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db!.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => state.db!.transaction(fn).immediate(),
}))
vi.mock('./notebook.js', () => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  appendNote: vi.fn(),
  noteExists: vi.fn(),
  listNotes: vi.fn(),
}))
import { classificationTools } from './classification-tools.js'
const run = async (name: string, input: Record<string, unknown>) => {
  const tool = classificationTools.find((entry) => entry.name === name)!
  return tool.execute(tool.schema.parse(input))
}
function snapshot() {
  return {
    assignments: state
      .db!.prepare('SELECT * FROM transaction_consumption_classifications ORDER BY id')
      .all(),
    audit: state.db!.prepare('SELECT * FROM audit_log ORDER BY id').all(),
    revision: state.db!.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get(),
  }
}
beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db!.exec(`
    INSERT INTO accounts (id,name,type,currency,balance) VALUES ('a','A','checking','USD',0);
    INSERT INTO categories (id,name,type) VALUES ('expense','Expense','expense'),('income','Income','income');
    INSERT INTO transactions (id,account_id,category_id,type,amount,currency,description,date,status) VALUES
      ('purchase','a','expense','expense',100,'USD','P','2026-01-01','posted'),
      ('refund','a','income','income',100,'USD','R','2026-01-02','posted');
  `)
})
afterEach(() => state.db?.close())

describe('CLI classification catalog and batch services', () => {
  it('creates/revises/archives append-only types while preserving pinned history', async () => {
    const created = await run('create-classification-type', {
      name: ' Gift ',
      financialTreatment: 'other_income',
    })
    const preview = await run('preview-consumption-classifications', {
      allocations: [
        {
          transactionId: 'refund',
          customTypeId: created.type.id,
          expectedRevisionId: created.revision.id,
        },
      ],
    })
    const beforePreview = snapshot()
    const previewAgain = await run('preview-consumption-classifications', {
      allocations: [
        {
          transactionId: 'refund',
          customTypeId: created.type.id,
          expectedRevisionId: created.revision.id,
        },
      ],
    })
    expect(snapshot()).toEqual(beforePreview)
    expect(previewAgain.previewToken).toBe(preview.previewToken)
    await run('apply-consumption-classifications', {
      allocations: [
        {
          transactionId: 'refund',
          customTypeId: created.type.id,
          expectedRevisionId: created.revision.id,
        },
      ],
      previewToken: preview.previewToken,
    })
    const revised = await run('revise-classification-type', {
      typeId: created.type.id,
      expectedRevisionId: created.revision.id,
      name: 'Principal back',
      financialTreatment: 'principal_recovery',
    })
    const listed = await run('list-classification-types', { includeArchived: true })
    expect(listed.revisions).toHaveLength(2)
    expect(snapshot().assignments[0]).toMatchObject({
      type_revision_id: created.revision.id,
      role: 'other_income',
    })
    await run('archive-classification-type', {
      typeId: created.type.id,
      expectedRevisionId: revised.revision.id,
    })
    const invalid = await run('preview-consumption-classifications', {
      allocations: [
        {
          transactionId: 'refund',
          customTypeId: created.type.id,
          expectedRevisionId: revised.revision.id,
        },
      ],
    })
    expect(invalid.applicable).toBe(false)
  })

  it('rejects stale apply without partial writes and gives strict discovery effects', async () => {
    const preview = await run('preview-consumption-classifications', {
      allocations: [
        { transactionId: 'purchase', builtinRole: 'purchase' },
        { transactionId: 'refund', builtinRole: 'earned_income' },
      ],
    })
    state.db!.prepare("UPDATE transactions SET status='pending' WHERE id='refund'").run()
    const before = snapshot()
    await expect(
      run('apply-consumption-classifications', {
        allocations: [
          { transactionId: 'purchase', builtinRole: 'purchase' },
          { transactionId: 'refund', builtinRole: 'earned_income' },
        ],
        previewToken: preview.previewToken,
      })
    ).rejects.toThrow(/invalid|stale/i)
    expect(snapshot()).toEqual(before)
    expect(classificationTools).toHaveLength(6)
    expect(
      classificationTools.find((tool) => tool.name === 'preview-consumption-classifications')
        ?.effects
    ).toEqual({ readOnly: true, writesTo: [] })
  })
})
