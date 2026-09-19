import {
  BACKEND_FOUNDATION_MIGRATION,
  BACKEND_FOUNDATION_SCHEMA,
  backendFoundationStatements,
  assertBackendFoundationReady,
  assertSupportedSchemaVersion,
} from '@shikin/finance-core'
import Database from 'better-sqlite3'
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'
import { PRIVATE_FILE_MODE, ensurePrivateDirectory, hardenPathMode } from './app-data-dir.js'
import { prepareStorageForWrite, storageContext } from './storage-context.js'

const DATA_DIR = storageContext.appDataDir
const DB_PATH = storageContext.databasePath
const BACKUP_DIR = storageContext.backupDir
const RESTORE_LOCK_PATH = storageContext.restoreLockPath
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const
const SQLITE_FAMILY_SUFFIXES = ['', ...SQLITE_SIDECAR_SUFFIXES] as const
const MAX_BACKUP_METADATA_ENTRIES = 20
export const DATABASE_BACKUP_SETTING_KEY = 'database_backups'
const REQUIRED_CORE_TABLES = [
  '_migrations',
  'accounts',
  'categories',
  'transactions',
  'settings',
] as const
// fallow-ignore-next-line unused-export
export const REQUIRED_MIGRATIONS = CLI_DATABASE_MIGRATIONS
const REQUIRED_CORE_SCHEMA: Record<string, readonly string[]> = {
  _migrations: ['id', 'name', 'applied_at'],
}
// Minimum legacy inputs for the supported staged 019 -> 020 -> 021 path.
// Do not substitute latest-schema requirements here.
const RESTORE_MIGRATION_INPUT_SCHEMA: Record<string, readonly string[]> = {
  accounts: ['type', 'account_mode'],
  investments: ['id', 'avg_cost_basis'],
  stock_prices: ['id', 'currency'],
  recurring_rules: ['id'],
  net_worth_snapshots: ['id'],
  recaps: ['id'],
}
const QUOTE_RECURRENCE_IMPORT_SCHEMA: Record<string, readonly string[]> = {
  transactions: ['import_source', 'import_external_id', 'import_fingerprint'],
  stock_prices: ['quote_currency'],
  recurring_rules: ['anchor_kind', 'anchor_day'],
  net_worth_snapshots: ['currency'],
}
const REQUIRED_CLI_QOL_SCHEMA: Record<string, readonly string[]> = {
  accounts: ['account_mode'],
  settings: ['key', 'value', 'updated_at'],
  transactions: [
    'status',
    'source',
    'note',
    'recurring_rule_id',
    'is_placeholder',
    'placeholder_status',
    'resolved_at',
    'resolved_by_transaction_id',
    'placeholder_reason',
    'placeholder_parent_transaction_id',
    'ledger_treatment',
    'reporting_treatment',
    'transaction_kind',
    'staging_batch_id',
    'reconciliation_id',
    'matched_transaction_id',
    'is_archived',
  ],
  audit_log: [
    'id',
    'entity',
    'entity_id',
    'action',
    'before_json',
    'after_json',
    'source',
    'note',
    'created_at',
  ],
  cashflow_buckets: [
    'id',
    'name',
    'description',
    'target_amount',
    'balance',
    'currency',
    'sort_order',
    'is_active',
    'created_at',
    'updated_at',
  ],
  cashflow_bucket_allocations: [
    'id',
    'bucket_id',
    'transaction_id',
    'amount',
    'currency',
    'allocation_date',
    'source',
    'note',
    'created_at',
  ],
  category_suggestions: [
    'id',
    'transaction_id',
    'description',
    'suggested_category_id',
    'suggested_subcategory_id',
    'confidence',
    'status',
    'source',
    'note',
    'created_at',
    'reviewed_at',
  ],
  credit_card_statements: [
    'id',
    'account_id',
    'statement_start_date',
    'statement_end_date',
    'due_date',
    'statement_balance',
    'minimum_payment',
    'paid_amount',
    'currency',
    'status',
    'source',
    'note',
    'created_at',
    'updated_at',
  ],
  account_reconciliations: [
    'id',
    'account_id',
    'reconciliation_date',
    'actual_balance',
    'stored_balance_before',
    'ledger_balance_before',
    'ledger_balance_after',
    'adjustment_amount',
    'adjustment_transaction_id',
    'staging_batch_id',
    'statement_start_date',
    'statement_end_date',
    'source',
    'note',
    'created_at',
  ],
  receivables: [
    'id',
    'payer',
    'amount',
    'received_amount',
    'currency',
    'due_date',
    'project_reference',
    'invoice_reference',
    'status',
    'account_id',
    'matched_transaction_id',
    'notes',
    'source',
    'note',
    'created_at',
    'updated_at',
  ],
}

export type DatabaseBackupMetadata = {
  path: string
  createdAt: string
  sizeBytes: number
  totalPages: number
  remainingPages: number
  sourcePath: string
  kind: 'manual'
  metadataWarning?: string
}

export type DatabaseRestoreMetadata = {
  sourcePath: string
  restoredAt: string
  rollbackPath: string | null
  sizeBytes: number
  metadataWarning?: string
}

