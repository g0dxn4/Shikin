// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeRuntimeIdentity, readRuntimeIdentity } from './runtime-identity.js'
const scriptIdentity = (await import(
  /* @vite-ignore */ ['../../scripts', 'runtime-identity.mjs'].join('/')
)) as {
  initializeRuntimeIdentity(appDataDir: string, candidateId: string): string
  readRuntimeIdentity(appDataDir: string): ReturnType<typeof readRuntimeIdentity>
}
const initializeScriptIdentity = scriptIdentity.initializeRuntimeIdentity
const readScriptIdentity = scriptIdentity.readRuntimeIdentity

const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'shikin-runtime-identity-'))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('runtime identity sidecar', () => {
  it('does not create storage when read before initialization', () => {
    const parent = root()
    const missing = join(parent, 'missing-app-data')

    expect(readRuntimeIdentity(missing)).toEqual({ status: 'unavailable', reason: 'missing' })
    expect(readScriptIdentity(missing)).toEqual({ status: 'unavailable', reason: 'missing' })
    expect(existsSync(missing)).toBe(false)
  })

  it('is stable for one root and distinct for a fresh root with copied database lineage', () => {
    const first = root()
    const second = root()
    const firstId = randomUUID()
    writeFileSync(join(first, 'shikin.db'), 'same-lineage')
    writeFileSync(join(second, 'shikin.db'), readFileSync(join(first, 'shikin.db')))

    expect(initializeRuntimeIdentity(first, firstId)).toBe(firstId)
    expect(initializeRuntimeIdentity(first, randomUUID())).toBe(firstId)
    const secondId = initializeRuntimeIdentity(second, randomUUID())

    expect(secondId).not.toBe(firstId)
    expect(readRuntimeIdentity(first)).toEqual({ status: 'available', id: firstId })
    expect(readRuntimeIdentity(second)).toEqual({ status: 'available', id: secondId })
  })

  it('retains the local identity when database contents are restored', () => {
    const appData = root()
    const id = initializeRuntimeIdentity(appData, randomUUID())
    writeFileSync(join(appData, 'shikin.db'), 'before')
    writeFileSync(join(appData, 'shikin.db'), 'restored')

    expect(readRuntimeIdentity(appData)).toEqual({ status: 'available', id })
  })

  it('rejects corrupt and symlink sidecars without overwriting them', () => {
    const corruptRoot = root()
    const corruptPath = join(corruptRoot, 'runtime-identity.json')
    writeFileSync(corruptPath, 'not-json')
    expect(readRuntimeIdentity(corruptRoot)).toEqual({ status: 'unavailable', reason: 'invalid' })
    expect(() => initializeRuntimeIdentity(corruptRoot, randomUUID())).toThrow(
      /refusing to replace/i
    )
    expect(readFileSync(corruptPath, 'utf8')).toBe('not-json')

    if (process.platform !== 'win32') {
      const symlinkRoot = root()
      const target = join(symlinkRoot, 'target')
      writeFileSync(target, 'outside')
      symlinkSync(target, join(symlinkRoot, 'runtime-identity.json'))
      expect(readRuntimeIdentity(symlinkRoot)).toEqual({
        status: 'unavailable',
        reason: 'unsafe',
      })
      expect(() => initializeRuntimeIdentity(symlinkRoot, randomUUID())).toThrow(
        /refusing to replace/i
      )
      expect(readFileSync(target, 'utf8')).toBe('outside')
    }
  })

  it('uses exclusive creation across concurrent hosted startup processes', async () => {
    const appData = root()
    const moduleUrl = new URL('../../scripts/runtime-identity.mjs', import.meta.url).href
    const candidates = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const code = `
      import { initializeRuntimeIdentity } from ${JSON.stringify(moduleUrl)};
      const [appDataDir, candidateId] = process.argv.slice(-2);
      process.stdout.write(initializeRuntimeIdentity(appDataDir, candidateId));
    `
    const initialize = (candidate: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--input-type=module', '-e', code, appData, candidate],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => (stdout += String(chunk)))
        child.stderr.on('data', (chunk) => (stderr += String(chunk)))
        child.once('error', reject)
        child.once('exit', (status) => {
          if (status === 0) resolve(stdout)
          else reject(new Error(stderr || `identity child exited ${status}`))
        })
      })

    const ids = await Promise.all(candidates.map(initialize))
    expect(new Set(ids).size).toBe(1)
    expect(readRuntimeIdentity(appData)).toEqual({ status: 'available', id: ids[0] })
  })

  it('keeps Node and hosted-script status behavior in parity', () => {
    const appData = root()
    const id = randomUUID()
    expect(initializeScriptIdentity(appData, id)).toBe(id)
    expect(readRuntimeIdentity(appData)).toEqual(readScriptIdentity(appData))

    const invalidRoot = root()
    mkdirSync(join(invalidRoot, 'runtime-identity.json'))
    expect(readRuntimeIdentity(invalidRoot)).toEqual(readScriptIdentity(invalidRoot))
  })
})
