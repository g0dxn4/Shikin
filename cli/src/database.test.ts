// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tempHomes = new Set<string>()

function createCliDatabasePath(homeDir: string): string {
  const dataDir = join(homeDir, '.local', 'share', 'com.asf.shikin')
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'shikin.db')
}

function seedCoreShikinSchema(dbPath: string, includeCoreMigration = true): void {
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

  if (includeCoreMigration) {
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(1, '001_core_tables')
  }

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

  it('rejects databases that are missing the core migration marker before use', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-cli-db-'))
    tempHomes.add(homeDir)

    seedCoreShikinSchema(createCliDatabasePath(homeDir), false)

    const { query, close } = await importFreshDatabaseModule(homeDir)

    expect(() => query('SELECT 1 AS ok')).toThrow(
      /Missing required migration metadata: 001_core_tables/i
    )

    close()
  })
})
