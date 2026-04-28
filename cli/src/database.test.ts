// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'

const tempHomes = new Set<string>()

function createCliDatabasePath(homeDir: string): string {
  const dataDir = join(homeDir, '.local', 'share', 'com.asf.shikin')
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'shikin.db')
}

function seedCoreShikinSchema(
  dbPath: string,
  migrations: readonly string[] = CLI_DATABASE_MIGRATIONS
): void {
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
    );
  `)

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

async function importFreshDatabaseModule(homeDir: string) {
  vi.stubEnv('HOME', homeDir)
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
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
    tempHomes.add(homeDir)

    const { REQUIRED_MIGRATIONS } = await importFreshDatabaseModule(homeDir)
    const { CLI_DATABASE_MIGRATIONS: sharedMigrations } = await import('./migrations.js')

    expect(REQUIRED_MIGRATIONS).toBe(sharedMigrations)
    expect(REQUIRED_MIGRATIONS).toHaveLength(11)
  })

  it('allows queries once the shared Shikin schema is ready', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(createCliDatabasePath(homeDir))

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(query<{ ok: number }>('SELECT 1 AS ok')).toEqual([{ ok: 1 }])

    close()
  })

  it('rejects databases that are missing required core tables before use', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
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
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
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
  })

  it('does not repair the credit-card marker when credit-card columns are missing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
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
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
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
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
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
})
