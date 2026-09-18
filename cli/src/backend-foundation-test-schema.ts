import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import type Database from 'better-sqlite3'
import * as foundation from '@shikin/finance-core'

/** Use before inserting synthetic migration markers. No external SQL asset needed. */
export function applyBackendFoundationTestSchema(db: Database.Database): void {
  db.transaction(() => {
    const columns = Object.fromEntries(
      Object.keys(foundation.BACKEND_FOUNDATION_SCHEMA).map((table) => [
        table,
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (column) => column.name
        ),
      ])
    )
    for (const statement of foundation.backendFoundationStatements(columns)) db.exec(statement)
  }).immediate()
}

/** Execute only the hosted migration section, never storage setup or a server.
 * A version boundary produces a synthetic legacy database using unchanged old SQL.
 */
export function runHostedTestMigrations(db: Database.Database, through: 19 | 20 | 21 = 21): void {
  const source = readFileSync(new URL('../../scripts/data-server.mjs', import.meta.url), 'utf8')
  let migrations = source.slice(
    source.indexOf('const CURRENT_SHIKIN_MIGRATIONS'),
    source.indexOf('\ntry {\n  runMigrations()')
  )
  if (through === 19)
    migrations = migrations.replace(
      "  if (!applied.has('020_quote_recurrence_import_identity')) {",
      '  return\n  if (false) {'
    )
  if (through === 20)
    migrations = migrations.replace(
      '  db.transaction(() => {\n    const migrations',
      '  return\n  db.transaction(() => {\n    const migrations'
    )
  runInNewContext(`${migrations}\nrunMigrations()`, { db, ...foundation, console: { log() {} } })
}
