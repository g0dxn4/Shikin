// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shikin-readonly-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
function run(code: string, dataRoot = root) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import * as db from ${JSON.stringify(new URL('./database.ts', import.meta.url).href)}; ${code}`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          XDG_DATA_HOME: dataRoot,
          SHIKIN_RESPECT_XDG_DATA_HOME: '1',
          SHIKIN_MIGRATE_LEGACY_DATA: '0',
        },
      }
    )
  )
}
describe('read-only MCP database connection', () => {
  it('reads with deferred transactions and blocks writes, backup, restore and permission widening', () => {
    const appDir = join(root, 'com.asf.shikin')
    mkdirSync(appDir)
    const dbPath = join(appDir, 'shikin.db')
    const fixture = new Database(dbPath)
    fixture.pragma('foreign_keys = ON')
    runHostedTestMigrations(fixture)
    fixture.exec(
      "INSERT INTO accounts (id,name,type,currency,balance) VALUES ('a','A','checking','MXN',1234)"
    )
    fixture.close()
    const before = readFileSync(dbPath)
    const mode = statSync(dbPath).mode
    const result = run(`
      db.configureDatabaseReadOnly(true);
      const rows = db.transaction(() => db.query('SELECT balance FROM accounts'));
      const failures = [];
      for (const operation of [
        () => db.execute("UPDATE accounts SET balance=0"),
        () => db.query("UPDATE accounts SET balance=0 RETURNING id"),
        () => db.backupDatabase(),
        () => db.restoreDatabase({sourcePath:'/nonexistent-backup',dryRun:true}),
        () => db.configureDatabaseReadOnly(false),
      ]) { try { await operation(); failures.push(false); } catch { failures.push(true); } }
      db.close();
      console.log(JSON.stringify({rows,failures}));
    `)
    expect(result).toEqual({ rows: [{ balance: 1234 }], failures: [true, true, true, true, true] })
    expect(readFileSync(dbPath)).toEqual(before)
    expect(statSync(dbPath).mode).toBe(mode)
    expect(existsSync(join(appDir, 'backups'))).toBe(false)
  })

  it('does not create missing storage or migrate an old schema', () => {
    const missing = join(root, 'missing')
    expect(
      run(
        `db.configureDatabaseReadOnly(true); try { db.query('SELECT 1'); } catch (error) { console.log(JSON.stringify({message:error.message})); }`,
        missing
      ).message
    ).toMatch(/does not exist/)
    expect(existsSync(missing)).toBe(false)
    const appDir = join(root, 'com.asf.shikin')
    mkdirSync(appDir)
    const path = join(appDir, 'shikin.db')
    const fixture = new Database(path)
    fixture.exec('CREATE TABLE legacy_marker (value TEXT)')
    fixture.close()
    const before = readFileSync(path)
    expect(
      run(
        `db.configureDatabaseReadOnly(true); try { db.query('SELECT 1'); } catch (error) { console.log(JSON.stringify({message:error.message})); }`
      ).message
    ).toMatch(/not ready/)
    expect(readFileSync(path)).toEqual(before)
  })
})
