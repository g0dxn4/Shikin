import Database from 'better-sqlite3'
import { lstatSync, realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { assertShikinSchemaReady } from './database.js'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'
import { readRuntimeIdentity, type RuntimeIdentityStatus } from './runtime-identity.js'
import { validateNativeSqliteBinding } from './storage-context.js'
import type { StorageContext } from './app-data-dir.js'
import { storageContext } from './storage-context.js'
import { APPLICATION_VERSION } from './version.js'

export type RuntimeDiagnostics = {
  success: true
  build: 'cli'
  version: string
  schemaVersion: number
  schemaMigration: string
  databaseLineageId: string
  localInstance: RuntimeIdentityStatus
  dataRevision: number
  lastFinancialWriteAt: string | null
}

type DiagnosticsState = {
  database_id: string
  data_revision: number
  last_financial_write_at: string | null
}

type SqliteConstructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean }
) => Database.Database

function assertConfinedDatabase(context: StorageContext): void {
  const lexicalRoot = resolve(context.appDataDir)
  const lexicalDatabase = resolve(context.databasePath)
  const pathFromRoot = relative(lexicalRoot, lexicalDatabase)
  if (pathFromRoot === '..' || pathFromRoot.startsWith('../') || pathFromRoot.startsWith('..\\')) {
    throw new Error('Selected database storage is unsafe.')
  }

  let rootStats
  let databaseStats
  let canonicalRoot: string
  let canonicalDatabase: string
  try {
    rootStats = lstatSync(lexicalRoot)
    databaseStats = lstatSync(lexicalDatabase)
    canonicalRoot = realpathSync(lexicalRoot)
    canonicalDatabase = realpathSync(lexicalDatabase)
  } catch (error) {
    throw new Error('Runtime diagnostics database is unavailable.', { cause: error })
  }
  if (
    rootStats.isSymbolicLink() ||
    !rootStats.isDirectory() ||
    databaseStats.isSymbolicLink() ||
    !databaseStats.isFile()
  ) {
    throw new Error('Selected database storage is unsafe.')
  }
  const canonicalRelative = relative(canonicalRoot, canonicalDatabase)
  if (
    canonicalRelative === '..' ||
    canonicalRelative.startsWith('../') ||
    canonicalRelative.startsWith('..\\')
  ) {
    throw new Error('Selected database storage is unsafe.')
  }
}

/**
 * Opens the already-initialized database read-only. It deliberately does not
 * prepare storage, migrate legacy files, create SQLite files, or repair identity.
 */
export function getRuntimeDiagnostics(
  context: StorageContext = storageContext,
  Sqlite: SqliteConstructor = Database as unknown as SqliteConstructor
): RuntimeDiagnostics {
  validateNativeSqliteBinding(context, Sqlite)
  assertConfinedDatabase(context)

  let db: Database.Database | null = null
  try {
    try {
      db = new Sqlite(context.databasePath, { readonly: true, fileMustExist: true })
    } catch (error) {
      throw new Error('Runtime diagnostics database could not be opened.', { cause: error })
    }
    assertShikinSchemaReady(db, 'selected storage')

    const migrations = db
      .prepare('SELECT id, name FROM _migrations ORDER BY id ASC')
      .all() as Array<{ id: number; name: string }>
    const currentMigration = migrations.at(-1)
    const expectedMigration = CLI_DATABASE_MIGRATIONS.at(-1)
    if (!currentMigration || currentMigration.name !== expectedMigration) {
      throw new Error('Database schema is not ready for runtime diagnostics.')
    }

    const state = db.prepare('SELECT * FROM app_data_state WHERE id = 1').get() as
      | DiagnosticsState
      | undefined
    if (!state) throw new Error('Database diagnostics metadata is unavailable.')

    return {
      success: true,
      build: 'cli',
      version: APPLICATION_VERSION,
      schemaVersion: currentMigration.id,
      schemaMigration: currentMigration.name,
      databaseLineageId: state.database_id,
      localInstance: readRuntimeIdentity(context.appDataDir),
      dataRevision: state.data_revision,
      lastFinancialWriteAt: state.last_financial_write_at,
    }
  } finally {
    db?.close()
  }
}
