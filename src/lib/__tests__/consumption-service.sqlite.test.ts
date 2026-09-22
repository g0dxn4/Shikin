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
  applyConsumptionClassifications,
  archiveClassificationType,
  createClassificationType,
  previewConsumptionClassifications,
  reviseClassificationType,
} from '../classification-type-service'
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
    expect(snapshot().audit).toHaveLength(2)

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

  it('rejects rolled, malformed, and inverted report dates before querying', async () => {
    const before = snapshot()
    await expect(readNetConsumptionReport('2026-02-31', '2026-02-31')).rejects.toThrow(
      'A valid report date range is required.'
    )
    await expect(readNetConsumptionReport('2026-13-01', '2026-13-01')).rejects.toThrow(
      'A valid report date range is required.'
    )
    await expect(readNetConsumptionReport('2026-02-01', '2026-01-31')).rejects.toThrow(
      'A valid report date range is required.'
    )
    await expect(readNetConsumptionReport('20260201', '2026-02-28')).rejects.toThrow(
      'A valid report date range is required.'
    )
    expect(snapshot()).toEqual(before)
  })

  it('manages immutable custom heads and atomically previews/applies pinned assignments', async () => {
    const created = await createClassificationType({
      name: '  Family support  ',
      financialTreatment: 'other_income',
    })
    const noOpBefore = {
      snapshot: snapshot(),
      revision: state.db!.prepare('SELECT * FROM app_data_state').all(),
      types: state.db!.prepare('SELECT * FROM classification_types').all(),
      revisions: state.db!.prepare('SELECT * FROM classification_type_revisions').all(),
    }
    await expect(
      reviseClassificationType({
        typeId: created.type.id,
        expectedRevisionId: created.revision.id,
        name: 'Family support',
        financialTreatment: 'other_income',
      })
    ).resolves.toMatchObject({ changed: false })
    expect({
      snapshot: snapshot(),
      revision: state.db!.prepare('SELECT * FROM app_data_state').all(),
      types: state.db!.prepare('SELECT * FROM classification_types').all(),
      revisions: state.db!.prepare('SELECT * FROM classification_type_revisions').all(),
    }).toEqual(noOpBefore)
    const preview = await previewConsumptionClassifications([
      {
        transactionId: 'refund',
        customTypeId: created.type.id,
        expectedRevisionId: created.revision.id,
      },
    ])
    expect(preview).toMatchObject({ applicable: true, changed: true })
    const digest = snapshot()
    const repeated = await previewConsumptionClassifications([
      {
        transactionId: 'refund',
        customTypeId: created.type.id,
        expectedRevisionId: created.revision.id,
      },
    ])
    expect(snapshot()).toEqual(digest)
    expect(repeated.previewToken).toBe(preview.previewToken)
    const applied = await applyConsumptionClassifications({
      targets: [
        {
          transactionId: 'refund',
          customTypeId: created.type.id,
          expectedRevisionId: created.revision.id,
        },
      ],
      previewToken: preview.previewToken,
    })
    expect(applied.batchId).toBeTruthy()
    const revised = await reviseClassificationType({
      typeId: created.type.id,
      expectedRevisionId: created.revision.id,
      name: 'Gift',
      financialTreatment: 'principal_recovery',
    })
    const context = await readConsumptionClassificationContext('refund')
    expect(context.allocations[0]).toMatchObject({
      classification: { type_revision_id: created.revision.id, role: 'other_income' },
      classificationDisplay: { name: 'Family support', version: 1 },
    })
    await archiveClassificationType({
      typeId: created.type.id,
      expectedRevisionId: revised.revision.id,
    })
    await expect(
      previewConsumptionClassifications([
        {
          transactionId: 'refund',
          customTypeId: created.type.id,
          expectedRevisionId: revised.revision.id,
        },
      ])
    ).resolves.toMatchObject({ applicable: false })
  })

  it('rolls an entire batch back when assignment auditing fails', async () => {
    const targets = [
      { transactionId: 'purchase', builtinRole: 'purchase' as const },
      { transactionId: 'refund', builtinRole: 'earned_income' as const },
    ]
    const preview = await previewConsumptionClassifications(targets)
    state.db!.exec(
      "CREATE TRIGGER reject_batch_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'batch-classify-consumption' BEGIN SELECT RAISE(ABORT, 'synthetic batch audit failure'); END"
    )
    const before = snapshot()
    await expect(
      applyConsumptionClassifications({ targets, previewToken: preview.previewToken })
    ).rejects.toThrow('synthetic batch audit failure')
    expect(snapshot()).toEqual(before)
  })

  it('rejects stale batch guards atomically', async () => {
    const preview = await previewConsumptionClassifications([
      { transactionId: 'purchase', builtinRole: 'purchase' },
      { transactionId: 'refund', builtinRole: 'earned_income' },
    ])
    state.db!.prepare("UPDATE transactions SET status='pending' WHERE id='refund'").run()
    const before = snapshot()
    await expect(
      applyConsumptionClassifications({
        targets: [
          { transactionId: 'purchase', builtinRole: 'purchase' },
          { transactionId: 'refund', builtinRole: 'earned_income' },
        ],
        previewToken: preview.previewToken,
      })
    ).rejects.toThrow(/invalid|stale/i)
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