export type DatabaseRestoreDryRunResult = {
  dryRun: true
  sourcePath: string
  validatedAt: string
  backupValidated: true
  wouldRestore: true
  wouldCreateRollback: boolean
  requiresApply: true
  applyPreconditionsChecked: false
  applyMayStillFailReasons: string[]
  sizeBytes: number
  integrityCheck: string
  foreignKeyViolations: number
}

export type DatabaseRestoreAppliedResult = DatabaseRestoreMetadata & {
  dryRun: false
  integrityCheck: string
  foreignKeyViolations: number
}

export type DatabaseRestoreResult = DatabaseRestoreDryRunResult | DatabaseRestoreAppliedResult

type ActiveDatabaseHandle = {
  pid: number
  fd: string
  path: string
  command: string
}

type DatabaseBackupSettings = {
  lastBackup?: DatabaseBackupMetadata
  backups?: DatabaseBackupMetadata[]
  lastRestore?: DatabaseRestoreMetadata
  updatedAt?: string
}

type RestoreCandidate = {
  sourcePath: string
  tempPath: string
  sizeBytes: number
  integrityCheck: string
  foreignKeyViolations: number
}

class DatabaseRestoreBlockedError extends Error {
  readonly code:
    | 'RESTORE_ACTIVE_HANDLES'
    | 'RESTORE_UNSUPPORTED_PLATFORM'
    | 'RESTORE_SOURCE_IS_ACTIVE_DB'
    | 'RESTORE_LOCK_EXISTS'
  readonly activeHandles: ActiveDatabaseHandle[]

  constructor(
    message: string,
    activeHandles: ActiveDatabaseHandle[] = [],
    code:
      | 'RESTORE_ACTIVE_HANDLES'
      | 'RESTORE_UNSUPPORTED_PLATFORM'
      | 'RESTORE_SOURCE_IS_ACTIVE_DB'
      | 'RESTORE_LOCK_EXISTS' = 'RESTORE_ACTIVE_HANDLES'
  ) {
    super(message)
    this.name = 'DatabaseRestoreBlockedError'
    this.code = code
    this.activeHandles = activeHandles
  }
}

class DatabaseRestoreSourceError extends Error {
  readonly code = 'RESTORE_SOURCE_HAS_SIDECARS'
  readonly sidecars: string[]

  constructor(message: string, sidecars: string[]) {
    super(message)
    this.name = 'DatabaseRestoreSourceError'
    this.sidecars = sidecars
  }
}

function convertParams(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}

let _db: Database.Database | null = null

function formatTimestampForFileName(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.(\d{3})Z$/, '$1Z')
}

function sqliteFamilyPaths(dbPath = DB_PATH): string[] {
  return SQLITE_FAMILY_SUFFIXES.map((suffix) => `${dbPath}${suffix}`)
}

function fileIdentity(path: string): string | null {
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return null
    return `${stats.dev}:${stats.ino}`
  } catch {
    return null
  }
}

function sqliteFamilyFileIdentities(dbPath = DB_PATH): Set<string> {
  const identities = new Set<string>()
  for (const familyPath of sqliteFamilyPaths(dbPath)) {
    const identity = fileIdentity(familyPath)
    if (identity) identities.add(identity)
  }
  return identities
}

function removeSqliteSidecarFiles(dbPath = DB_PATH): void {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
}

function uniqueBackupPath(prefix: string, createdAt: Date): string {
  const stamp = formatTimestampForFileName(createdAt)
  let candidate = join(BACKUP_DIR, `${prefix}-${stamp}.db`)
  let attempt = 2

  while (existsSync(candidate)) {
    candidate = join(BACKUP_DIR, `${prefix}-${stamp}-${attempt}.db`)
    attempt += 1
  }

  return candidate
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.trim() === '') return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function readJsonSettingFromDb<T>(db: Database.Database, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? LIMIT 1').get(key) as
    | { value?: string }
    | undefined
  return safeJsonParse(row?.value, fallback)
}

function writeJsonSettingInDb(db: Database.Database, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(key, JSON.stringify(value))
}

function readBackupSettings(db: Database.Database): DatabaseBackupSettings {
  const parsed = readJsonSettingFromDb<unknown>(db, DATABASE_BACKUP_SETTING_KEY, {})
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as DatabaseBackupSettings)
    : {}
}

function recordBackupMetadata(db: Database.Database, metadata: DatabaseBackupMetadata): void {
  const current = readBackupSettings(db)
  const backups = Array.isArray(current.backups) ? current.backups : []
  const deduped = backups.filter((backup) => backup?.path !== metadata.path)

  writeJsonSettingInDb(db, DATABASE_BACKUP_SETTING_KEY, {
    ...current,
    lastBackup: metadata,
    backups: [metadata, ...deduped].slice(0, MAX_BACKUP_METADATA_ENTRIES),
    updatedAt: metadata.createdAt,
  })
}

function recordRestoreMetadata(db: Database.Database, metadata: DatabaseRestoreMetadata): void {
  const current = readBackupSettings(db)
  writeJsonSettingInDb(db, DATABASE_BACKUP_SETTING_KEY, {
    ...current,
    lastRestore: metadata,
    updatedAt: metadata.restoredAt,
  })
}

