// @vitest-environment node
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import type { TransactionClient } from '@/lib/database'
import type { ParsedTransaction } from '@/lib/statement-parser'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema'

const { databaseState, mockParseStatement } = vi.hoisted(() => ({
  databaseState: { current: null as unknown },
  mockParseStatement: vi.fn(),
}))

vi.mock('@/lib/database', () => ({
  withTransaction: async <T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> => {
    const db = databaseState.current as BetterSqlite3.Database
    const tx: TransactionClient = {
      query: async <Row>(sql: string, bindValues: unknown[] = []) =>
        db.prepare(sql).all(...bindValues) as Row[],
      execute: async (sql: string, bindValues: unknown[] = []) => {
        const result = db.prepare(sql).run(...bindValues)
        return {
          rowsAffected: result.changes,
          lastInsertId: Number(result.lastInsertRowid),
        }
      },
    }

    db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(tx)
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  },
}))

vi.mock('@/lib/statement-parser', () => ({
  parseStatement: mockParseStatement,
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: vi.fn() }) },
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: vi.fn() }) },
}))

import { importStatementFile, previewStatementFile } from '../statement-import'
import {
  finalizeAccountStatementHistory,
  previewAccountStatementFinalization,
  setAccountSourceCoverage,
  settleAccountStagedTransactions,
} from '../account-reconciliation-service'

const actualStatementParser = await vi.importActual<{
  parseStatement: (content: string, filename: string) => ParsedTransaction[]
}>('../statement-parser')

const requireFromCli = createRequire(resolve(process.cwd(), 'cli/package.json'))
const Database = requireFromCli('better-sqlite3') as typeof BetterSqlite3
let db: BetterSqlite3.Database

