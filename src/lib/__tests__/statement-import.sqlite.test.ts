// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import type { TransactionClient } from '@/lib/database'

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
  `)
  database
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived, account_mode)
       VALUES (?, ?, ?, ?, ?, 0, 'transactional')`
    )
    .run('account-1', 'Checking', 'checking', 'USD', 10_000)
}

function statementFile(): File {
  return new File(['parsed by test mock'], 'statement.ofx', { type: 'application/xml' })
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
  })
})
