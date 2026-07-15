// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
const originalHome = process.env.HOME
const originalXdgDataHome = process.env.XDG_DATA_HOME

afterEach(() => {
  process.env.HOME = originalHome
  process.env.XDG_DATA_HOME = originalXdgDataHome
  vi.resetModules()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CLI database operation lock adapter', () => {
  it('is a thin, import-safe adapter around the shared Node implementation', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'shikin-lock-adapter-'))
    roots.push(sandbox)
    const forbiddenHome = join(sandbox, 'forbidden-home')
    process.env.HOME = forbiddenHome
    process.env.XDG_DATA_HOME = join(forbiddenHome, 'xdg')

    const adapter = await import('./database-operation-lock.js')
    const shared = await import('../../scripts/database-operation-lock.mjs')
    expect(adapter.DatabaseOperationLock).toBe(shared.DatabaseOperationLock)
    expect(existsSync(forbiddenHome)).toBe(false)

    const rootDir = join(sandbox, 'explicit-root')
    const lock = new adapter.DatabaseOperationLock({
      rootDir,
      databaseIdentity: adapter.SHIKIN_DATABASE_IDENTITY,
      runtimeId: 'cli',
    })
    expect(existsSync(rootDir)).toBe(false)
    expect(lock.registerRuntimeLease()).toMatchObject({ recordKind: 'runtime_lease' })
    expect(existsSync(rootDir)).toBe(true)
  })
})
