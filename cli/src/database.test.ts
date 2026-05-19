// @vitest-environment node
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'

const tempHomes = new Set<string>()

function seedTransactionStatusTriggers(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER trg_transactions_status_insert_valid
    BEFORE INSERT ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NOT NULL AND TRIM(NEW.status) != '' AND NEW.status NOT IN ('pending', 'posted', 'cleared')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid transaction status');
    END;
    CREATE TRIGGER trg_transactions_status_insert_default
    AFTER INSERT ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NULL OR TRIM(NEW.status) = ''
    BEGIN
      UPDATE transactions SET status = 'posted' WHERE id = NEW.id;
    END;
    CREATE TRIGGER trg_transactions_status_update_valid
    BEFORE UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NOT NULL AND TRIM(NEW.status) != '' AND NEW.status NOT IN ('pending', 'posted', 'cleared')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid transaction status');
    END;
    CREATE TRIGGER trg_transactions_status_update_default
    AFTER UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NULL OR TRIM(NEW.status) = ''
    BEGIN
      UPDATE transactions SET status = 'posted' WHERE id = NEW.id;
    END;
  `)
}

function createCliDatabasePath(homeDir: string): string {
  return createCliDatabasePathFromDataHome(join(homeDir, '.local', 'share'))
}

function createCliDatabasePathFromDataHome(dataHome: string): string {
  const dataDir = join(dataHome, 'com.asf.shikin')
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'shikin.db')
}

function seedCoreShikinSchema(
  dbPath: string,
  migrations: readonly string[] = CLI_DATABASE_MIGRATIONS,
  options: {
    includeCliQolTransactionColumns?: boolean
    includeCliQolTables?: boolean
    transactionStatusDefinition?: string
  } = {}
): void {
  const includeCliQolTransactionColumns = options.includeCliQolTransactionColumns ?? true
  const includeCliQolTables = options.includeCliQolTables ?? true
  const transactionStatusDefinition =
    options.transactionStatusDefinition ?? "status TEXT NOT NULL DEFAULT 'posted'"
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      date TEXT NOT NULL
      ${
        includeCliQolTransactionColumns
          ? `,
      ${transactionStatusDefinition},
      source TEXT,
      note TEXT,
      recurring_rule_id TEXT,
      is_placeholder INTEGER NOT NULL DEFAULT 0,
      placeholder_status TEXT,
      resolved_at TEXT,
      resolved_by_transaction_id TEXT,
      placeholder_reason TEXT,
      placeholder_parent_transaction_id TEXT`
          : ''
      }
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `)

  if (includeCliQolTables) {
    db.exec(`
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        entity_id TEXT,
        action TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE cashflow_buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        target_amount INTEGER,
        balance INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE cashflow_bucket_allocations (
        id TEXT PRIMARY KEY,
        bucket_id TEXT NOT NULL,
        transaction_id TEXT,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        allocation_date TEXT NOT NULL,
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE category_suggestions (
        id TEXT PRIMARY KEY,
        transaction_id TEXT,
        description TEXT NOT NULL,
        suggested_category_id TEXT,
        suggested_subcategory_id TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        reviewed_at TEXT
      );
      CREATE TABLE credit_card_statements (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        statement_start_date TEXT,
        statement_end_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        statement_balance INTEGER NOT NULL DEFAULT 0,
        minimum_payment INTEGER NOT NULL DEFAULT 0,
        paid_amount INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'open',
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `)
  }

  if (includeCliQolTransactionColumns) {
    seedTransactionStatusTriggers(db)
  }

  for (const migration of migrations) {
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(
      Number(migration.slice(0, 3)),
      migration
    )
  }

  db.close()
}

function addCreditCardColumns(dbPath: string): void {
  const db = new Database(dbPath)
  db.exec(`
    ALTER TABLE accounts ADD COLUMN credit_limit INTEGER;
    ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER;
    ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER;
  `)
  db.close()
}

function insertAccount(dbPath: string, name: string, id = 'acct-1'): void {
  const db = new Database(dbPath)
  db.prepare('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)').run(id, name, 1000)
  db.close()
}

async function importFreshDatabaseModule(homeDir: string, xdgDataHome = '') {
  vi.stubEnv('HOME', homeDir)
  vi.stubEnv('XDG_DATA_HOME', xdgDataHome)
  vi.resetModules()
  return import('./database.js')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true })
  }

  tempHomes.clear()
})

