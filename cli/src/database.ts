import Database from 'better-sqlite3'
import { join } from 'node:path'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'
import { PRIVATE_FILE_MODE, hardenPathMode, prepareAppDataDir } from './app-data-dir.js'

const DATA_DIR = prepareAppDataDir()
const DB_PATH = join(DATA_DIR, 'shikin.db')
const REQUIRED_CORE_TABLES = ['_migrations', 'accounts', 'categories', 'transactions'] as const
// fallow-ignore-next-line unused-export
export const REQUIRED_MIGRATIONS = CLI_DATABASE_MIGRATIONS
const CREDIT_CARD_COLUMNS = ['credit_limit', 'statement_closing_day', 'payment_due_day'] as const

function convertParams(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}

let _db: Database.Database | null = null

function assertShikinSchemaReady(db: Database.Database, dbPath = DB_PATH): void {
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>
  const existingTables = new Set(tableRows.map((row) => row.name))
  const missingTables = REQUIRED_CORE_TABLES.filter((tableName) => !existingTables.has(tableName))

  if (missingTables.length > 0) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        `Missing required tables: ${missingTables.join(', ')}. ` +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  )

  // The desktop app can inherit 001/003 from Rust-side migrations before the JS
  // migration table records them. Mirror the app's safe metadata repair so CLI
  // readiness does not reject structurally initialized legacy databases.
  if (!appliedMigrations.has('001_core_tables') && existingTables.has('accounts')) {
    db.prepare("INSERT OR IGNORE INTO _migrations (id, name) VALUES (1, '001_core_tables')").run()
    appliedMigrations.add('001_core_tables')
  }
  if (!appliedMigrations.has('003_credit_cards') && existingTables.has('accounts')) {
    const accountColumns = new Set(
      (db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const hasCreditCardColumns = CREDIT_CARD_COLUMNS.every((column) => accountColumns.has(column))
    if (!hasCreditCardColumns) {
      const missingColumns = CREDIT_CARD_COLUMNS.filter((column) => !accountColumns.has(column))
      throw new Error(
        `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
          `Missing columns for 003_credit_cards: ${missingColumns.join(', ')}. ` +
          'Open the Shikin app to finish initializing or migrating the shared database.'
      )
    }
    db.prepare("INSERT OR IGNORE INTO _migrations (id, name) VALUES (3, '003_credit_cards')").run()
    appliedMigrations.add('003_credit_cards')
  }

  const missingMigrations = REQUIRED_MIGRATIONS.filter(
    (migration) => !appliedMigrations.has(migration)
  )

  if (missingMigrations.length > 0) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        `Missing required migration metadata: ${missingMigrations.join(', ')}. ` +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }
}

function openDb(): Database.Database {
  try {
    const db = new Database(DB_PATH, { fileMustExist: true })
    hardenPathMode(DB_PATH, PRIVATE_FILE_MODE)
    return db
  } catch (error) {
    throw new Error(
      `Unable to open the Shikin database at ${DB_PATH}. ` +
        'Open the Shikin app once to initialize the shared database before using the CLI or MCP server. ' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}

function getDb(): Database.Database {
  if (!_db) {
    const db = openDb()
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    hardenPathMode(`${DB_PATH}-wal`, PRIVATE_FILE_MODE)
    hardenPathMode(`${DB_PATH}-shm`, PRIVATE_FILE_MODE)
    hardenPathMode(`${DB_PATH}-journal`, PRIVATE_FILE_MODE)

    try {
      assertShikinSchemaReady(db)
      _db = db
    } catch (error) {
      db.close()
      throw error
    }
  }
  return _db
}

export function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
  const db = getDb()
  const converted = convertParams(sql)
  const stmt = db.prepare(converted)
  return stmt.all(...(params || [])) as T[]
}

export function execute(
  sql: string,
  params?: unknown[]
): { rowsAffected: number; lastInsertId: number } {
  const db = getDb()
  const converted = convertParams(sql)
  const stmt = db.prepare(converted)
  const result = stmt.run(...(params || []))
  return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
}

export function transaction<T>(fn: () => T): T {
  const db = getDb()
  return db.transaction(fn)()
}

export function close(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
