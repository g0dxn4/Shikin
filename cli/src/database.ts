import Database from 'better-sqlite3'
import { join } from 'node:path'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'
import { PRIVATE_FILE_MODE, hardenPathMode, prepareAppDataDir } from './app-data-dir.js'

const DATA_DIR = prepareAppDataDir()
const DB_PATH = join(DATA_DIR, 'shikin.db')
const REQUIRED_CORE_TABLES = [
  '_migrations',
  'accounts',
  'categories',
  'transactions',
  'settings',
] as const
// fallow-ignore-next-line unused-export
export const REQUIRED_MIGRATIONS = CLI_DATABASE_MIGRATIONS
const CREDIT_CARD_COLUMNS = ['credit_limit', 'statement_closing_day', 'payment_due_day'] as const
const REQUIRED_CLI_QOL_SCHEMA: Record<string, readonly string[]> = {
  settings: ['key', 'value', 'updated_at'],
  transactions: ['status', 'source', 'note', 'recurring_rule_id'],
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
}

function convertParams(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}

let _db: Database.Database | null = null

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

function assertShikinSchemaReady(db: Database.Database, dbPath = DB_PATH): void {
  const existingTables = getTableNames(db)
  const missingTables = REQUIRED_CORE_TABLES.filter((tableName) => !existingTables.has(tableName))

  if (missingTables.length > 0) {
    throw new Error(
      `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
        `Missing required tables: ${missingTables.join(', ')}. ` +
        'Open the Shikin app to finish initializing or migrating the shared database.'
    )
  }

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  )

  // The desktop app can inherit 001/003 from Rust-side migrations before the JS
  // migration table records them. Mirror the app's safe metadata repair so CLI
  // readiness does not reject structurally initialized legacy databases.
  if (!appliedMigrations.has('001_core_tables') && existingTables.has('accounts')) {
    db.prepare("INSERT OR IGNORE INTO _migrations (id, name) VALUES (1, '001_core_tables')").run()
    appliedMigrations.add('001_core_tables')
  }
  if (!appliedMigrations.has('003_credit_cards') && existingTables.has('accounts')) {
    const accountColumns = new Set(
      (db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const hasCreditCardColumns = CREDIT_CARD_COLUMNS.every((column) => accountColumns.has(column))
    if (!hasCreditCardColumns) {
      const missingColumns = CREDIT_CARD_COLUMNS.filter((column) => !accountColumns.has(column))
      throw new Error(
        `Shikin database at ${dbPath} is not ready for CLI/MCP use. ` +
          `Missing columns for 003_credit_cards: ${missingColumns.join(', ')}. ` +
          'Open the Shikin app to finish initializing or migrating the shared database.'
      )
    }
    db.prepare("INSERT OR IGNORE INTO _migrations (id, name) VALUES (3, '003_credit_cards')").run()
    appliedMigrations.add('003_credit_cards')
  }

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
}

function openDb(): Database.Database {
  try {
    const db = new Database(DB_PATH, { fileMustExist: true })
    hardenPathMode(DB_PATH, PRIVATE_FILE_MODE)
    return db
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
    hardenPathMode(`${DB_PATH}-wal`, PRIVATE_FILE_MODE)
    hardenPathMode(`${DB_PATH}-shm`, PRIVATE_FILE_MODE)
    hardenPathMode(`${DB_PATH}-journal`, PRIVATE_FILE_MODE)

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