function checkpointWal(
  database: Database.Database,
  { requireComplete = false }: { requireComplete?: boolean } = {}
): Record<string, unknown> {
  const [result = {}] = database.pragma('wal_checkpoint(TRUNCATE)') as Array<
    Record<string, unknown>
  >
  const busy = Number(result.busy ?? 0)
  const log = Number(result.log ?? -1)
  const checkpointed = Number(result.checkpointed ?? -1)

  if (requireComplete && (busy !== 0 || (log >= 0 && checkpointed >= 0 && checkpointed !== log))) {
    throw new Error('Could not fully checkpoint the database WAL before continuing')
  }

  return result
}

function assertSqliteHeader(path: string): void {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const header = Buffer.alloc(16)
    const bytesRead = readSync(fd, header, 0, header.length, 0)
    if (bytesRead < header.length || !header.toString('ascii').startsWith('SQLite format 3')) {
      throw new Error('Invalid SQLite database file')
    }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function assertRestoreSourceUsable(sourcePath: string): string {
  const resolvedSourcePath = resolve(sourcePath)
  if (!existsSync(resolvedSourcePath)) {
    throw new Error(`Restore source does not exist: ${resolvedSourcePath}`)
  }

  if (!statSync(resolvedSourcePath).isFile()) {
    throw new Error(`Restore source is not a file: ${resolvedSourcePath}`)
  }

  const dbFamily = comparableSqliteFamilyPaths()
  let sourceComparablePath = resolvedSourcePath
  try {
    sourceComparablePath = realpathSync(resolvedSourcePath)
  } catch {
    // The existence check above succeeded; if realpath fails, the resolved path
    // is still enough to reject the active database family by pathname.
  }

  if (dbFamily.has(resolvedSourcePath) || dbFamily.has(sourceComparablePath)) {
    throw new DatabaseRestoreBlockedError(
      'Refusing to restore from the active database file or one of its SQLite sidecars. Choose a backup file from the backups directory or another safe location.',
      [],
      'RESTORE_SOURCE_IS_ACTIVE_DB'
    )
  }

  const sourceIdentity = fileIdentity(resolvedSourcePath)
  if (sourceIdentity && sqliteFamilyFileIdentities().has(sourceIdentity)) {
    throw new DatabaseRestoreBlockedError(
      'Refusing to restore from the active database file or a file-system alias to one of its SQLite files. Choose a backup file from the backups directory or another safe location.',
      [],
      'RESTORE_SOURCE_IS_ACTIVE_DB'
    )
  }

  const sourcePathsToCheck = Array.from(new Set([resolvedSourcePath, sourceComparablePath]))
  const sourceSidecars = sourcePathsToCheck.flatMap((path) =>
    SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${path}${suffix}`).filter((sidecarPath) =>
      existsSync(sidecarPath)
    )
  )
  if (sourceSidecars.length > 0) {
    throw new DatabaseRestoreSourceError(
      `Refusing to restore from ${resolvedSourcePath} because adjacent SQLite sidecar file(s) exist: ${sourceSidecars.join(', ')}. Create a clean backup with shikin backup-database and restore that artifact instead.`,
      sourceSidecars
    )
  }

  return resolvedSourcePath
}

function sqliteErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function checkpointActiveDatabaseWalWithoutReadiness(): void {
  if (!existsSync(DB_PATH)) return

  let db: Database.Database
  try {
    db = new Database(DB_PATH, { fileMustExist: true })
  } catch {
    // Restore must still be possible when the current DB is corrupt enough that
    // SQLite cannot open it. The replacement candidate has already been staged
    // and validated before this point.
    return
  }

  try {
    checkpointWal(db, { requireComplete: true })
  } catch (error) {
    const code = sqliteErrorCode(error)
    if (code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT') return
    throw error
  } finally {
    db.close()
  }
}

function metadataWarning(action: string, error: unknown): string {
  return `${action} succeeded, but metadata could not be recorded: ${error instanceof Error ? error.message : String(error)}`
}

function assertSupportedRestoreSchema(db: Database.Database, dbPath: string): void {
  const existingTables = getTableNames(db)
  const missingTables = REQUIRED_CORE_TABLES.filter((tableName) => !existingTables.has(tableName))
  if (missingTables.length > 0) {
    throw new Error(
      `Backup is not a supported Shikin database (${dbPath}); missing: ${missingTables.join(', ')}`
    )
  }

  if (!['id', 'name'].every((column) => getColumnNames(db, '_migrations').has(column))) {
    throw new Error('Backup has incompatible migration metadata.')
  }
  assertCliQolSchemaReady(db, dbPath)
  for (const [table, columns] of Object.entries(RESTORE_MIGRATION_INPUT_SCHEMA)) {
    const existing = getColumnNames(db, table)
    if (columns.some((column) => !existing.has(column))) {
      throw new Error(`Backup has incompatible legacy migration inputs on ${table}.`)
    }
  }
  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  )
  // Restore eligibility deliberately stays at 019, independently of latest readiness.
  assertSupportedSchemaVersion(
    db.prepare('SELECT id, name FROM _migrations').all() as Array<{ id: number; name: string }>
  )
  const previousMigrations = REQUIRED_MIGRATIONS.filter(
    (migration) => Number.parseInt(migration, 10) <= 19
  )
  const missingMigrations = previousMigrations.filter(
    (migration) => !appliedMigrations.has(migration)
  )
  if (missingMigrations.length > 0) {
    throw new Error(
      `Backup is too old or incomplete for automatic restore (${dbPath}); missing migrations: ${missingMigrations.join(', ')}`
    )
  }
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  if (!getColumnNames(db, tableName).has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

function applyRestoreCompatibleMigrations(db: Database.Database): void {
  assertSupportedSchemaVersion(
    db.prepare('SELECT id, name FROM _migrations').all() as Array<{ id: number; name: string }>
  )
  ensureMigrationAppliedAtColumn(db)
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  )
  if (!applied.has('020_quote_recurrence_import_identity'))
    db.transaction(() => {
      addColumnIfMissing(db, 'transactions', 'import_source', 'TEXT')
      addColumnIfMissing(db, 'transactions', 'import_external_id', 'TEXT')
      addColumnIfMissing(db, 'transactions', 'import_fingerprint', 'TEXT')
      addColumnIfMissing(db, 'stock_prices', 'quote_currency', 'TEXT')
      addColumnIfMissing(
        db,
        'recurring_rules',
        'anchor_kind',
        "TEXT CHECK (anchor_kind IN ('fixed_day', 'end_of_month'))"
      )
      addColumnIfMissing(
        db,
        'recurring_rules',
        'anchor_day',
        'INTEGER CHECK (anchor_day BETWEEN 1 AND 31)'
      )
      addColumnIfMissing(db, 'net_worth_snapshots', 'currency', 'TEXT')
      db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_import_identity
        ON transactions(account_id, import_source, import_external_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_import_fingerprint
        ON transactions(account_id, import_fingerprint);
      UPDATE stock_prices
      SET quote_currency = UPPER(currency)
      WHERE quote_currency IS NULL AND currency IS NOT NULL AND TRIM(currency) <> '';
    `)
      db.prepare(
        "INSERT OR IGNORE INTO _migrations (id, name, applied_at) VALUES (20, '020_quote_recurrence_import_identity', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
      ).run()
    })()

  db.transaction(() => {
    const migrations = db.prepare('SELECT id, name FROM _migrations').all() as Array<{
      id: number
      name: string
    }>
    assertSupportedSchemaVersion(migrations)
    if (!migrations.some((row) => row.name === BACKEND_FOUNDATION_MIGRATION)) {
      const columns = Object.fromEntries(
        Object.keys(BACKEND_FOUNDATION_SCHEMA).map((table) => [
          table,
          [...getColumnNames(db, table)],
        ])
      )
      for (const statement of backendFoundationStatements(columns)) db.exec(statement)
    }
    assertShikinSchemaReady(db)
  }).immediate()
}

