// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import type { TransactionClient } from '@/lib/database'
import type { ParsedTransaction } from '@/lib/statement-parser'

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
        return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
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

const actualStatementParser = await vi.importActual<{
  parseStatement: (content: string, filename: string) => ParsedTransaction[]
}>('../statement-parser')

const requireFromCli = createRequire(resolve(process.cwd(), 'cli/package.json'))
const Database = requireFromCli('better-sqlite3') as typeof BetterSqlite3
let db: BetterSqlite3.Database

const CURRENT_MIGRATIONS = [
  '001_core_tables.sql',
  '003_credit_cards.sql',
  '011_net_worth_snapshots.sql',
  '015_primary_account.sql',
  '017_investment_type_cetes.sql',
  '018_placeholder_transactions.sql',
  '019_financial_semantics.sql',
] as const

function createCurrentImportSchema(database: BetterSqlite3.Database): void {
  database.pragma('foreign_keys = ON')
  for (const migration of CURRENT_MIGRATIONS) {
    database.exec(readFileSync(resolve(process.cwd(), 'src-tauri/migrations', migration), 'utf8'))
  }
  database.exec(`
    ALTER TABLE transactions ADD COLUMN import_source TEXT;
    ALTER TABLE transactions ADD COLUMN import_external_id TEXT;
    ALTER TABLE transactions ADD COLUMN import_fingerprint TEXT;
    ALTER TABLE transactions ADD COLUMN import_content_fingerprint TEXT;
    CREATE TABLE app_data_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      database_id TEXT NOT NULL UNIQUE,
      data_revision INTEGER NOT NULL DEFAULT 0,
      last_financial_write_at TEXT
    );
    INSERT INTO app_data_state (id, database_id, data_revision) VALUES (1, 'statement-test', 0);
    CREATE TABLE duplicate_review_decisions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      existing_transaction_id TEXT NOT NULL,
      candidate_identity_key TEXT NOT NULL,
      candidate_content_fingerprint TEXT NOT NULL,
      existing_evidence_fingerprint TEXT NOT NULL,
      decision TEXT NOT NULL,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER revise_statement_transaction AFTER INSERT ON transactions
    BEGIN UPDATE app_data_state SET data_revision = data_revision + 1 WHERE id = 1; END;
    CREATE TRIGGER revise_statement_decision AFTER INSERT ON duplicate_review_decisions
    BEGIN UPDATE app_data_state SET data_revision = data_revision + 1 WHERE id = 1; END;
  `)
  database
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived, account_mode)
       VALUES (?, ?, ?, ?, ?, 0, 'transactional')`
    )
    .run('account-1', 'Checking', 'checking', 'USD', 10_000)
}

function statementFile(name = 'statement.ofx', content = 'parsed by test mock'): File {
  return new File([content], name, { type: 'application/xml' })
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

describe('importStatementFile real SQLite rollback', () => {
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
      { date: '2026-07-13', amount: 10, description: 'Earlier row', type: 'expense' },
      { date: '2026-07-14', amount: 20, description: 'Failing row', type: 'expense' },
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
      { date: '2026-07-13', amount: 10, description: 'Coffee', type: 'expense' },
      { date: '2026-07-13', amount: 10, description: 'Coffee', type: 'expense' },
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

    expect(result).toMatchObject({ imported: 0, skipped: 0, mode: 'reviewed_atomic' })
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
      { date: '2026-07-13', amount: 10, description: 'Expense', type: 'expense' },
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
      { date: '2026-07-13', amount: 12.25, description: 'Groceries', type: 'expense' },
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

    expect(preview).toMatchObject({ success: true, imported: 1, requiredDecisions: [] })
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
      { date: '2026-07-13', amount: 10, description: 'Blocked', type: 'expense' },
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
      { date: '2026-07-13', amount: 10, description: 'Archive account', type: 'income' },
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
      data_revision: 0,
    })
  })

  it('rejects a safe row that would overflow the current near-limit balance', async () => {
    const openingBalance = Number.MAX_SAFE_INTEGER - 5
    db.prepare("UPDATE accounts SET balance=? WHERE id='account-1'").run(openingBalance)
    mockParseStatement.mockReturnValue([
      { date: '2026-07-13', amount: 0.1, description: 'Overflow', type: 'income' },
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
      { date: '2026-07-13', amount: 10, description: 'Audited row', type: 'expense' },
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.errors[0]).toContain('statement audit failed')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT data_revision FROM app_data_state WHERE id=1').get()).toEqual({
      data_revision: 0,
    })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 10_000,
    })
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
    expect(mismatch).toMatchObject({ success: false, reviewCandidates: [], limitations: [] })
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
      data_revision: 0,
    })

    db.prepare("UPDATE accounts SET currency='USD' WHERE id='account-1'").run()
    mockParseStatement.mockReturnValue([
      { date: '2026-07-13', amount: 10, description: 'No currency', type: 'expense' },
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
