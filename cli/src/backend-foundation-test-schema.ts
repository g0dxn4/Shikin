import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import type Database from 'better-sqlite3'
import * as foundation from '@shikin/finance-core'
import * as scopedBudgets from '@shikin/finance-core/scoped-budgets-migration'

/** Use before inserting synthetic migration markers. No external SQL asset needed. */
export function applyBackendFoundationTestSchema(
  db: Database.Database,
  includeScopedBudgets = true
): void {
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
    const fxColumns = Object.fromEntries(
      Object.keys(foundation.DATED_FX_SCHEMA).map((table) => [
        table,
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (column) => column.name
        ),
      ])
    )
    for (const statement of foundation.datedFxStatements(fxColumns)) db.exec(statement)
    for (const statement of foundation.classificationTypesStatements()) db.exec(statement)
    if (includeScopedBudgets)
      for (const statement of scopedBudgets.scopedBudgetsStatements({
        budgets: (db.prepare('PRAGMA table_info(budgets)').all() as Array<{ name: string }>).map(
          (row) => row.name
        ),
      }))
        db.exec(statement)
  }).immediate()
}

/** Execute only the hosted migration section, never storage setup or a server.
 * A version boundary produces a synthetic legacy database using unchanged old SQL.
 */
export function runHostedTestMigrations(
  db: Database.Database,
  through: 19 | 20 | 21 | 22 | 23 | 24 = 24
): void {
  const source = readFileSync(new URL('../../scripts/data-server.mjs', import.meta.url), 'utf8')
  let migrations = source.slice(
    source.indexOf('const CURRENT_SHIKIN_MIGRATIONS'),
    source.indexOf('\ntry {\n  runMigrations()')
  )
  if (through <= 23)
    migrations = migrations.replace(
      "budgets: ['id', 'name', 'amount', 'period', 'currency', 'scope_json', 'basis']",
      through <= 21
        ? "budgets: ['id', 'name', 'amount', 'period']"
        : "budgets: ['id', 'name', 'amount', 'period', 'currency']"
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
  if (through === 21) {
    migrations = migrations
      .replace('  DATED_FX_MIGRATION,\n', '')
      .replace(/ {2}assertDatedFxReady\([\s\S]*?\n {2}\)/, '')
      .replace('if (!migrations.some((row) => row.name === DATED_FX_MIGRATION))', 'if (false)')
  }
  if (through <= 22) {
    migrations = migrations
      .replace('  CLASSIFICATION_TYPES_MIGRATION,\n', '')
      .replace(/ {2}assertClassificationTypesReady\([\s\S]*?\n {2}\)/, '')
      .replace(
        'if (!migrations.some((row) => row.name === CLASSIFICATION_TYPES_MIGRATION))',
        'if (false)'
      )
  }
  if (through <= 23) {
    migrations = migrations
      .replace('  SCOPED_BUDGETS_MIGRATION,\n', '')
      .replace(/ {2}assertScopedBudgetsReady\([\s\S]*?\n {2}\)/, '')
      .replace(
        'if (!migrations.some((row) => row.name === SCOPED_BUDGETS_MIGRATION))',
        'if (false)'
      )
  }
  runInNewContext(`${migrations}\nrunMigrations()`, {
    db,
    ...foundation,
    ...scopedBudgets,
    console: { log() {} },
  })
}