function validateDatabaseFile(
  dbPath: string,
  label: string,
  options: { allowPreviousSchema?: boolean } = {}
): Omit<RestoreCandidate, 'sourcePath' | 'tempPath' | 'sizeBytes'> {
  assertSqliteHeader(dbPath)

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { fileMustExist: true })
    const integrityCheck = db.pragma('integrity_check', { simple: true })
    if (integrityCheck !== 'ok') {
      throw new Error(`SQLite database failed integrity check (${label}): ${integrityCheck}`)
    }

    db.pragma('foreign_keys = ON')
    const foreignKeyViolations = db.pragma('foreign_key_check') as unknown[]
    if (foreignKeyViolations.length > 0) {
      throw new Error(
        `SQLite database failed foreign key check (${label}): ${JSON.stringify(foreignKeyViolations[0])}`
      )
    }

    if (options.allowPreviousSchema) {
      assertSupportedRestoreSchema(db, label)
      // This is the staged COPY only: upgrade and validate before promotion.
      applyRestoreCompatibleMigrations(db)
      assertShikinSchemaReady(db, label)
    } else {
      assertShikinSchemaReady(db, label)
    }

    return { integrityCheck: 'ok', foreignKeyViolations: 0 }
  } finally {
    db?.close()
  }
}

function stageRestoreCandidate(sourcePath: string): RestoreCandidate {
  const resolvedSourcePath = assertRestoreSourceUsable(sourcePath)
  const tempPath = `${DB_PATH}.restore-candidate-${process.pid}-${Date.now()}`
  removeSqliteSidecarFiles(tempPath)

  try {
    copyFileSync(resolvedSourcePath, tempPath)
    hardenPathMode(tempPath, PRIVATE_FILE_MODE)
    const validation = validateDatabaseFile(tempPath, resolvedSourcePath, {
      allowPreviousSchema: true,
    })

    return {
      sourcePath: resolvedSourcePath,
      tempPath,
      sizeBytes: statSync(resolvedSourcePath).size,
      ...validation,
    }
  } catch (error) {
    rmSync(tempPath, { force: true })
    removeSqliteSidecarFiles(tempPath)
    throw error
  }
}

