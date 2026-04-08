import Database from 'better-sqlite3'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'

const DATA_DIR = join(homedir(), '.local', 'share', 'com.asf.shikin')
const DB_PATH = join(DATA_DIR, 'shikin.db')

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true })

function convertParams(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
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

export function close(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
