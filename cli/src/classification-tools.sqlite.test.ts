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

  it('preserves prefixed existing IDs and materializes new allocations by allocation identity', async () => {
    const collidingPurchaseId = '__new__:["new-income",null]'
    state.db!.exec(`
      INSERT INTO transactions (id,account_id,category_id,type,amount,currency,description,date,status)
      VALUES ('new-income','a','income','income',100,'USD','N','2026-01-03','posted');
      INSERT INTO transaction_consumption_classifications
        (id,transaction_id,role,referenced_purchase_id)
      VALUES
        ('${collidingPurchaseId}','purchase','purchase',NULL),
        ('__new__:existing-refund','refund','other_income',NULL);
    `)
    const allocations = [
      {
        transactionId: 'refund',
        builtinRole: 'refund' as const,
        referencedPurchaseId: collidingPurchaseId,
      },
      { transactionId: 'new-income', builtinRole: 'earned_income' as const },
    ]
    const preview = await run('preview-consumption-classifications', { allocations })
    expect(preview).toMatchObject({ applicable: true, changed: true })
    expect(preview.items[0]).toMatchObject({
      before: { id: '__new__:existing-refund' },
      after: { id: '__new__:existing-refund', referenced_purchase_id: collidingPurchaseId },
    })
    expect(preview.items[1].after.id).not.toBe(collidingPurchaseId)

    const applied = await run('apply-consumption-classifications', {
      allocations,
      previewToken: preview.previewToken,
    })
    const newId = applied.items[1].after.id
    expect(applied.items[0]).toMatchObject({
      before: { id: '__new__:existing-refund' },
      after: { id: '__new__:existing-refund', referenced_purchase_id: collidingPurchaseId },
    })
    expect(newId).not.toBe(preview.items[1].after.id)
    expect(newId).not.toBe(collidingPurchaseId)
    expect(
      state
        .db!.prepare(
          'SELECT id,transaction_id,role,referenced_purchase_id FROM transaction_consumption_classifications ORDER BY transaction_id'
        )
        .all()
    ).toEqual([
      {
        id: newId,
        transaction_id: 'new-income',
        role: 'earned_income',
        referenced_purchase_id: null,
      },
      {
        id: collidingPurchaseId,
        transaction_id: 'purchase',
        role: 'purchase',
        referenced_purchase_id: null,
      },
      {
        id: '__new__:existing-refund',
        transaction_id: 'refund',
        role: 'refund',
        referenced_purchase_id: collidingPurchaseId,
      },
    ])
  })

  it('rolls back every assignment when batch auditing fails', async () => {
    const allocations = [
      { transactionId: 'purchase', builtinRole: 'purchase' as const },
      { transactionId: 'refund', builtinRole: 'earned_income' as const },
    ]
    const preview = await run('preview-consumption-classifications', { allocations })
    state.db!.exec(
      "CREATE TRIGGER reject_batch_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'batch-classify-consumption' BEGIN SELECT RAISE(ABORT, 'synthetic batch audit failure'); END"
    )
    const before = snapshot()

    await expect(
      run('apply-consumption-classifications', {
        allocations,
        previewToken: preview.previewToken,
      })
    ).rejects.toThrow('synthetic batch audit failure')
    expect(snapshot()).toEqual(before)
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