describe('CLI database readiness', () => {
  it('exports the shared migration readiness list for drift prevention', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    const { REQUIRED_MIGRATIONS } = await importFreshDatabaseModule(homeDir)
    const { CLI_DATABASE_MIGRATIONS: sharedMigrations } = await import('./migrations.js')

    expect(REQUIRED_MIGRATIONS).toBe(sharedMigrations)
    expect(REQUIRED_MIGRATIONS).toHaveLength(sharedMigrations.length)
  })

  it('allows queries once the shared Shikin schema is ready', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(createCliDatabasePath(homeDir))

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(query<{ ok: number }>('SELECT 1 AS ok')).toEqual([{ ok: 1 }])

    close()
  })

  it('repairs legacy migration metadata with applied_at before use', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)

    seedCoreShikinSchema(dbPath)

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(query<{ ok: number }>('SELECT 1 AS ok')).toEqual([{ ok: 1 }])
    close()

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    expect(
      db
        .prepare(
          "SELECT COUNT(*) as count FROM pragma_table_info('_migrations') WHERE name = 'applied_at'"
        )
        .get()
    ).toEqual({ count: 1 })
    expect(
      db
        .prepare(
          "SELECT COUNT(*) as count FROM _migrations WHERE applied_at IS NULL OR TRIM(applied_at) = ''"
        )
        .get()
    ).toEqual({ count: 0 })
    db.close()
  })

  it('uses absolute XDG_DATA_HOME for the shared database location', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    const xdgDataHome = mkdtempSync(join(tmpdir(), 'shikin-xdg-data-'))
    tempHomes.add(homeDir)
    tempHomes.add(xdgDataHome)

    seedCoreShikinSchema(createCliDatabasePathFromDataHome(xdgDataHome))

    const { query, close } = await importFreshDatabaseModule(homeDir, xdgDataHome)

    expect(query<{ ok: number }>('SELECT 1 AS ok')).toEqual([{ ok: 1 }])

    close()
  })

  it('rejects databases that are missing required core tables before use', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    const dbPath = createCliDatabasePath(homeDir)
    const db = new Database(dbPath)
    db.exec('CREATE TABLE items (value TEXT NOT NULL)')
    db.close()

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /not ready.*Missing required tables: _migrations/i
    )

    close()
  })

  it('repairs legacy Rust-side migration markers before use', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    const dbPath = createCliDatabasePath(homeDir)
    seedCoreShikinSchema(
      dbPath,
      CLI_DATABASE_MIGRATIONS.filter(
        (migration) => migration !== '001_core_tables' && migration !== '003_credit_cards'
      )
    )
    addCreditCardColumns(dbPath)

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(query<{ ok: number }>('SELECT 1 AS ok')).toEqual([{ ok: 1 }])

    close()

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    expect(
      db
        .prepare(
          "SELECT COUNT(*) as count FROM _migrations WHERE name IN ('001_core_tables', '003_credit_cards') AND applied_at IS NOT NULL AND TRIM(applied_at) != ''"
        )
        .get()
    ).toEqual({ count: 2 })
    db.close()
  })

  it('does not repair the credit-card marker when credit-card columns are missing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(
      createCliDatabasePath(homeDir),
      CLI_DATABASE_MIGRATIONS.filter((migration) => migration !== '003_credit_cards')
    )

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /Missing columns for 003_credit_cards: credit_limit, statement_closing_day, payment_due_day/i
    )

    close()
  })

  it('rejects databases that are missing non-legacy migration markers before use', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    const dbPath = createCliDatabasePath(homeDir)
    seedCoreShikinSchema(dbPath, [])
    addCreditCardColumns(dbPath)

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /Missing required migration metadata: 004_category_rules/i
    )

    close()
  })

  it('rejects databases that are missing any required CLI migration before use', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(
      createCliDatabasePath(homeDir),
      CLI_DATABASE_MIGRATIONS.filter((migration) => migration !== '010_transaction_splits')
    )

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /Missing required migration metadata: 010_transaction_splits/i
    )

    close()
  })

  it('rejects databases with 016 metadata but missing CLI QOL transaction columns', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(createCliDatabasePath(homeDir), CLI_DATABASE_MIGRATIONS, {
      includeCliQolTransactionColumns: false,
    })

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /Missing required columns on transactions: status, source, note, recurring_rule_id/i
    )

    close()
  })

  it('rejects pre-release transaction status columns with unsafe defaults', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(createCliDatabasePath(homeDir), CLI_DATABASE_MIGRATIONS, {
      transactionStatusDefinition: "status TEXT DEFAULT 'pending'",
    })

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /transactions\.status column has an unsafe default/i
    )

    close()
  })

  it('rejects transaction status schemas without verified valid-status protection', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    seedCoreShikinSchema(dbPath)
    const db = new Database(dbPath)
    db.exec('DROP TRIGGER trg_transactions_status_insert_valid')
    db.close()

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /transactions\.status column is missing valid-status protection/i
    )

    close()
  })

  it('rejects databases with 016 metadata but missing CLI QOL tables', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(createCliDatabasePath(homeDir), CLI_DATABASE_MIGRATIONS, {
      includeCliQolTables: false,
    })

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /Missing required tables for 016_cli_qol_foundation: audit_log/i
    )

    close()
  })

  it('creates consistent manual backups and records backup metadata in settings', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    seedCoreShikinSchema(dbPath)
    insertAccount(dbPath, 'live account')

    const {
      backupDatabase,
      close,
      query,
      getDatabaseBackupDirectory,
      getDatabasePath,
      DATABASE_BACKUP_SETTING_KEY,
    } = await importFreshDatabaseModule(homeDir)

    const backup = await backupDatabase()

    expect(backup.path.startsWith(getDatabaseBackupDirectory())).toBe(true)
    expect(backup.path).toMatch(/shikin-\d{8}T\d{9}Z\.db$/)
    expect(backup.sourcePath).toBe(getDatabasePath())
    expect(backup.sizeBytes).toBeGreaterThan(0)
    expect(existsSync(backup.path)).toBe(true)

    const backupDb = new Database(backup.path, { readonly: true, fileMustExist: true })
    expect(backupDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    expect(
      backupDb
        .prepare(
          "SELECT COUNT(*) as count FROM _migrations WHERE applied_at IS NULL OR TRIM(applied_at) = ''"
        )
        .get()
    ).toEqual({ count: 0 })
    backupDb.close()

    const metadataRow = query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [
      DATABASE_BACKUP_SETTING_KEY,
    ])[0]
    const metadata = JSON.parse(metadataRow.value)
    expect(metadata.lastBackup).toMatchObject({ path: backup.path, kind: 'manual' })
    expect(metadata.backups[0]).toMatchObject({ path: backup.path })

    close()
  })

  it('keeps a successful backup when metadata recording fails', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    seedCoreShikinSchema(dbPath)
    insertAccount(dbPath, 'live account')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TRIGGER block_database_backup_metadata
      BEFORE INSERT ON settings
      FOR EACH ROW
      WHEN NEW.key = 'database_backups'
      BEGIN
        SELECT RAISE(ABORT, 'metadata blocked');
      END;
    `)
    db.close()

    const { backupDatabase, close } = await importFreshDatabaseModule(homeDir)

    const backup = await backupDatabase()

    expect(existsSync(backup.path)).toBe(true)
    expect(backup.metadataWarning).toMatch(/metadata blocked/i)

    close()
  })

  it('validates restore dry-runs without mutation metadata', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    const candidatePath = join(homeDir, 'candidate.db')
    seedCoreShikinSchema(dbPath)
    seedCoreShikinSchema(candidatePath)

    const { restoreDatabase, close } = await importFreshDatabaseModule(homeDir)

    const restore = await restoreDatabase({ sourcePath: candidatePath, dryRun: true })

    expect(restore).toMatchObject({
      dryRun: true,
      sourcePath: candidatePath,
      backupValidated: true,
      wouldRestore: true,
      wouldCreateRollback: true,
      applyPreconditionsChecked: false,
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
    })
    if (!restore.dryRun) throw new Error('Expected dry-run restore result')
    expect(restore.applyMayStillFailReasons).toContain('restore_active_handles')
    expect('restoredAt' in restore).toBe(false)
    expect('rollbackPath' in restore).toBe(false)

    close()
  })

  it('restores a validated backup and keeps a rollback copy of the replaced database', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    const candidatePath = join(homeDir, 'candidate.db')
    seedCoreShikinSchema(dbPath)
    insertAccount(dbPath, 'live account')
    seedCoreShikinSchema(candidatePath)
    insertAccount(candidatePath, 'restored account')

    const { restoreDatabase, close } = await importFreshDatabaseModule(homeDir)

    const restore = await restoreDatabase({ sourcePath: candidatePath })

    expect(restore.dryRun).toBe(false)
    if (restore.dryRun) throw new Error('Expected applied restore result')
    expect(restore.sourcePath).toBe(candidatePath)
    expect(restore.rollbackPath).toBeTruthy()
    expect(existsSync(restore.rollbackPath!)).toBe(true)

    const restoredDb = new Database(dbPath, { readonly: true, fileMustExist: true })
    expect(restoredDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'restored account',
    })
    restoredDb.close()

    const rollbackDb = new Database(restore.rollbackPath!, { readonly: true, fileMustExist: true })
    expect(rollbackDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    rollbackDb.close()

    close()
  })

  it('restores over a schema-broken current database without requiring readiness first', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    const candidatePath = join(homeDir, 'candidate.db')
    const brokenDb = new Database(dbPath)
    brokenDb.exec('CREATE TABLE broken_current_db (id TEXT PRIMARY KEY)')
    brokenDb.close()
    seedCoreShikinSchema(candidatePath)
    insertAccount(candidatePath, 'restored account')

    const { restoreDatabase, close } = await importFreshDatabaseModule(homeDir)

    const restore = await restoreDatabase({ sourcePath: candidatePath })

    expect(restore.dryRun).toBe(false)
    if (restore.dryRun) throw new Error('Expected applied restore result')
    const restoredDb = new Database(dbPath, { readonly: true, fileMustExist: true })
    expect(restoredDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'restored account',
    })
    restoredDb.close()

    close()
  })

  it('does not roll back a successful restore when metadata recording fails', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    const candidatePath = join(homeDir, 'candidate.db')
    seedCoreShikinSchema(dbPath)
    insertAccount(dbPath, 'live account')
    seedCoreShikinSchema(candidatePath)
    insertAccount(candidatePath, 'restored account')
    const candidateDb = new Database(candidatePath)
    candidateDb.exec(`
      CREATE TRIGGER block_database_restore_metadata
      BEFORE INSERT ON settings
      FOR EACH ROW
      WHEN NEW.key = 'database_backups'
      BEGIN
        SELECT RAISE(ABORT, 'restore metadata blocked');
      END;
    `)
    candidateDb.close()

    const { restoreDatabase, close } = await importFreshDatabaseModule(homeDir)

    const restore = await restoreDatabase({ sourcePath: candidatePath })

    expect(restore.dryRun).toBe(false)
    if (restore.dryRun) throw new Error('Expected applied restore result')
    expect(restore.metadataWarning).toMatch(/restore metadata blocked/i)
    const restoredDb = new Database(dbPath, { readonly: true, fileMustExist: true })
    expect(restoredDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'restored account',
    })
    restoredDb.close()

    close()
  })

  it('refuses restore sources with adjacent SQLite sidecars', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    const candidatePath = join(homeDir, 'candidate.db')
    const candidateLinkPath = join(homeDir, 'candidate-link.db')
    seedCoreShikinSchema(dbPath)
    insertAccount(dbPath, 'live account')
    seedCoreShikinSchema(candidatePath)
    symlinkSync(candidatePath, candidateLinkPath)
    writeFileSync(`${candidatePath}-wal`, 'uncheckpointed wal placeholder', 'utf8')

    const { restoreDatabase, close } = await importFreshDatabaseModule(homeDir)

    await expect(restoreDatabase({ sourcePath: candidateLinkPath })).rejects.toThrow(
      /sidecar file/i
    )

    const liveDb = new Database(dbPath, { readonly: true, fileMustExist: true })
    expect(liveDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    liveDb.close()

    close()
  })

  it('refuses restore sources that are file-system aliases to the active database', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    const hardLinkPath = join(homeDir, 'active-hardlink.db')
    seedCoreShikinSchema(dbPath)
    insertAccount(dbPath, 'live account')
    linkSync(dbPath, hardLinkPath)

    const { restoreDatabase, close } = await importFreshDatabaseModule(homeDir)

    await expect(restoreDatabase({ sourcePath: hardLinkPath, dryRun: true })).rejects.toThrow(
      /active database file|file-system alias/i
    )

    close()
  })

  it('refuses restore while another handle owns the active database family', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-db-'))
    tempHomes.add(homeDir)
    const dbPath = createCliDatabasePath(homeDir)
    const candidatePath = join(homeDir, 'candidate.db')
    seedCoreShikinSchema(dbPath)
    insertAccount(dbPath, 'live account')
    seedCoreShikinSchema(candidatePath)
    insertAccount(candidatePath, 'restored account')
    const externalHandle = new Database(dbPath, { fileMustExist: true })

    const { restoreDatabase, close } = await importFreshDatabaseModule(homeDir)

    await expect(restoreDatabase({ sourcePath: candidatePath })).rejects.toThrow(
      /still reference the active Shikin database/i
    )

    externalHandle.close()
    close()
  })
})
