import Database from 'better-sqlite3'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'

const DATA_DIR = join(homedir(), '.local', 'share', 'com.asf.shikin')
const DB_PATH = join(DATA_DIR, 'shikin.db')
const REQUIRED_CORE_TABLES = ['_migrations', 'accounts', 'categories', 'transactions'] as const

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true })

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

  const coreMigration = db
    .prepare("SELECT name FROM _migrations WHERE name = '001_core_tables' LIMIT 1")
    .get() as { name: string } | undefined

  if (!coreMigration) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        'Missing required migration metadata: 001_core_tables. ' +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }
}

function openDb(): Database.Database {
  try {
    return new Database(DB_PATH, { fileMustExist: true })
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