function cleanupRestoreCandidate(candidate: RestoreCandidate): void {
  rmSync(candidate.tempPath, { force: true })
  removeSqliteSidecarFiles(candidate.tempPath)
}

async function backupDatabasePath(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    sourceDb.pragma('busy_timeout = 5000')
    await sourceDb.backup(destinationPath)
    hardenPathMode(destinationPath, PRIVATE_FILE_MODE)
  } finally {
    sourceDb.close()
  }
}

async function createRollbackBackup(rollbackPath: string): Promise<void> {
  rmSync(rollbackPath, { force: true })
  removeSqliteSidecarFiles(rollbackPath)

  try {
    await backupDatabasePath(DB_PATH, rollbackPath)
  } catch (error) {
    const code = sqliteErrorCode(error)
    if (code !== 'SQLITE_NOTADB' && code !== 'SQLITE_CORRUPT') throw error

    // A corrupt current database cannot be opened by SQLite's backup API. With
    // external handles already ruled out, preserve its bytes for manual recovery.
    copyFileSync(DB_PATH, rollbackPath)
    hardenPathMode(rollbackPath, PRIVATE_FILE_MODE)
  }
}

function normalizeProcFdTarget(target: string): string {
  return target.endsWith(' (deleted)') ? target.slice(0, -' (deleted)'.length) : target
}

function comparableSqliteFamilyPaths(dbPath = DB_PATH): Set<string> {
  const paths = new Set<string>()
  for (const familyPath of sqliteFamilyPaths(dbPath)) {
    paths.add(resolve(familyPath))
    try {
      if (existsSync(familyPath)) paths.add(realpathSync(familyPath))
    } catch {
      // Best-effort process scan; resolved path remains in the set.
    }
  }
  return paths
}

function readProcessCommand(pid: number): string {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    const command = raw.split('\0').filter(Boolean).join(' ')
    return command || `pid:${pid}`
  } catch {
    return `pid:${pid}`
  }
}

function listActiveDatabaseHandles(dbPath = DB_PATH): ActiveDatabaseHandle[] {
  if (process.platform !== 'linux' || !existsSync('/proc')) return []

  const targetPaths = comparableSqliteFamilyPaths(dbPath)
  const handles: ActiveDatabaseHandle[] = []

  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    const fdDir = `/proc/${pid}/fd`
    let fds: string[]

    try {
      fds = readdirSync(fdDir)
    } catch {
      continue
    }

    for (const fd of fds) {
      const fdPath = `${fdDir}/${fd}`
      let target: string
      try {
        target = normalizeProcFdTarget(readlinkSync(fdPath))
      } catch {
        continue
      }
      if (!target.startsWith('/')) continue

      const comparableTargets = new Set([resolve(target)])
      try {
        if (existsSync(target)) comparableTargets.add(realpathSync(target))
      } catch {
        // Ignore disappearing process/file races.
      }

      if ([...comparableTargets].some((candidate) => targetPaths.has(candidate))) {
        handles.push({ pid, fd, path: target, command: readProcessCommand(pid) })
      }
    }
  }

  return handles
}

function assertNoActiveDatabaseHandles(): void {
  if (process.platform !== 'linux' || !existsSync('/proc')) {
    throw new DatabaseRestoreBlockedError(
      'CLI restore cannot safely verify external database handles on this platform. Use the Shikin app restore flow, or stop all Shikin processes and replace the database manually after creating a backup.',
      [],
      'RESTORE_UNSUPPORTED_PLATFORM'
    )
  }

  const activeHandles = listActiveDatabaseHandles()
  if (activeHandles.length > 0) {
    throw new DatabaseRestoreBlockedError(
      `Refusing to restore while ${activeHandles.length} process handle(s) still reference the active Shikin database. Close Shikin, the browser data-server, MCP server, and any other CLI sessions, then retry.`,
      activeHandles,
      'RESTORE_ACTIVE_HANDLES'
    )
  }
}

function acquireRestoreLock(): () => void {
  let fd: number | null = null
  try {
    fd = openSync(RESTORE_LOCK_PATH, 'wx', PRIVATE_FILE_MODE)
    writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2)
    )
    closeSync(fd)
    fd = null
    hardenPathMode(RESTORE_LOCK_PATH, PRIVATE_FILE_MODE)
  } catch (error) {
    if (fd !== null) closeSync(fd)
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new DatabaseRestoreBlockedError(
        `Another database restore appears to be in progress (${RESTORE_LOCK_PATH}). If no restore is running, remove the stale lock file and retry.`,
        [],
        'RESTORE_LOCK_EXISTS'
      )
    }
    throw error
  }

  return () => rmSync(RESTORE_LOCK_PATH, { force: true })
}

function writeRestoreLockState(state: Record<string, unknown>): void {
  try {
    writeFileSync(
      RESTORE_LOCK_PATH,
      JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString(), ...state }, null, 2)
    )
    hardenPathMode(RESTORE_LOCK_PATH, PRIVATE_FILE_MODE)
  } catch {
    // The lock already exists. Extra recovery metadata is best-effort and should
    // not turn a safe restore into a failure.
  }
}

