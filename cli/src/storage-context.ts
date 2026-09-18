import Database from 'better-sqlite3'
import { createStorageContext, prepareStorageContext, type StorageContext } from './app-data-dir.js'

export const storageContext = createStorageContext()

export class NativeSqliteBindingError extends Error {
  constructor(error: unknown) {
    super(
      'The better-sqlite3 native binding could not be loaded for this Node.js runtime. Reinstall or rebuild the CLI dependencies for the active Node ABI.',
      { cause: error }
    )
    this.name = 'NativeSqliteBindingError'
  }
}

type SqliteHandle = { close(): void }
type SqliteConstructor = new (filename: string) => SqliteHandle

const validatedBindings = new WeakMap<StorageContext, Set<SqliteConstructor>>()

/** Validate the native addon without reading or mutating any Shikin storage. */
export function validateNativeSqliteBinding(
  context: StorageContext = storageContext,
  Sqlite: SqliteConstructor = Database as unknown as SqliteConstructor
): void {
  let constructors = validatedBindings.get(context)
  if (constructors?.has(Sqlite)) return

  let database: SqliteHandle | null = null
  try {
    database = new Sqlite(':memory:')
    database.close()
    database = null
  } catch (error) {
    try {
      database?.close()
    } catch {
      // Keep the original native initialization failure as the cause.
    }
    throw new NativeSqliteBindingError(error)
  }

  if (!constructors) {
    constructors = new Set()
    validatedBindings.set(context, constructors)
  }
  constructors.add(Sqlite)
}

/** Native validation always precedes all directory preparation and legacy migration. */
export function prepareStorageForWrite(
  context: StorageContext = storageContext,
  Sqlite: SqliteConstructor = Database as unknown as SqliteConstructor
): string {
  validateNativeSqliteBinding(context, Sqlite)
  return prepareStorageContext(context)
}
