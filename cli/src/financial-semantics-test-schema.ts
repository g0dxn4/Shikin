import { readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'

const migrationUrl = new URL(
  '../../src-tauri/migrations/019_financial_semantics.sql',
  import.meta.url
)

export function applyFinancialSemanticsTestSchema(db: Database.Database): void {
  db.exec(readFileSync(migrationUrl, 'utf8'))
}
