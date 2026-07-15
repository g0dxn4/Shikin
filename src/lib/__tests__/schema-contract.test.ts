// @vitest-environment node
import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeSqlDefinition,
  readCurrentTableManifest,
  readSchemaContract,
  validateSchemaContract,
  type ShikinSchemaContract,
} from '../../../scripts/check-schema-contract.mjs'
import { validateSqliteExecutableSchema } from '../../../scripts/sqlite-schema-validation.mjs'
import { runTauriMigrations, type TauriDatabase } from '../database'

const V018_FIXTURE = resolve(process.cwd(), 'src/lib/__tests__/fixtures/shikin-empty-v018.db')
const V018_FIXTURE_SIZE = 413_696
const V018_FIXTURE_SHA256 = '9f9ebc1a677679d32c3647115d8b6b7b05bce06b3986617a2b62bef3a1a51e11'
const tempDirs = new Set<string>()
const childProcesses = new Set<ChildProcessWithoutNullStreams>()

afterEach(async () => {
  for (const child of childProcesses) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  childProcesses.clear()
  await delay(25)
  for (const directory of tempDirs) rmSync(directory, { recursive: true, force: true })
  tempDirs.clear()
})

describe('canonical schema contract', () => {
  it('matches adapter constants and exact Tauri schema-history objects', () => {
    expect(validateSchemaContract(resolve(process.cwd())).errors).toEqual([])
  })

  it('matches the complete fresh post-019 schema manifest exactly', async () => {
    const contract = readSchemaContract(resolve(process.cwd()))
    const { dbPath } = await createFreshDataServerDatabase()
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })

    try {
      expect(migrationHistory(db)).toEqual(expectedMigrationHistory(contract))
      expect(readCurrentTableManifest(db)).toEqual(contract.currentSchema.tables)
      expect(readExplicitSchemaObjects(db)).toEqual(contract.allowedSchemaObjects)
      expect(validateSqliteExecutableSchema(db, contract, { mode: 'current' }).mode).toBe('current')
    } finally {
      db.close()
    }
  }, 30_000)

  it('matches the complete fresh GUI/Tauri migration schema exactly', async () => {
    const contract = readSchemaContract(resolve(process.cwd()))
    const db = await createFreshTauriDatabase()

    try {
      expect(migrationHistory(db)).toEqual(expectedMigrationHistory(contract))
      expect(readCurrentTableManifest(db)).toEqual(contract.currentSchema.tables)
      expect(readExplicitSchemaObjects(db)).toEqual(contract.allowedSchemaObjects)
      expect(validateSqliteExecutableSchema(db, contract, { mode: 'current' }).mode).toBe('current')
    } finally {
      db.close()
    }
  })

  it('rejects GUI-only table constraint drift after the production migration path', async () => {
    const contract = readSchemaContract(resolve(process.cwd()))
    const db = await createFreshTauriDatabase()

    try {
      const row = db
        .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'accounts'")
        .get() as { sql: string }
      const drifted = row.sql.replace("'snapshot_only'", "'snapshot_only_gui_drift'")
      expect(drifted).not.toBe(row.sql)
      db.unsafeMode(true)
      db.pragma('writable_schema = ON')
      db.prepare("UPDATE sqlite_schema SET sql = ? WHERE type = 'table' AND name = 'accounts'").run(
        drifted
      )
      db.pragma('writable_schema = OFF')
      db.unsafeMode(false)
      const schemaVersion = db.pragma('schema_version', { simple: true }) as number
      db.pragma(`schema_version = ${schemaVersion + 1}`)

      expect(() => validateSqliteExecutableSchema(db, contract, { mode: 'current' })).toThrowError(
        'current table accounts differs from its contracted CREATE TABLE definition'
      )
      expect(readCurrentTableManifest(db)).not.toEqual(contract.currentSchema.tables)
    } finally {
      db.close()
    }
  })

  it('rejects a fresh schema missing a non-readiness core column', async () => {
    const contract = readSchemaContract(resolve(process.cwd()))
    const { dbPath } = await createFreshDataServerDatabase()
    const db = new Database(dbPath, { fileMustExist: true })

    try {
      expect(contract.readiness.gui.currentTables.transactions).not.toContain('currency')
      db.exec('ALTER TABLE transactions DROP COLUMN currency')
      expect(() => assertCompleteSchema(db, contract)).toThrowError(
        'Database does not exactly match the complete current-schema manifest'
      )
      expect(columnNames(db, 'transactions')).not.toContain('currency')
    } finally {
      db.close()
    }
  }, 30_000)

  it('characterizes the real runtime-engine 018 to migration-SQL 019 upgrade', () => {
    const contract = readSchemaContract(resolve(process.cwd()))
    const fixtureBytes = readFileSync(V018_FIXTURE)
    expect(fixtureBytes.byteLength).toBe(V018_FIXTURE_SIZE)
    expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(V018_FIXTURE_SHA256)

    const directory = mkdtempSync(join(tmpdir(), 'shikin-v018-upgrade-'))
    tempDirs.add(directory)
    const dbPath = join(directory, 'shikin.db')
    copyFileSync(V018_FIXTURE, dbPath)
    const db = new Database(dbPath, { fileMustExist: true })
    db.pragma('foreign_keys = ON')

    try {
      expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
      const fixtureMigrationNames = migrationNames(db)
      expect(fixtureMigrationNames).toEqual(contract.migrationNames.slice(0, -1))
      expect(fixtureMigrationNames[fixtureMigrationNames.length - 1]).toBe(
        '018_placeholder_transactions'
      )
      expect(columnNames(db, 'accounts')).not.toContain('account_mode')
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
          )
          .all()
          .filter((row) => (row as { name: string }).name !== '_migrations')
          .every((row) => {
            const tableName = (row as { name: string }).name
            return (
              (
                db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as {
                  count: number
                }
              ).count === 0
            )
          })
      ).toBe(true)

      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance)
         VALUES ('legacy-account', 'Dummy legacy account', 'checking', 'USD', 12345)`
      ).run()
      db.prepare(
        `INSERT INTO transactions (
           id, account_id, type, amount, currency, description, date,
           is_placeholder, placeholder_status, placeholder_reason
         ) VALUES (
           'legacy-transaction', 'legacy-account', 'expense', 500, 'USD',
           'Dummy pre-019 row', '2026-01-01', 1, 'pending', 'Dummy fixture reason'
         )`
      ).run()

      const accountColumnsBefore = columnNames(db, 'accounts')
      const transactionColumnsBefore = columnNames(db, 'transactions')
      const objectNamesBefore = explicitSchemaObjectNames(db)

      db.exec(readMigration('019_financial_semantics'))
      db.prepare('INSERT INTO _migrations (id, name) VALUES (19, ?)').run('019_financial_semantics')

      expect(difference(columnNames(db, 'accounts'), accountColumnsBefore)).toEqual([
        'account_mode',
      ])
      expect(difference(transactionColumnsBefore, columnNames(db, 'transactions'))).toEqual([])
      expect(difference(columnNames(db, 'transactions'), transactionColumnsBefore).sort()).toEqual(
        [
          'is_archived',
          'ledger_treatment',
          'matched_transaction_id',
          'reconciliation_id',
          'reporting_treatment',
          'staging_batch_id',
          'transaction_kind',
        ].sort()
      )
      expect(
        db.prepare(`SELECT account_mode FROM accounts WHERE id = 'legacy-account'`).get()
      ).toEqual({ account_mode: 'transactional' })
      expect(
        db
          .prepare(
            `SELECT ledger_treatment, reporting_treatment, transaction_kind, is_archived
             FROM transactions WHERE id = 'legacy-transaction'`
          )
          .get()
      ).toEqual({
        ledger_treatment: 'normal',
        reporting_treatment: 'normal',
        transaction_kind: 'standard',
        is_archived: 0,
      })
      expect(columnNames(db, 'account_reconciliations')).toEqual(
        contract.readiness.gui.currentTables.account_reconciliations
      )
      expect(columnNames(db, 'receivables')).toEqual(
        contract.readiness.gui.currentTables.receivables
      )

      const newlyCreatedNames = difference(explicitSchemaObjectNames(db), objectNamesBefore).sort()
      const expected019ObjectNames = [
        ...contract.migrationSchemaObjects['019_financial_semantics'].indexes,
        ...contract.migrationSchemaObjects['019_financial_semantics'].triggers,
        ...contract.migrationSchemaObjects['019_financial_semantics'].views,
      ].sort()
      expect(newlyCreatedNames).toEqual(expected019ObjectNames)

      const contractedObjects = new Map(
        [
          ...contract.allowedSchemaObjects.indexes,
          ...contract.allowedSchemaObjects.triggers,
          ...contract.allowedSchemaObjects.views,
        ].map((object) => [object.name, object.sql])
      )
      for (const object of readExplicitSchemaObjectRows(db).filter((row) =>
        newlyCreatedNames.includes(row.name)
      )) {
        expect(contractedObjects.get(object.name), object.name).toBe(
          normalizeSqlDefinition(object.sql)
        )
      }
      expect(migrationHistory(db)).toEqual(expectedMigrationHistory(contract))
      expect(readCurrentTableManifest(db)).toEqual(contract.currentSchema.tables)
      expect(validateSqliteExecutableSchema(db, contract, { mode: 'current' }).mode).toBe('current')
    } finally {
      db.close()
    }
  })
})

async function createFreshTauriDatabase(): Promise<Database.Database> {
  const db = new Database(':memory:')
  const adapter: TauriDatabase = {
    select: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T,
    execute: async (sql: string, params: unknown[] = []) => {
      const result = db.prepare(sql).run(...params)
      return {
        rowsAffected: result.changes,
        lastInsertId: Number(result.lastInsertRowid),
      }
    },
    close: async () => {},
  }
  await adapter.execute('PRAGMA foreign_keys = ON')
  await runTauriMigrations(adapter)
  return db
}

async function createFreshDataServerDatabase(): Promise<{ dbPath: string }> {
  const port = await getFreePort()
  const directory = mkdtempSync(join(tmpdir(), 'shikin-schema-contract-'))
  tempDirs.add(directory)
  const dataHome = join(directory, 'data')
  const child = spawn(process.execPath, [resolve(process.cwd(), 'scripts/data-server.mjs')], {
    env: {
      ...process.env,
      HOME: directory,
      XDG_DATA_HOME: dataHome,
      SHIKIN_DATA_SERVER_PORT: String(port),
      SHIKIN_DATA_SERVER_BRIDGE_TOKEN: 'schema-contract-test',
    },
    stdio: 'pipe',
  })
  childProcesses.add(child)

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (output.includes('[data-server] Listening')) {
      child.kill('SIGTERM')
      await waitForExit(child)
      childProcesses.delete(child)
      return { dbPath: join(dataHome, 'com.asf.shikin', 'shikin.db') }
    }
    if (child.exitCode !== null) throw new Error(`data-server exited early: ${output}`)
    await delay(25)
  }
  throw new Error(`Timed out creating fresh schema: ${output}`)
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to reserve a test port'))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
}

function readMigration(name: string): string {
  return readFileSync(resolve(process.cwd(), `src-tauri/migrations/${name}.sql`), 'utf8')
}

function migrationHistory(db: Database.Database): Array<{ id: number; name: string }> {
  return db.prepare('SELECT id, name FROM _migrations ORDER BY id').all() as Array<{
    id: number
    name: string
  }>
}

function expectedMigrationHistory(
  contract: ShikinSchemaContract
): Array<{ id: number; name: string }> {
  return contract.migrationNames.map((name) => ({ id: Number(name.slice(0, 3)), name }))
}

function migrationNames(db: Database.Database): string[] {
  return migrationHistory(db).map((row) => row.name)
}

function columnNames(db: Database.Database, tableName: string): string[] {
  return db
    .prepare("SELECT * FROM pragma_table_info(?, 'main')")
    .all(tableName)
    .map((row) => (row as { name: string }).name)
}

function assertCompleteSchema(db: Database.Database, contract: ShikinSchemaContract): void {
  if (
    JSON.stringify(readCurrentTableManifest(db)) !== JSON.stringify(contract.currentSchema.tables)
  ) {
    throw new Error('Database does not exactly match the complete current-schema manifest')
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function difference(values: string[], excluded: string[]): string[] {
  const excludedSet = new Set(excluded)
  return values.filter((value) => !excludedSet.has(value))
}

function readExplicitSchemaObjectRows(db: Database.Database) {
  return db
    .prepare(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL ORDER BY type, name"
    )
    .all() as Array<{
    type: 'index' | 'trigger' | 'view'
    name: string
    tableName: string
    sql: string
  }>
}

function explicitSchemaObjectNames(db: Database.Database): string[] {
  return readExplicitSchemaObjectRows(db).map((row) => row.name)
}

function readExplicitSchemaObjects(db: Database.Database) {
  const result: Record<'indexes' | 'triggers' | 'views', Array<Record<string, string>>> = {
    indexes: [],
    triggers: [],
    views: [],
  }
  for (const row of readExplicitSchemaObjectRows(db)) {
    const key = row.type === 'index' ? 'indexes' : row.type === 'trigger' ? 'triggers' : 'views'
    result[key].push({
      name: row.name,
      table: row.tableName,
      sql: normalizeSqlDefinition(row.sql),
    })
  }
  return result
}
