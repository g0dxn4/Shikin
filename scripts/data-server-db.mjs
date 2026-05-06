import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { PRIVATE_FILE_MODE, hardenPathMode } from './app-data-dir.mjs'

const REQUIRED_SHIKIN_TABLES = {
  _migrations: ['id', 'name'],
  accounts: ['id', 'name', 'balance'],
  categories: ['id', 'name', 'type'],
  transactions: ['id', 'account_id', 'type', 'amount', 'date'],
}

function ensureRequiredTableColumns(database, tableName, requiredColumns) {
  const existingColumns = new Set(
    database.pragma(`table_info(${tableName})`).map((column) => column.name)
  )
  const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column))

  if (missingColumns.length > 0) {
    throw new Error(
      `Imported SQLite database is missing required Shikin columns on ${tableName}: ${missingColumns.join(', ')}`
    )
  }
}

export function checkpointWal(database, { requireComplete = false } = {}) {
  const [result = {}] = database.pragma('wal_checkpoint(TRUNCATE)')
  const busy = Number(result.busy ?? 0)
  const log = Number(result.log ?? -1)
  const checkpointed = Number(result.checkpointed ?? -1)

  if (requireComplete && (busy !== 0 || (log >= 0 && checkpointed >= 0 && checkpointed !== log))) {
    throw new Error('Could not fully checkpoint the database WAL before continuing')
  }

  return result
}

function ensureSqliteDatabaseBuffer(buffer) {
  const header = buffer.subarray(0, 16).toString('ascii')
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('Invalid SQLite database file')
  }
}

function removeSqliteSidecarFiles(dbPath) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecarPath = `${dbPath}${suffix}`
    if (existsSync(sidecarPath)) {
      unlinkSync(sidecarPath)
    }
  }
}

function validateShikinDatabase(database) {
  const tableRows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const existingTables = new Set(tableRows.map((row) => row.name))

  const missingTables = Object.keys(REQUIRED_SHIKIN_TABLES).filter(
    (tableName) => !existingTables.has(tableName)
  )
  if (missingTables.length > 0) {
    throw new Error(
      `Imported SQLite database is not a Shikin database. Missing required tables: ${missingTables.join(', ')}`
    )
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SHIKIN_TABLES)) {
    ensureRequiredTableColumns(database, tableName, requiredColumns)
  }

  const coreMigration = database
    .prepare("SELECT name FROM _migrations WHERE name = '001_core_tables' LIMIT 1")
    .get()

  if (!coreMigration) {
    throw new Error('Imported SQLite database is missing required Shikin migration metadata')
  }
}

function validateImportedDatabaseBuffer(buffer, tempDbPath) {
  ensureSqliteDatabaseBuffer(buffer)

  if (existsSync(tempDbPath)) {
    unlinkSync(tempDbPath)
  }
  removeSqliteSidecarFiles(tempDbPath)
  writeFileSync(tempDbPath, buffer, { mode: PRIVATE_FILE_MODE })
  hardenPathMode(tempDbPath, PRIVATE_FILE_MODE)

  let tempDb
  try {
    tempDb = new Database(tempDbPath, { readonly: true, fileMustExist: true })
    const integrityCheck = tempDb.pragma('integrity_check', { simple: true })
    if (integrityCheck !== 'ok') {
      throw new Error(`Imported SQLite database failed integrity check: ${integrityCheck}`)
    }
    validateShikinDatabase(tempDb)
  } finally {
    tempDb?.close()
  }
}

export function importDatabaseBuffer({
  db,
  dbPath,
  buffer,
  tempDbPath = `${dbPath}.import-check`,
}) {
  const backupPath = `${dbPath}.backup-${Date.now()}`
  let backupCreated = false

  function restoreBackup() {
    if (!backupCreated || !existsSync(backupPath)) return
    removeSqliteSidecarFiles(dbPath)
    if (existsSync(dbPath)) {
      unlinkSync(dbPath)
    }
    renameSync(backupPath, dbPath)
    hardenPathMode(dbPath, PRIVATE_FILE_MODE)
  }

  try {
    validateImportedDatabaseBuffer(buffer, tempDbPath)
    checkpointWal(db, { requireComplete: true })
    db.close()
    removeSqliteSidecarFiles(dbPath)
    if (existsSync(dbPath)) {
      renameSync(dbPath, backupPath)
      backupCreated = true
    }
    renameSync(tempDbPath, dbPath)
    hardenPathMode(dbPath, PRIVATE_FILE_MODE)

    return { backupPath: backupCreated ? backupPath : null, restoreBackup }
  } catch (error) {
    restoreBackup()
    throw error
  } finally {
    if (existsSync(tempDbPath)) {
      unlinkSync(tempDbPath)
    }
    removeSqliteSidecarFiles(tempDbPath)
  }
}