function createCurrentImportSchema(database: BetterSqlite3.Database): void {
  database.pragma('foreign_keys = ON')
  runHostedTestMigrations(database)
  database
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived, account_mode)
       VALUES (?, ?, ?, ?, ?, 0, 'transactional')`
    )
    .run('account-1', 'Checking', 'checking', 'USD', 10_000)
  database.prepare('UPDATE app_data_state SET data_revision = 0 WHERE id = 1').run()
}

function statementFile(name = 'statement.ofx', content = 'parsed by test mock'): File {
  return new File([content], name, { type: 'application/xml' })
}

function tableRows(table: string): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]
}

function databaseSnapshot(): Record<string, Record<string, unknown>[]> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  return Object.fromEntries(tables.map(({ name }) => [name, tableRows(name)]))
}

function financeSnapshot() {
  return {
    accounts: tableRows('accounts'),
    accountBalanceHistory: tableRows('account_balance_history'),
    netWorthSnapshots: tableRows('net_worth_snapshots'),
  }
}

function insertExistingTransaction({
  id = 'existing-1',
  type = 'expense',
  amount = 1000,
  currency = 'USD',
  description = 'Existing row',
  date = '2026-07-13',
  importSource = null,
  importExternalId = null,
}: {
  id?: string
  type?: 'income' | 'expense'
  amount?: number
  currency?: string
  description?: string
  date?: string
  importSource?: string | null
  importExternalId?: string | null
} = {}): void {
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, type, amount, currency, description, date,
       import_source, import_external_id
     ) VALUES (?, 'account-1', ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, type, amount, currency, description, date, importSource, importExternalId)
}

beforeEach(() => {
  db = new Database(':memory:')
  databaseState.current = db
  createCurrentImportSchema(db)
  mockParseStatement.mockReset()
})

afterEach(() => {
  databaseState.current = null
  db.close()
})

describe('importStatementFile real schema 021 SQLite rollback and staging', () => {
  it('keeps posted plus normal as the backwards-compatible default', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 12.25,
        description: 'Default expense',
        type: 'expense',
      },
    ])
    const statement = statementFile()
    const preview = await previewStatementFile(statement, 'account-1')

    expect(preview).toMatchObject({
      success: true,
      treatment: 'posted',
      stagingBatchId: null,
      stagedCount: 0,
      pendingCount: 0,
      balanceImpactCentavos: -1225,
      accountCurrency: 'USD',
    })
    expect(await importStatementFile(statement, 'account-1')).toMatchObject({
      imported: 1,
      skipped: 0,
      errors: [],
    })
    expect(
      db
        .prepare('SELECT status, ledger_treatment, staging_batch_id FROM transactions LIMIT 1')
        .get()
    ).toEqual({
      status: 'posted',
      ledger_treatment: 'normal',
      staging_batch_id: null,
    })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 8_775,
    })
  })

  it('stages posted history under one deterministic batch without any finance table changes', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2025-01-10',
        amount: 10,
        description: 'History expense',
        type: 'expense',
      },
      {
        date: '2025-01-11',
        amount: 25,
        description: 'History income',
        type: 'income',
      },
    ])
    const statement = statementFile('history.ofx', 'stable history bytes')
    const before = financeSnapshot()
    const firstPreview = await previewStatementFile(statement, 'account-1', [], {
      treatment: 'staged_posted',
    })
    const secondPreview = await previewStatementFile(statement, 'account-1', [], {
      treatment: 'staged_posted',
    })

    expect(firstPreview).toMatchObject({
      success: true,
      treatment: 'staged_posted',
      stagedCount: 2,
      pendingCount: 0,
      balanceImpactCentavos: 0,
    })
    expect(firstPreview.stagingBatchId).toMatch(/^statement-import-/)
    expect(secondPreview.stagingBatchId).toBe(firstPreview.stagingBatchId)
    expect(secondPreview.previewToken).toBe(firstPreview.previewToken)

    const result = await importStatementFile(statement, 'account-1', {
      previewToken: firstPreview.previewToken!,
      treatment: 'staged_posted',
    })
    expect(result).toMatchObject({ imported: 2, skipped: 0, errors: [] })
    expect(financeSnapshot()).toEqual(before)
    expect(
      db
        .prepare(
          `SELECT status, ledger_treatment, staging_batch_id, import_source,
                  import_fingerprint, import_content_fingerprint
             FROM transactions ORDER BY date`
        )
        .all()
    ).toEqual([
      {
        status: 'posted',
        ledger_treatment: 'staged_no_balance_impact',
        staging_batch_id: firstPreview.stagingBatchId,
        import_source: 'statement:ofx',
        import_fingerprint: expect.any(String),
        import_content_fingerprint: expect.stringMatching(/^sha256:/),
      },
      {
        status: 'posted',
        ledger_treatment: 'staged_no_balance_impact',
        staging_batch_id: firstPreview.stagingBatchId,
        import_source: 'statement:ofx',
        import_fingerprint: expect.any(String),
        import_content_fingerprint: expect.stringMatching(/^sha256:/),
      },
    ])
    const audits = db
      .prepare("SELECT after_json FROM audit_log WHERE entity='transaction' ORDER BY rowid")
      .all() as Array<{ after_json: string }>
    expect(audits).toHaveLength(2)
    expect(audits.map(({ after_json }) => JSON.parse(after_json))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transaction: expect.objectContaining({
            status: 'posted',
            ledgerTreatment: 'staged_no_balance_impact',
            stagingBatchId: firstPreview.stagingBatchId,
          }),
          balance: expect.objectContaining({ deltaCentavos: 0 }),
        }),
      ])
    )
    expect(
      (
        db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get() as {
          data_revision: number
        }
      ).data_revision
    ).toBeGreaterThan(0)
  })

  it('requires deliberate acknowledgement before staging pending holds', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2025-01-10',
        amount: 10,
        description: 'Not interpreted',
        type: 'expense',
      },
    ])
    const statement = statementFile('holds.qfx')
    const rejected = await previewStatementFile(statement, 'account-1', [], {
      treatment: 'staged_pending',
      stagingBatchId: 'holds-jan',
    })
    expect(rejected.errors[0]).toMatch(/explicit operator acknowledgement/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })

    const preview = await previewStatementFile(statement, 'account-1', [], {
      treatment: 'staged_pending',
      stagingBatchId: ' holds-jan ',
      acknowledgePending: true,
    })
    expect(preview).toMatchObject({
      success: true,
      treatment: 'staged_pending',
      stagingBatchId: 'holds-jan',
      stagedCount: 1,
      pendingCount: 1,
      balanceImpactCentavos: 0,
    })
    expect(
      await importStatementFile(statement, 'account-1', {
        previewToken: preview.previewToken!,
        treatment: 'staged_pending',
        stagingBatchId: 'holds-jan',
        acknowledgePending: true,
      })
    ).toMatchObject({ imported: 1, errors: [] })
    expect(
      db.prepare('SELECT status, ledger_treatment, staging_batch_id FROM transactions').get()
    ).toEqual({
      status: 'pending',
      ledger_treatment: 'staged_no_balance_impact',
      staging_batch_id: 'holds-jan',
    })
  })

  it('binds status, ledger treatment, and batch to the reviewed token', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2025-01-10',
        amount: 10,
        description: 'Bound treatment',
        type: 'expense',
      },
    ])
    const statement = statementFile()
    const preview = await previewStatementFile(statement, 'account-1', [], {
      treatment: 'staged_posted',
      stagingBatchId: 'batch-a',
    })

    for (const changed of [
      { treatment: 'posted' as const },
      { treatment: 'staged_posted' as const, stagingBatchId: 'batch-b' },
      {
        treatment: 'staged_pending' as const,
        stagingBatchId: 'batch-a',
        acknowledgePending: true,
      },
    ]) {
      const result = await importStatementFile(statement, 'account-1', {
        previewToken: preview.previewToken!,
        ...changed,
      })
      expect(result.errors[0]).toMatch(/stale|does not match/i)
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
  })

  it('does not relabel or financially rewrite an existing identity under changed options', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2025-01-10',
        amount: 10,
        description: 'Stable identity',
        type: 'expense',
        externalId: 'same-row',
      },
    ])
    const statement = statementFile()
    expect(await importStatementFile(statement, 'account-1')).toMatchObject({
      imported: 1,
    })
    const before = {
      row: db.prepare('SELECT * FROM transactions').get(),
      finance: financeSnapshot(),
    }

    expect(
      await importStatementFile(statement, 'account-1', {
        treatment: 'staged_pending',
        stagingBatchId: 'attempted-conversion',
        acknowledgePending: true,
      })
    ).toMatchObject({ imported: 0, skipped: 1, errors: [] })
    expect(db.prepare('SELECT * FROM transactions').get()).toEqual(before.row)
    expect(financeSnapshot()).toEqual(before.finance)
  })

  it('feeds imported staged rows through explicit settlement and finalization', async () => {
    db.prepare("UPDATE accounts SET balance=0 WHERE id='account-1'").run()
    mockParseStatement.mockReturnValueOnce([
      {
        date: '2025-01-10',
        amount: 10,
        description: 'Posted history',
        type: 'expense',
        externalId: 'posted-history',
      },
    ])
    expect(
      await importStatementFile(statementFile('posted.ofx'), 'account-1', {
        treatment: 'staged_posted',
        stagingBatchId: 'jan-history',
      })
    ).toMatchObject({ imported: 1, errors: [] })
    mockParseStatement.mockReturnValueOnce([
      {
        date: '2025-01-11',
        amount: 5,
        description: 'Pending hold',
        type: 'expense',
        externalId: 'pending-hold',
      },
    ])
    expect(
      await importStatementFile(statementFile('pending.qfx'), 'account-1', {
        treatment: 'staged_pending',
        stagingBatchId: 'jan-holds',
        acknowledgePending: true,
      })
    ).toMatchObject({ imported: 1, errors: [] })
    const imported = db
      .prepare('SELECT id, status FROM transactions ORDER BY date')
      .all() as Array<{ id: string; status: string }>
    expect(imported.map((row) => row.status)).toEqual(['posted', 'pending'])

    await settleAccountStagedTransactions({
      accountId: 'account-1',
      transactionIds: [imported[1].id],
      status: 'cleared',
      source: 'statement-import-test',
    })
    const coverageIds: string[] = []
    for (const sourceNamespace of ['statement:ofx', 'statement:qfx']) {
      coverageIds.push(
        (
          await setAccountSourceCoverage({
            accountId: 'account-1',
            sourceNamespace,
            periodStart: '2025-01-01',
            periodEnd: '2025-01-31',
            status: 'verified',
            documentRef: 'synthetic January statement',
          })
        ).coverage.id
      )
    }
    const input = {
      accountId: 'account-1',
      transactionIds: imported.map((row) => row.id),
      coverageIds,
      statementStartDate: '2025-01-01',
      statementEndDate: '2025-01-31',
      actualBalanceCentavos: -1500,
    }
    const preview = await previewAccountStatementFinalization(input)
    const finalized = await finalizeAccountStatementHistory({
      ...input,
      previewToken: preview.previewToken,
    })

    expect(finalized.adjustmentTransactionId).toBeNull()
    expect(
      db
        .prepare('SELECT status, ledger_treatment, finalization_id FROM transactions ORDER BY date')
        .all()
    ).toEqual([
      {
        status: 'posted',
        ledger_treatment: 'normal',
        finalization_id: finalized.reconciliationId,
      },
      {
        status: 'cleared',
        ledger_treatment: 'normal',
        finalization_id: finalized.reconciliationId,
      },
    ])
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: -1500,
    })
  })

  it('rolls back an earlier insert when a later insert fails', async () => {
    db.exec(`
      CREATE TRIGGER fail_later_statement_insert
      BEFORE INSERT ON transactions
      FOR EACH ROW WHEN NEW.description = 'Failing row'
      BEGIN
        SELECT RAISE(ABORT, 'later insert failed');
      END;
    `)
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Earlier row',
        type: 'expense',
      },
      {
        date: '2026-07-14',
        amount: 20,
        description: 'Failing row',
        type: 'expense',
      },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toMatchObject({ imported: 0, skipped: 0 })
    expect(result.errors[0]).toContain('later insert failed')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get('account-1')).toEqual({
      balance: 10_000,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 0,
    })
  })

  it('imports legitimate repeated statement rows using their occurrence fingerprints', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Coffee',
        type: 'expense',
      },
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Coffee',
        type: 'expense',
      },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toMatchObject({ imported: 2, skipped: 0, errors: [] })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 2 })
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get('account-1')).toEqual({
      balance: 8_000,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 2 })
    const audits = db
      .prepare(
        "SELECT before_json, after_json FROM audit_log WHERE entity='transaction' ORDER BY created_at, id"
      )
      .all() as Array<{ before_json: string; after_json: string }>
    expect(audits.every((audit) => audit.before_json === 'null')).toBe(true)
    expect(JSON.parse(audits[0].after_json)).toMatchObject({
      transaction: {
        importSource: 'statement:ofx',
        importExternalId: null,
        importFingerprint: expect.any(String),
        importContentFingerprint: expect.stringMatching(/^sha256:/),
      },
    })
  })

  it('strictly binds preview tokens to the durable data revision', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Bound row',
        type: 'expense',
        externalId: 'opaque-001',
      },
    ])
    const statement = statementFile()
    const preview = await previewStatementFile(statement, 'account-1')
    expect(preview).toMatchObject({ success: true, imported: 1, skipped: 0 })
    expect(preview.previewToken).toMatch(/^sha256:/)

    db.prepare('UPDATE app_data_state SET data_revision = data_revision + 1 WHERE id = 1').run()
    const result = await importStatementFile(statement, 'account-1', {
      previewToken: preview.previewToken!,
    })

    expect(result).toMatchObject({
      imported: 0,
      skipped: 0,
      mode: 'reviewed_atomic',
    })
    expect(result.errors[0]).toContain('stale')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get('account-1')).toEqual({
      balance: 10_000,
    })
  })

  it('keeps source identity idempotent after metadata edits and rejects changed financial content', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Original source description',
        type: 'expense',
        externalId: 'Case-Sensitive-01',
      },
    ])
    expect(await importStatementFile(statementFile(), 'account-1')).toMatchObject({
      imported: 1,
      skipped: 0,
      errors: [],
    })
    db.prepare("UPDATE transactions SET description = 'User edited metadata'").run()

    expect(await importStatementFile(statementFile(), 'account-1')).toMatchObject({
      imported: 0,
      skipped: 1,
      errors: [],
    })
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 11,
        description: 'Original source description',
        type: 'expense',
        externalId: 'Case-Sensitive-01',
      },
    ])
    const conflict = await importStatementFile(statementFile(), 'account-1')
    expect(conflict).toMatchObject({ imported: 0, skipped: 0 })
    expect(conflict.errors[0]).toContain('changed financial content')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get('account-1')).toEqual({
      balance: 9_000,
    })
  })

  it('rolls back every insert when the final balance update fails', async () => {
    db.exec(`
      CREATE TRIGGER fail_statement_balance_update
      BEFORE UPDATE OF balance ON accounts
      FOR EACH ROW WHEN NEW.id = 'account-1'
      BEGIN
        SELECT RAISE(ABORT, 'final balance update failed');
      END;
    `)
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Expense',
        type: 'expense',
      },
      { date: '2026-07-14', amount: 25, description: 'Income', type: 'income' },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toMatchObject({ imported: 0, skipped: 0 })
    expect(result.errors[0]).toContain('final balance update failed')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get('account-1')).toEqual({
      balance: 10_000,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 0,
    })
  })

  it('applies a mixed multi-row balance exactly once', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 12.25,
        description: 'Groceries',
        type: 'expense',
      },
      { date: '2026-07-14', amount: 30, description: 'Refund', type: 'income' },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toMatchObject({ imported: 2, skipped: 0, errors: [] })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 11_775,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 2 })
  })

  it('requires review for an identified incoming row against unbound legacy evidence and exposes locked display metadata', async () => {
    insertExistingTransaction({
      id: 'legacy-1',
      description: 'Existing private label',
    })
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Incoming source label',
        type: 'expense',
        externalId: 'incoming-id',
      },
    ])

    const preview = await previewStatementFile(statementFile(), 'account-1')

    expect(preview).toMatchObject({ success: false, imported: 1, skipped: 0 })
    expect(preview.requiredDecisions).toHaveLength(1)
    expect(preview.reviewCandidates).toEqual([
      {
        candidateIdentityKey: preview.requiredDecisions[0].candidateIdentityKey,
        existingTransactionId: 'legacy-1',
        incoming: {
          rowIndex: 0,
          date: '2026-07-13',
          description: 'Incoming source label',
          type: 'expense',
          amountCentavos: 1000,
          currency: 'USD',
        },
        existing: {
          id: 'legacy-1',
          date: '2026-07-13',
          description: 'Existing private label',
          type: 'expense',
          amountCentavos: 1000,
          currency: 'USD',
        },
      },
    ])
    expect(preview.limitations).toContain(
      'Statement source did not declare a currency; amounts are assumed to be USD.'
    )
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
  })

  it('bypasses fuzzy review for distinct IDs in the same trimmed namespace and discriminates type and currency', async () => {
    insertExistingTransaction({
      id: 'verified-other',
      importSource: ' statement:ofx ',
      importExternalId: 'other-id',
    })
    insertExistingTransaction({ id: 'other-type', type: 'income' })
    insertExistingTransaction({ id: 'other-currency', currency: 'EUR' })
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Incoming',
        type: 'expense',
        externalId: 'incoming-id',
      },
    ])

    const preview = await previewStatementFile(statementFile(), 'account-1')

    expect(preview).toMatchObject({
      success: true,
      imported: 1,
      requiredDecisions: [],
    })
    expect(preview.reviewCandidates).toEqual([])
  })

  it('requires review for financially matching rows with different IDs across sources', async () => {
    insertExistingTransaction({
      id: 'source-a-row',
      importSource: 'sourceA',
      importExternalId: 'source-a-id',
    })
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Incoming source B row',
        type: 'expense',
        externalId: 'source-b-id',
      },
    ])

    const preview = await previewStatementFile(statementFile(), 'account-1')

    expect(preview).toMatchObject({ success: false, imported: 1, skipped: 0 })
    expect(preview.requiredDecisions).toEqual([
      expect.objectContaining({ existingTransactionId: 'source-a-row' }),
    ])
    expect(preview.reviewCandidates).toEqual([
      expect.objectContaining({ existingTransactionId: 'source-a-row' }),
    ])
    expect(await importStatementFile(statementFile(), 'account-1')).toMatchObject({
      imported: 0,
      skipped: 0,
      errors: [expect.stringMatching(/require reviewed decisions/i)],
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 10_000,
    })
    expect(
      db
        .prepare(
          "SELECT import_source, import_external_id FROM transactions WHERE id='source-a-row'"
        )
        .get()
    ).toEqual({ import_source: 'sourceA', import_external_id: 'source-a-id' })
  })

  it('reviews identical OFX and QFX FITIDs and atomically keeps the existing transaction', async () => {
    mockParseStatement.mockImplementation(actualStatementParser.parseStatement)
    const payload = `<OFX><STMTRS><CURDEF>USD
