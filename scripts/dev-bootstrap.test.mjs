// @vitest-environment node
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const roots = []
const children = []

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'shikin-dev-bootstrap-'))
  roots.push(root)
  return root
}

function writeScript(root, relativePath, source) {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
}

function createFixtureWorkspace() {
  const root = tempRoot()

  writeScript(root, 'scripts/dev.mjs', readFileSync(join(scriptDir, 'dev.mjs'), 'utf8'))
  writeScript(
    root,
    'scripts/dev-environment.mjs',
    readFileSync(join(scriptDir, 'dev-environment.mjs'), 'utf8')
  )

  writeScript(
    root,
    'node_modules/typescript/package.json',
    `${JSON.stringify({ name: 'typescript' })}\n`
  )
  writeScript(
    root,
    'node_modules/typescript/bin/tsc',
    `const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const logFile = process.env.SHIKIN_BOOTSTRAP_LOG
if (logFile) {
  appendFileSync(logFile, \`tsc \${process.argv.slice(2).join(' ')}\\n\`)
}
if (process.env.SHIKIN_TSC_FAIL === '1') {
  process.exit(2)
}
const dist = join(process.cwd(), 'packages/finance-core/dist')
mkdirSync(dist, { recursive: true })
writeFileSync(join(dist, 'index.js'), "export const ok = 'compiled'\\n")
`
  )

  writeScript(root, 'node_modules/vite/package.json', `${JSON.stringify({ name: 'vite' })}\n`)
  writeScript(
    root,
    'node_modules/vite/bin/vite.js',
    `const { appendFileSync } = require('node:fs')
appendFileSync(process.env.SHIKIN_BOOTSTRAP_LOG, 'vite\\n')
setInterval(() => {}, 1 << 30)
`
  )

  writeScript(
    root,
    'packages/finance-core/package.json',
    `${JSON.stringify({ name: '@shikin/finance-core', type: 'module' })}\n`
  )
  writeScript(
    root,
    'packages/finance-core/tsconfig.json',
    `${JSON.stringify({
      compilerOptions: { rootDir: 'src', outDir: 'dist' },
      include: ['src/**/*.ts'],
    })}\n`
  )
  writeScript(root, 'packages/finance-core/src/index.ts', "export const ok = 'source'\\n")

  writeScript(
    root,
    'scripts/data-server.mjs',
    `import { appendFileSync } from 'node:fs'
import { ok } from '../packages/finance-core/dist/index.js'
appendFileSync(process.env.SHIKIN_BOOTSTRAP_LOG, \`data-server:\${ok}\\n\`)
setInterval(() => {}, 1 << 30)
`
  )

  mkdirSync(join(root, 'tmp'), { recursive: true })
  return root
}

function spawnDev(root, extraEnv = {}) {
  const logFile = join(root, 'bootstrap.log')
  const tmp = join(root, 'tmp')
  const stdout = []
  const stderr = []
  const child = spawn(process.execPath, [join(root, 'scripts/dev.mjs')], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      TMPDIR: tmp,
      SHIKIN_BOOTSTRAP_LOG: logFile,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => stdout.push(chunk))
  child.stderr.on('data', (chunk) => stderr.push(chunk))
  children.push(child)
  return {
    child,
    logFile,
    tmp,
    output() {
      return `${Buffer.concat(stdout).toString('utf8')}${Buffer.concat(stderr).toString('utf8')}`
    },
  }
}

function readLog(logFile) {
  try {
    return readFileSync(logFile, 'utf8')
  } catch {
    return ''
  }
}

function isolatedDataDirs(tmp) {
  return readdirSync(tmp).filter((name) => name.startsWith('shikin-dev-data-'))
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function waitUntil(predicate, describeFailure, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(describeFailure())
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await waitForExit(child)
    }
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('dev bootstrap finance-core compile', () => {
  it('compiles a missing finance-core dist before any consumer or isolated data root', async () => {
    const root = createFixtureWorkspace()
    const distFile = join(root, 'packages/finance-core/dist/index.js')
    expect(existsSync(distFile)).toBe(false)

    const run = spawnDev(root)
    await waitUntil(
      () => readLog(run.logFile).includes('data-server:compiled'),
      () =>
        `consumers started before a successful compile\nlog:\n${readLog(run.logFile)}\noutput:\n${run.output()}`
    )

    expect(readLog(run.logFile).trim().split('\n')[0]).toBe(
      'tsc -p packages/finance-core/tsconfig.json'
    )
    expect(readFileSync(distFile, 'utf8')).toContain("export const ok = 'compiled'")
    expect(isolatedDataDirs(run.tmp)).not.toEqual([])

    run.child.kill('SIGTERM')
    await waitForExit(run.child)
  })

  it('always recompiles finance-core even when a stale dist already exists', async () => {
    const root = createFixtureWorkspace()
    const distDir = join(root, 'packages/finance-core/dist')
    mkdirSync(distDir, { recursive: true })
    writeFileSync(join(distDir, 'index.js'), "export const ok = 'stale'\n")

    const run = spawnDev(root)
    await waitUntil(
      () => readLog(run.logFile).includes('data-server:compiled'),
      () =>
        `stale dist was consumed without recompile\nlog:\n${readLog(run.logFile)}\noutput:\n${run.output()}`
    )

    expect(readLog(run.logFile)).toContain('tsc -p packages/finance-core/tsconfig.json')
    expect(readLog(run.logFile)).not.toContain('data-server:stale')

    run.child.kill('SIGTERM')
    await waitForExit(run.child)
  })

  it('propagates a nonzero compile status without starting servers or preparing data', async () => {
    const root = createFixtureWorkspace()
    const run = spawnDev(root, { SHIKIN_TSC_FAIL: '1' })
    const { code } = await waitForExit(run.child)

    expect(code, run.output()).toBe(2)
    expect(readLog(run.logFile).trim()).toBe('tsc -p packages/finance-core/tsconfig.json')
    expect(existsSync(join(root, 'packages/finance-core/dist/index.js'))).toBe(false)
    expect(isolatedDataDirs(run.tmp)).toEqual([])
  })
})
