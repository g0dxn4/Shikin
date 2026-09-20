// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createStorageContext } from './app-data-dir.js'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
import { getRuntimeDiagnostics } from './runtime-diagnostics.js'
import { initializeRuntimeIdentity } from './runtime-identity.js'

const roots: string[] = []
function storage() {
  const root = mkdtempSync(join(tmpdir(), 'shikin-runtime-diagnostics-'))
  roots.push(root)
  const context = createStorageContext({
    HOME: join(root, 'home'),
    XDG_DATA_HOME: join(root, 'data'),
    SHIKIN_RESPECT_XDG_DATA_HOME: '1',
  })
  mkdirSync(context.appDataDir, { recursive: true })
  return { root, context }
}

function initializedDatabase(path: string, through: 19 | 20 | 21 = 21): Database.Database {
  const db = new Database(path)
  runHostedTestMigrations(db, through)
  return db
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CLI runtime diagnostics', () => {
  it('reports only opaque runtime metadata and performs no writes', () => {
    const { root, context } = storage()
    const db = initializedDatabase(context.databasePath)
    const before = db.prepare('SELECT * FROM app_data_state').get()
    db.close()
    const id = initializeRuntimeIdentity(context.appDataDir, randomUUID())

    const result = getRuntimeDiagnostics(context)
    const afterDb = new Database(context.databasePath, { readonly: true })
    const after = afterDb.prepare('SELECT * FROM app_data_state').get()
    afterDb.close()

    expect(result).toMatchObject({
      success: true,
      build: 'cli',
      version: '1.1.0',
      schemaVersion: 21,
      schemaMigration: '021_backend_remediation_foundation',
      localInstance: { status: 'available', id },
      dataRevision: 0,
      lastFinancialWriteAt: null,
    })
    expect(result.databaseLineageId).toMatch(/^[a-f0-9]{32}$/)
    expect(after).toEqual(before)
    expect(JSON.stringify(result)).not.toContain(root)
    expect(JSON.stringify(result)).not.toContain('shikin.db')
  })

  it('keeps copied database lineage while assigning a distinct fresh-root identity', () => {
    const first = storage().context
    const second = storage().context
    const db = initializedDatabase(first.databasePath)
    db.close()
    copyFileSync(first.databasePath, second.databasePath)
    const firstId = initializeRuntimeIdentity(first.appDataDir, randomUUID())
    const secondId = initializeRuntimeIdentity(second.appDataDir, randomUUID())

    const firstDiagnostics = getRuntimeDiagnostics(first)
    const secondDiagnostics = getRuntimeDiagnostics(second)
    expect(secondDiagnostics.databaseLineageId).toBe(firstDiagnostics.databaseLineageId)
    expect(firstDiagnostics.localInstance).toEqual({ status: 'available', id: firstId })
    expect(secondDiagnostics.localInstance).toEqual({ status: 'available', id: secondId })
    expect(secondId).not.toBe(firstId)
  })

  it('leaves audit and recap writes out of the financial revision while financial writes advance it', () => {
    const { context } = storage()
    const db = initializedDatabase(context.databasePath)
    db.close()
    initializeRuntimeIdentity(context.appDataDir, randomUUID())
    const initial = getRuntimeDiagnostics(context)

    const writer = new Database(context.databasePath)
    writer.exec(`
      INSERT INTO audit_log (id, entity, action) VALUES ('audit-diagnostic', 'diagnostic', 'read');
      INSERT INTO recaps (id, type, period_start, period_end, title, summary)
      VALUES ('recap-diagnostic', 'monthly', '2025-01-01', '2025-01-31', 'Recap', 'Read only');
    `)
    writer.close()
    const afterNonFinancial = getRuntimeDiagnostics(context)
    expect(afterNonFinancial.dataRevision).toBe(initial.dataRevision)
    expect(afterNonFinancial.lastFinancialWriteAt).toBe(initial.lastFinancialWriteAt)

    const financialWriter = new Database(context.databasePath)
    financialWriter
      .prepare(
        "INSERT INTO accounts (id, name, type, balance) VALUES ('diagnostic-account', 'Diagnostic', 'checking', 0)"
      )
      .run()
    financialWriter.close()
    const afterFinancial = getRuntimeDiagnostics(context)
    expect(afterFinancial.dataRevision).toBeGreaterThan(afterNonFinancial.dataRevision)
    expect(afterFinancial.lastFinancialWriteAt).not.toBeNull()
  })

  it('rejects old and future schemas without creating or migrating identity', () => {
    for (const version of ['old', 'future'] as const) {
      const { context } = storage()
      const db = initializedDatabase(context.databasePath, version === 'old' ? 20 : 21)
      if (version === 'future') {
        db.prepare("INSERT INTO _migrations (id, name) VALUES (22, '022_future')").run()
      }
      const migrationsBefore = db.prepare('SELECT * FROM _migrations ORDER BY id').all()
      db.close()

      expect(() => getRuntimeDiagnostics(context)).toThrow(
        version === 'future' ? /newer/i : /not ready|missing required migration/i
      )
      const after = new Database(context.databasePath, { readonly: true })
      expect(after.prepare('SELECT * FROM _migrations ORDER BY id').all()).toEqual(migrationsBefore)
      after.close()
      // A report read must not opportunistically manufacture local identity.
      expect(existsSync(join(context.appDataDir, 'runtime-identity.json'))).toBe(false)
    }
  })
})