<STMTTRN><DTPOSTED>20260713<TRNAMT>-10.00<FITID>same-fitid<NAME>Shared OFX payload</STMTTRN>
</STMTRS></OFX>`
    const ofx = statementFile('statement.ofx', payload)
    const qfx = statementFile('statement.qfx', payload)
    expect(await importStatementFile(ofx, 'account-1')).toMatchObject({
      imported: 1,
      skipped: 0,
      errors: [],
    })

    const undecided = await previewStatementFile(qfx, 'account-1')

    expect(undecided).toMatchObject({ success: false, imported: 1, skipped: 0 })
    expect(undecided.requiredDecisions).toEqual([
      expect.objectContaining({ existingTransactionId: expect.any(String) }),
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 9_000,
    })
    expect(db.prepare('SELECT import_source, import_external_id FROM transactions').get()).toEqual({
      import_source: 'statement:ofx',
      import_external_id: 'same-fitid',
    })

    expect(await importStatementFile(qfx, 'account-1')).toMatchObject({
      imported: 0,
      skipped: 0,
      errors: [expect.stringMatching(/require reviewed decisions/i)],
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 9_000,
    })

    const decisions = [{ ...undecided.requiredDecisions[0], decision: 'keep_existing' as const }]
    const reviewed = await previewStatementFile(qfx, 'account-1', decisions)
    const applied = await importStatementFile(qfx, 'account-1', {
      previewToken: reviewed.previewToken!,
      decisions,
    })

    expect(applied).toMatchObject({
      imported: 0,
      skipped: 1,
      errors: [],
      mode: 'reviewed_atomic',
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 9_000,
    })
    expect(db.prepare('SELECT decision FROM duplicate_review_decisions').get()).toEqual({
      decision: 'keep_existing',
    })
    expect(db.prepare('SELECT import_source, import_external_id FROM transactions').get()).toEqual({
      import_source: 'statement:ofx',
      import_external_id: 'same-fitid',
    })
  })

  it('audits a reviewed keep-existing decision without creating a transaction', async () => {
    insertExistingTransaction({ id: 'legacy-keep' })
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Incoming',
        type: 'expense',
        externalId: 'incoming-id',
      },
    ])
    const statement = statementFile()
    const undecided = await previewStatementFile(statement, 'account-1')
    const decisions = [{ ...undecided.requiredDecisions[0], decision: 'keep_existing' as const }]
    const reviewed = await previewStatementFile(statement, 'account-1', decisions)

    const result = await importStatementFile(statement, 'account-1', {
      previewToken: reviewed.previewToken!,
      decisions,
    })

    expect(result).toMatchObject({ imported: 0, skipped: 1, errors: [] })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT decision FROM duplicate_review_decisions').get()).toEqual({
      decision: 'keep_existing',
    })
    const audit = db
      .prepare('SELECT entity, action, before_json, after_json FROM audit_log')
      .get() as Record<string, string>
    expect(audit).toMatchObject({
      entity: 'duplicate_review_decision',
      action: 'review-import-duplicate',
      before_json: 'null',
    })
    expect(JSON.parse(audit.after_json)).toMatchObject({
      existingTransactionId: 'legacy-keep',
      decision: 'keep_existing',
    })
  })

  it('rolls back reviewed decision evidence and revision when its audit insert fails', async () => {
    insertExistingTransaction({ id: 'legacy-audit-failure' })
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Incoming',
        type: 'expense',
        externalId: 'incoming-id',
      },
    ])
    const statement = statementFile()
    const undecided = await previewStatementFile(statement, 'account-1')
    const decisions = [{ ...undecided.requiredDecisions[0], decision: 'keep_existing' as const }]
    const reviewed = await previewStatementFile(statement, 'account-1', decisions)
    db.exec(`
      CREATE TRIGGER fail_decision_audit BEFORE INSERT ON audit_log
      WHEN NEW.entity = 'duplicate_review_decision'
      BEGIN SELECT RAISE(ABORT, 'decision audit failed'); END;
    `)

    const result = await importStatementFile(statement, 'account-1', {
      previewToken: reviewed.previewToken!,
      decisions,
    })

    expect(result.errors[0]).toContain('decision audit failed')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM duplicate_review_decisions').get()).toEqual({
      count: 0,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 1,
    })
  })

  it('commits an all-duplicate source-identity no-op without balance or audit changes', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'One row',
        type: 'expense',
        externalId: 'source-id',
      },
    ])
    expect(await importStatementFile(statementFile(), 'account-1')).toMatchObject({ imported: 1 })
    const balanceAfterFirst = db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()
    const auditCountAfterFirst = db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()

    expect(await importStatementFile(statementFile(), 'account-1')).toMatchObject({
      imported: 0,
      skipped: 1,
      errors: [],
    })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual(
      balanceAfterFirst
    )
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual(
      auditCountAfterFirst
    )
  })

  it('rejects snapshot-only accounts before any write', async () => {
    db.prepare("UPDATE accounts SET account_mode='snapshot_only' WHERE id='account-1'").run()
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Blocked',
        type: 'expense',
      },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toMatchObject({ imported: 0, skipped: 0 })
    expect(result.errors[0]).toMatch(/snapshot-only/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
  })

  it('rolls back transactions, audits, revision, and account state when the guarded update affects zero rows', async () => {
    db.exec(`
      CREATE TRIGGER archive_during_import AFTER INSERT ON transactions
      WHEN NEW.description = 'Archive account'
      BEGIN UPDATE accounts SET is_archived=1 WHERE id=NEW.account_id; END;
    `)
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Archive account',
        type: 'income',
      },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.errors[0]).toContain('account update affected 0 rows')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 0,
    })
    expect(
      db.prepare("SELECT is_archived, balance FROM accounts WHERE id='account-1'").get()
    ).toEqual({
      is_archived: 0,
      balance: 10_000,
    })
  })

  it.each([
    { name: 'positive', type: 'income' as const },
    { name: 'negative', type: 'expense' as const },
  ])('rejects an unsafe $name aggregate and rolls back every effect', async ({ type }) => {
    db.prepare("UPDATE accounts SET balance=0 WHERE id='account-1'").run()
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: Number.MAX_SAFE_INTEGER / 100,
        description: 'At limit',
        type,
      },
      { date: '2026-07-14', amount: 0.01, description: 'Overflow', type },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.errors[0]).toMatch(/safe integer range/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 1,
    })
  })

  it('rejects an unsafe staged aggregate instead of using zero balance impact as a loophole', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: Number.MAX_SAFE_INTEGER / 100,
        description: 'At limit',
        type: 'income',
      },
      {
        date: '2026-07-14',
        amount: 0.01,
        description: 'Overflow',
        type: 'income',
      },
    ])

    const result = await importStatementFile(statementFile(), 'account-1', {
      treatment: 'staged_posted',
    })

    expect(result.errors[0]).toMatch(/safe integer range/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(financeSnapshot().accounts[0]).toMatchObject({ balance: 10_000 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
  })

  it('rejects a safe row that would overflow the current near-limit balance', async () => {
    const openingBalance = Number.MAX_SAFE_INTEGER - 5
    db.prepare("UPDATE accounts SET balance=? WHERE id='account-1'").run(openingBalance)
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 0.1,
        description: 'Overflow',
        type: 'income',
      },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.errors[0]).toMatch(/resulting balance.*safe integer/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: openingBalance,
    })
  })

  it('rolls back the transaction when its required audit insert fails', async () => {
    db.exec(`
      CREATE TRIGGER fail_statement_audit BEFORE INSERT ON audit_log
      BEGIN SELECT RAISE(ABORT, 'statement audit failed'); END;
    `)
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'Audited row',
        type: 'expense',
      },
    ])
    const before = databaseSnapshot()

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.errors[0]).toContain('statement audit failed')
    expect(databaseSnapshot()).toEqual(before)
  })

  it('rejects known source/account currency mismatch and discloses an absent source currency assumption', async () => {
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'USD row',
        type: 'expense',
        currency: 'USD',
      },
    ])
    db.prepare("UPDATE accounts SET currency='MXN' WHERE id='account-1'").run()

    const mismatch = await previewStatementFile(statementFile(), 'account-1')
    expect(mismatch).toMatchObject({
      success: false,
      reviewCandidates: [],
      limitations: [],
    })
    expect(mismatch.errors[0]).toContain(
      'Statement currency USD does not match account currency MXN'
    )
    const rejectedApply = await importStatementFile(statementFile(), 'account-1')
    expect(rejectedApply.errors[0]).toContain(
      'Statement currency USD does not match account currency MXN'
    )
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 1,
    })

    db.prepare("UPDATE accounts SET currency='USD' WHERE id='account-1'").run()
    mockParseStatement.mockReturnValue([
      {
        date: '2026-07-13',
        amount: 10,
        description: 'No currency',
        type: 'expense',
      },
    ])
    const assumed = await previewStatementFile(statementFile(), 'account-1')
    expect(assumed.limitations).toContain(
      'Statement source did not declare a currency; amounts are assumed to be USD.'
    )
  })

  it('imports no prefix from a valid-plus-malformed real OFX file', async () => {
    mockParseStatement.mockImplementation(actualStatementParser.parseStatement)
    const malformed = `<OFX><STMTRS><CURDEF>USD
<STMTTRN><DTPOSTED>20260713<TRNAMT>-10.00<FITID>valid<NAME>Valid</STMTTRN>
<STMTTRN><DTPOSTED>20260714<TRNAMT>20oops<FITID>bad<NAME>Bad</STMTTRN>
</STMTRS></OFX>`

    const result = await importStatementFile(statementFile('mixed.ofx', malformed), 'account-1')

    expect(result.errors[0]).toMatch(/OFX transaction 2 has invalid amount/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 0,
    })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 10_000,
    })
  })
})
