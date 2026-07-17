import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getAppDataDir, prepareAppDataDir } from './app-data-dir.mjs'
import { isolatedAppDataEnvironment, shouldUseRealAppData } from './dev-environment.mjs'

const roots = []

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'shikin-dev-env-test-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('development data isolation', () => {
  it('requires the documented explicit opt-in for real app data', () => {
    expect(shouldUseRealAppData({})).toBe(false)
    expect(shouldUseRealAppData({ SHIKIN_BROWSER_USE_REAL_DATA: '1' })).toBe(true)
    expect(shouldUseRealAppData({ SHIKIN_DEV_USE_REAL_DATA: '1' })).toBe(false)
  })

  it('keeps an existing Linux app database in place while preparing the isolated sandbox', () => {
    const root = tempRoot()
    const home = join(root, 'home')
    const sandbox = join(root, 'sandbox')
    const legacyDir = join(home, '.local', 'share', 'com.asf.shikin')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'shikin.db'), 'real-user-data')

    const env = {
      HOME: home,
      ...isolatedAppDataEnvironment(sandbox, 'linux'),
    }
    const isolatedDir = prepareAppDataDir(env, 'linux')

    expect(isolatedDir).toBe(getAppDataDir(env, 'linux'))
    expect(isolatedDir).toBe(join(sandbox, 'com.asf.shikin'))
    expect(readFileSync(join(legacyDir, 'shikin.db'), 'utf8')).toBe('real-user-data')
  })

  it('isolates the native platform data home on macOS and Windows', () => {
    const root = tempRoot()
    expect(isolatedAppDataEnvironment(root, 'darwin')).toEqual({ HOME: root })
    expect(isolatedAppDataEnvironment(root, 'win32')).toEqual({ APPDATA: root })
  })
})
