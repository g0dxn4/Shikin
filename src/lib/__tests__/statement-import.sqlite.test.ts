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

import { importStatementFile } from '../statement-import'

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
