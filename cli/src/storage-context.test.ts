// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SHIKIN_APP_ID, createStorageContext } from './app-data-dir.js'
import {
  NativeSqliteBindingError,
  prepareStorageForWrite,
  validateNativeSqliteBinding,
} from './storage-context.js'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'shikin-storage-context-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('native SQLite storage prerequisite', () => {
  it('leaves legacy marker families and modes unchanged when the binding probe fails', () => {
    const root = tempRoot()
    const home = join(root, 'home')
    const data = join(root, 'custom-data')
    const config = join(root, 'config')
    const legacyDir = join(home, '.local', 'share', SHIKIN_APP_ID)
    const configDir = join(config, SHIKIN_APP_ID)
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    const legacyDb = join(legacyDir, 'shikin.db')
    const configDb = join(configDir, 'shikin.db')
    writeFileSync(legacyDb, 'legacy')
    writeFileSync(configDb, 'config')
    chmodSync(legacyDb, 0o644)
    chmodSync(configDb, 0o640)

    const context = createStorageContext({
      HOME: home,
      XDG_DATA_HOME: data,
      XDG_CONFIG_HOME: config,
      SHIKIN_MIGRATE_LEGACY_DATA: '1',
    })
    class WrongAbiDatabase {
      constructor(_filename: string) {
        throw new Error('NODE_MODULE_VERSION mismatch')
      }
      close() {
        // Constructor always throws; required only by the injected test interface.
      }
    }

    expect(() => prepareStorageForWrite(context, WrongAbiDatabase)).toThrow(
      NativeSqliteBindingError
    )
    expect(readFileSync(legacyDb, 'utf8')).toBe('legacy')
    expect(readFileSync(configDb, 'utf8')).toBe('config')
    expect(statSync(legacyDb).mode & 0o777).toBe(0o644)
    expect(statSync(configDb).mode & 0o777).toBe(0o640)
    expect(existsSync(context.appDataDir)).toBe(false)
  })

  it('closes and caches a successful in-memory probe per immutable context', () => {
    const root = tempRoot()
    const context = createStorageContext({
      HOME: join(root, 'home'),
      XDG_DATA_HOME: join(root, 'data'),
      SHIKIN_RESPECT_XDG_DATA_HOME: '1',
    })
    let opened = 0
    let closed = 0
    class MockDatabase {
      constructor(filename: string) {
        expect(filename).toBe(':memory:')
        opened += 1
      }
      close() {
        closed += 1
      }
    }

    validateNativeSqliteBinding(context, MockDatabase)
    validateNativeSqliteBinding(context, MockDatabase)

    expect({ opened, closed }).toEqual({ opened: 1, closed: 1 })
  })
})
