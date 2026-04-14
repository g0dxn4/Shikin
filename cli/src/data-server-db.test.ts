// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkpointWal, importDatabaseBuffer } from '../../scripts/data-server-db.mjs'

function createShikinDatabase(
  dbPath: string,
  accountName: string,
  checkpoint = false
): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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
  db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(1, '001_core_tables')
  db.prepare('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)').run(
    'acct-1',
    accountName,
    1000
  )

  if (checkpoint) {
    db.pragma('wal_checkpoint(TRUNCATE)')
  }

  return db
}

function createNonShikinDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE items (value TEXT NOT NULL)')
  db.prepare('INSERT INTO items (value) VALUES (?)').run('other app')
  db.pragma('wal_checkpoint(TRUNCATE)')
  return db
}

function createShikinLikeDatabaseMissingRequiredColumn(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
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
  db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(1, '001_core_tables')
  db.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').run('acct-1', 'missing-balance')
  db.pragma('wal_checkpoint(TRUNCATE)')
  return db
}

function createShikinLikeDatabaseMissingCoreMigration(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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
  db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(999, '999_other_marker')
  db.prepare('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)').run(
    'acct-1',
    'missing-core-migration',
    1000
  )
  db.pragma('wal_checkpoint(TRUNCATE)')
  return db
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'shikin-data-server-'))
}

const tempDirs = new Set<string>()

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('data-server database import hardening', () => {
  it('atomically replaces the live database only after staged validation succeeds', () => {
    const tempDir = createTempDir()
    tempDirs.add(tempDir)

    const livePath = join(tempDir, 'live.db')
    const importedPath = join(tempDir, 'imported.db')
    const importCheckPath = join(tempDir, 'candidate.db')

    const liveDb = createShikinDatabase(livePath, 'live account')
    const importedDb = createShikinDatabase(importedPath, 'imported account', true)
    importedDb.close()

    const buffer = readFileSync(importedPath)

    importDatabaseBuffer({ db: liveDb, dbPath: livePath, buffer, tempDbPath: importCheckPath })

    expect(() => liveDb.prepare('SELECT 1')).toThrow(/closed|not open/i)
    expect(existsSync(importCheckPath)).toBe(false)
    expect(existsSync(`${livePath}-wal`)).toBe(false)
    expect(existsSync(`${livePath}-shm`)).toBe(false)

    const replacedDb = new Database(livePath, { readonly: true, fileMustExist: true })
    expect(replacedDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'imported account',
    })
    replacedDb.close()
  })

  it('rejects a corrupted sqlite buffer without replacing the live database', () => {
    const tempDir = createTempDir()
    tempDirs.add(tempDir)

    const livePath = join(tempDir, 'live.db')
    const importCheckPath = join(tempDir, 'candidate.db')

    const liveDb = createShikinDatabase(livePath, 'live account')

    const corruptedBuffer = Buffer.alloc(4096)
    corruptedBuffer.write('SQLite format 3\0', 0, 'ascii')

    expect(corruptedBuffer.subarray(0, 16).toString('ascii')).toContain('SQLite format 3')
    expect(() =>
      importDatabaseBuffer({
        db: liveDb,
        dbPath: livePath,
        buffer: corruptedBuffer,
        tempDbPath: importCheckPath,
      })
    ).toThrow(/integrity|malformed|database/i)

    expect(existsSync(importCheckPath)).toBe(false)
    expect(liveDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    liveDb.close()

    const unchangedDb = new Database(livePath, { readonly: true, fileMustExist: true })
    expect(unchangedDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    unchangedDb.close()
  })

  it('rejects healthy sqlite files that do not contain Shikin schema markers', () => {
    const tempDir = createTempDir()
    tempDirs.add(tempDir)

    const livePath = join(tempDir, 'live.db')
    const importedPath = join(tempDir, 'other-app.db')
    const importCheckPath = join(tempDir, 'candidate.db')

    const liveDb = createShikinDatabase(livePath, 'live account')
    const incompatibleDb = createNonShikinDatabase(importedPath)
    incompatibleDb.close()

    const hadLiveWalBeforeImport = existsSync(`${livePath}-wal`)
    const buffer = readFileSync(importedPath)

    expect(() =>
      importDatabaseBuffer({ db: liveDb, dbPath: livePath, buffer, tempDbPath: importCheckPath })
    ).toThrow(/not a Shikin database|migration metadata|required tables/i)

    expect(existsSync(importCheckPath)).toBe(false)
    expect(existsSync(`${livePath}-wal`)).toBe(hadLiveWalBeforeImport)
    expect(liveDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    liveDb.close()

    const unchangedDb = new Database(livePath, { readonly: true, fileMustExist: true })
    expect(unchangedDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    unchangedDb.close()
  })

  it('rejects structurally valid sqlite files that are missing required Shikin columns', () => {
    const tempDir = createTempDir()
    tempDirs.add(tempDir)

    const livePath = join(tempDir, 'live.db')
    const importedPath = join(tempDir, 'missing-column.db')
    const importCheckPath = join(tempDir, 'candidate.db')

    const liveDb = createShikinDatabase(livePath, 'live account')
    const missingColumnDb = createShikinLikeDatabaseMissingRequiredColumn(importedPath)
    missingColumnDb.close()

    const buffer = readFileSync(importedPath)

    expect(() =>
      importDatabaseBuffer({ db: liveDb, dbPath: livePath, buffer, tempDbPath: importCheckPath })
    ).toThrow(/missing required Shikin columns.*accounts.*balance/i)

    expect(existsSync(importCheckPath)).toBe(false)
    expect(liveDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    liveDb.close()
  })

  it('rejects Shikin-shaped sqlite files that lack the 001_core_tables migration marker', () => {
    const tempDir = createTempDir()
    tempDirs.add(tempDir)

    const livePath = join(tempDir, 'live.db')
    const importedPath = join(tempDir, 'missing-core-migration.db')
    const importCheckPath = join(tempDir, 'candidate.db')

    const liveDb = createShikinDatabase(livePath, 'live account')
    const missingMigrationDb = createShikinLikeDatabaseMissingCoreMigration(importedPath)
    missingMigrationDb.close()

    const buffer = readFileSync(importedPath)

    expect(() =>
      importDatabaseBuffer({ db: liveDb, dbPath: livePath, buffer, tempDbPath: importCheckPath })
    ).toThrow(/missing required Shikin migration metadata/i)

    expect(existsSync(importCheckPath)).toBe(false)
    expect(liveDb.prepare('SELECT name FROM accounts WHERE id = ?').get('acct-1')).toEqual({
      name: 'live account',
    })
    liveDb.close()
  })

  it('fails closed when a full WAL checkpoint cannot be completed', () => {
    const database = {
      pragma: vi.fn(() => [{ busy: 1, log: 4, checkpointed: 3 }]),
    }

    expect(() => checkpointWal(database as never, { requireComplete: true })).toThrow(
      'Could not fully checkpoint the database WAL before continuing'
    )
  })
})