function getTableNames(db: Database.Database): Set<string> {
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>
  return new Set(tableRows.map((row) => row.name))
}

function getColumnNames(db: Database.Database, tableName: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
}

function ensureMigrationAppliedAtColumn(db: Database.Database): void {
  const migrationColumns = getColumnNames(db, '_migrations')
  if (!migrationColumns.has('applied_at')) {
    db.prepare('ALTER TABLE _migrations ADD COLUMN applied_at TEXT').run()
  }
  db.prepare(
    "UPDATE _migrations SET applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE applied_at IS NULL OR TRIM(applied_at) = ''"
  ).run()
}

function assertCoreSchemaReady(db: Database.Database, dbPath: string): void {
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_CORE_SCHEMA)) {
    const existingColumns = getColumnNames(db, tableName)
    const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column))
    if (missingColumns.length > 0) {
      throw new Error(
        `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
          `Missing required columns on ${tableName}: ${missingColumns.join(', ')}. ` +
          'Open the Shikin app to finish initializing or migrating the shared database.'
      )
    }
  }
}

function normalizeSqlDefinition(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeTransactionStatusDefault(value: unknown): string {
  let normalized = normalizeSqlDefinition(value)
  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1).trim()
  }
  return normalized.replace(/^['"]|['"]$/g, '')
}

function hasVerifiedTrigger(
  triggers: Array<{ name: string; sql?: string | null }>,
  name: string,
  snippets: string[]
): boolean {
  const triggerSql = normalizeSqlDefinition(triggers.find((trigger) => trigger.name === name)?.sql)
  return snippets.every((snippet) => triggerSql.includes(snippet))
}

function assertTransactionStatusReady(db: Database.Database, dbPath: string): void {
  const statusColumn = (
    db.prepare('PRAGMA table_info(transactions)').all() as Array<{
      name: string
      notnull?: number
      dflt_value?: unknown
    }>
  ).find((column) => column.name === 'status')
  if (!statusColumn) return

  const defaultValue = normalizeTransactionStatusDefault(statusColumn.dflt_value)
  const hasPostedDefault = defaultValue === 'posted'
  const hasNoDefault = defaultValue === ''
  if (!hasPostedDefault && !hasNoDefault) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        'The transactions.status column has an unsafe default. ' +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }
  if (Number(statusColumn.notnull ?? 0) === 1 && !hasPostedDefault) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        'The transactions.status column is missing the posted default. ' +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }

  const triggers = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'transactions'"
    )
    .all() as Array<{ name: string; sql?: string | null }>
  const hasInsertDefaultTrigger = hasVerifiedTrigger(
    triggers,
    'trg_transactions_status_insert_default',
    ['after insert on transactions', "update transactions set status = 'posted' where id = new.id"]
  )
  const hasUpdateDefaultTrigger = hasVerifiedTrigger(
    triggers,
    'trg_transactions_status_update_default',
    [
      'after update of status on transactions',
      "update transactions set status = 'posted' where id = new.id",
    ]
  )
  if (!hasPostedDefault) {
    if (!hasInsertDefaultTrigger || !hasUpdateDefaultTrigger) {
      throw new Error(
        `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
          'The transactions.status column is missing default-status protection. ' +
          'Open the Shikin app to finish initializing or migrating the shared database.'
      )
    }
  }

  const validStatusSnippets = [
    "new.status not in ('pending', 'posted', 'cleared')",
    'raise(abort',
    'invalid transaction status',
  ]
  if (
    !hasVerifiedTrigger(triggers, 'trg_transactions_status_insert_valid', [
      'before insert on transactions',
      ...validStatusSnippets,
    ]) ||
    !hasVerifiedTrigger(triggers, 'trg_transactions_status_update_valid', [
      'before update of status on transactions',
      ...validStatusSnippets,
    ])
  ) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        'The transactions.status column is missing valid-status protection. ' +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }
}

function assertCliQolSchemaReady(db: Database.Database, dbPath: string): void {
  const existingTables = getTableNames(db)
  const missingTables = Object.keys(REQUIRED_CLI_QOL_SCHEMA).filter(
    (tableName) => !existingTables.has(tableName)
  )

  if (missingTables.length > 0) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        `Missing required tables for 016_cli_qol_foundation: ${missingTables.join(', ')}. ` +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_CLI_QOL_SCHEMA)) {
    const existingColumns = getColumnNames(db, tableName)
    const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column))
    if (missingColumns.length > 0) {
      throw new Error(
        `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
          `Missing required columns on ${tableName}: ${missingColumns.join(', ')}. ` +
          'Open the Shikin app to finish initializing or migrating the shared database.'
      )
    }
  }

  assertTransactionStatusReady(db, dbPath)
}

export function assertShikinSchemaReady(db: Database.Database, dbPath = DB_PATH): void {
  const existingTables = getTableNames(db)
  const missingTables = REQUIRED_CORE_TABLES.filter((tableName) => !existingTables.has(tableName))

  if (missingTables.length > 0) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        `Missing required tables: ${missingTables.join(', ')}. ` +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }

  assertCoreSchemaReady(db, dbPath)

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  )

  assertSupportedSchemaVersion(
    db.prepare('SELECT id, name FROM _migrations').all() as Array<{ id: number; name: string }>
  )

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

  assertCliQolSchemaReady(db, dbPath)
  for (const [table, columns] of Object.entries(QUOTE_RECURRENCE_IMPORT_SCHEMA)) {
    const existing = getColumnNames(db, table)
    if (columns.some((column) => !existing.has(column))) {
      throw new Error(`Database is not ready for CLI/MCP use. Missing 020 columns on ${table}.`)
    }
  }
  assertBackendFoundationReady(
    Object.fromEntries(
      Object.keys(BACKEND_FOUNDATION_SCHEMA).map((table) => [table, [...getColumnNames(db, table)]])
    ),
    db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('index', 'trigger')")
      .all() as Array<{ name: string; sql: string | null }>,
    db.prepare('SELECT * FROM app_data_state').all() as Array<{
      id: number
      database_id: string
      data_revision: number
    }>
  )
}

type DatabaseInitializationErrorCode =
  | 'DATABASE_MISSING'
  | 'DATABASE_PERMISSION'
  | 'DATABASE_OPEN'
  | 'DATABASE_INVALID'
  | 'DATABASE_SCHEMA_NOT_READY'

class DatabaseInitializationError extends Error {
  readonly code: DatabaseInitializationErrorCode

  constructor(code: DatabaseInitializationErrorCode, message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'DatabaseInitializationError'
    this.code = code
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function databaseInitializationError(error: unknown): DatabaseInitializationError {
  if (error instanceof DatabaseInitializationError) return error

  const code = sqliteErrorCode(error)
  const message = errorMessage(error)
  let databasePathErrorCode: string | undefined
  try {
    statSync(DB_PATH)
  } catch (pathError) {
    databasePathErrorCode = sqliteErrorCode(pathError)
  }
  if (
    code === 'SQLITE_NOTADB' ||
    code === 'SQLITE_CORRUPT' ||
    /not a database|malformed/i.test(message)
  ) {
    return new DatabaseInitializationError(
      'DATABASE_INVALID',
      `The Shikin database at ${DB_PATH} is invalid or corrupt. Original error: ${message}`,
      error
    )
  }
  if (/not ready for CLI\/MCP use/i.test(message)) {
    return new DatabaseInitializationError('DATABASE_SCHEMA_NOT_READY', message, error)
  }
  if (
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'SQLITE_PERM' ||
    code === 'SQLITE_AUTH' ||
    code === 'SQLITE_READONLY' ||
    databasePathErrorCode === 'EACCES' ||
    databasePathErrorCode === 'EPERM' ||
    /permission denied|access denied|readonly|read-only/i.test(message)
  ) {
    return new DatabaseInitializationError(
      'DATABASE_PERMISSION',
      `Permission denied while opening the Shikin database at ${DB_PATH}. Check ownership and access permissions. Original error: ${message}`,
      error
    )
  }
  if (/does not exist|no such file/i.test(message) || databasePathErrorCode === 'ENOENT') {
    return new DatabaseInitializationError(
      'DATABASE_MISSING',
      `The Shikin database does not exist at ${DB_PATH}. Open the Shikin app once to initialize the shared database before using the CLI or MCP server. Original error: ${message}`,
      error
    )
  }
  return new DatabaseInitializationError(
    'DATABASE_OPEN',
    `Unable to open the Shikin database at ${DB_PATH}. Original error: ${message}`,
    error
  )
}

function openDb(): Database.Database {
  try {
    return new Database(DB_PATH, { fileMustExist: true })
  } catch (error) {
    throw databaseInitializationError(error)
  }
}

function getDb(): Database.Database {
  if (!_db) {
    // The in-memory constructor/close probe must happen before preparation can
    // inspect or migrate any existing user files.
    prepareStorageForWrite()

    let db: Database.Database | null = null
    try {
      db = openDb()
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      hardenPathMode(DB_PATH, PRIVATE_FILE_MODE)
      hardenPathMode(`${DB_PATH}-wal`, PRIVATE_FILE_MODE)
      hardenPathMode(`${DB_PATH}-shm`, PRIVATE_FILE_MODE)
      hardenPathMode(`${DB_PATH}-journal`, PRIVATE_FILE_MODE)
      assertShikinSchemaReady(db)
      _db = db
    } catch (error) {
      try {
        db?.close()
      } catch {
        // Retain the initialization error as the diagnostic cause.
      }
      throw databaseInitializationError(error)
    }
  }
  return _db
}

export function getAppDataDirectory(): string {
  return DATA_DIR
}

export function getDatabasePath(): string {
  return DB_PATH
}

export function getDatabaseBackupDirectory(): string {
  return BACKUP_DIR
}

export async function backupDatabase(): Promise<DatabaseBackupMetadata> {
  const db = getDb()
  ensurePrivateDirectory(BACKUP_DIR)

  const createdAtDate = new Date()
  const backupPath = uniqueBackupPath('shikin', createdAtDate)
  let metadata: DatabaseBackupMetadata

  try {
    const backup = await db.backup(backupPath)
    hardenPathMode(backupPath, PRIVATE_FILE_MODE)
    validateDatabaseFile(backupPath, backupPath)
    removeSqliteSidecarFiles(backupPath)
    hardenPathMode(backupPath, PRIVATE_FILE_MODE)

    metadata = {
      path: backupPath,
      createdAt: createdAtDate.toISOString(),
      sizeBytes: statSync(backupPath).size,
      totalPages: backup.totalPages,
      remainingPages: backup.remainingPages,
      sourcePath: DB_PATH,
      kind: 'manual',
    }
  } catch (error) {
    rmSync(backupPath, { force: true })
    removeSqliteSidecarFiles(backupPath)
    throw error
  }

  try {
    recordBackupMetadata(db, metadata)
  } catch (error) {
    metadata.metadataWarning = metadataWarning('Backup', error)
  }

  return metadata
}

export async function restoreDatabase({
  sourcePath,
  dryRun = true,
}: {
  sourcePath: string
  dryRun?: boolean
}): Promise<DatabaseRestoreResult> {
  prepareStorageForWrite()
  const candidate = stageRestoreCandidate(sourcePath)
  if (dryRun) {
    try {
      return {
        dryRun: true,
        sourcePath: candidate.sourcePath,
        validatedAt: new Date().toISOString(),
        backupValidated: true,
        wouldRestore: true,
        wouldCreateRollback: existsSync(DB_PATH),
        requiresApply: true,
        applyPreconditionsChecked: false,
        applyMayStillFailReasons: [
          'restore_unsupported_platform',
          'restore_lock_exists',
          'restore_active_handles',
        ],
        sizeBytes: candidate.sizeBytes,
        integrityCheck: candidate.integrityCheck,
        foreignKeyViolations: candidate.foreignKeyViolations,
      }
    } finally {
      cleanupRestoreCandidate(candidate)
    }
  }

  let releaseRestoreLock: (() => void) | null = null
  const restoredAt = new Date().toISOString()
  let rollbackPath: string | null = null
  let rollbackCreated = false
  let replacementCreated = false
  let restoreMetadataWarning: string | undefined

  const restoreRollback = async () => {
    close()

    if (rollbackCreated && rollbackPath && existsSync(rollbackPath)) {
      removeSqliteSidecarFiles(DB_PATH)
      await backupDatabasePath(rollbackPath, DB_PATH)
      return
    }

    if (rollbackCreated) {
      throw new Error(`Rollback backup is missing; manual recovery required at ${rollbackPath}`)
    }

    // No rollback exists for fresh-install restores. Keeping the prevalidated
    // replacement is safer than deleting the only usable database file.
  }

  try {
    releaseRestoreLock = acquireRestoreLock()

    close()

    assertNoActiveDatabaseHandles()
    checkpointActiveDatabaseWalWithoutReadiness()
    assertNoActiveDatabaseHandles()
    removeSqliteSidecarFiles(DB_PATH)

    if (existsSync(DB_PATH)) {
      ensurePrivateDirectory(BACKUP_DIR)
      rollbackPath = uniqueBackupPath('rollback-shikin', new Date())
      await createRollbackBackup(rollbackPath)
      rollbackCreated = true
      writeRestoreLockState({
        stage: 'ready-to-restore',
        rollbackPath,
        candidatePath: candidate.tempPath,
      })
    }

    removeSqliteSidecarFiles(DB_PATH)
    await backupDatabasePath(candidate.tempPath, DB_PATH)
    replacementCreated = true

    const restoredDb = openDb()
    try {
      restoredDb.pragma('journal_mode = WAL')
      restoredDb.pragma('foreign_keys = ON')
      validateDatabaseFile(DB_PATH, DB_PATH)
      try {
        recordRestoreMetadata(restoredDb, {
          sourcePath: candidate.sourcePath,
          restoredAt,
          rollbackPath,
          sizeBytes: candidate.sizeBytes,
        })
      } catch (error) {
        restoreMetadataWarning = metadataWarning('Restore', error)
      }
    } finally {
      restoredDb.close()
    }

    return {
      sourcePath: candidate.sourcePath,
      restoredAt,
      rollbackPath,
      sizeBytes: candidate.sizeBytes,
      ...(restoreMetadataWarning ? { metadataWarning: restoreMetadataWarning } : {}),
      dryRun: false,
      integrityCheck: candidate.integrityCheck,
      foreignKeyViolations: candidate.foreignKeyViolations,
    }
  } catch (error) {
    if (rollbackCreated || replacementCreated) {
      try {
        await restoreRollback()
      } catch (rollbackError) {
        throw new Error(
          `Database restore failed and automatic rollback could not be completed. Manual recovery: copy ${rollbackPath ?? 'the rollback backup'} to ${DB_PATH}. Restore error: ${error instanceof Error ? error.message : String(error)}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          { cause: rollbackError }
        )
      }
    }
    throw error
  } finally {
    cleanupRestoreCandidate(candidate)
    releaseRestoreLock?.()
  }
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
  return db.transaction(fn).immediate()
}

export function close(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
