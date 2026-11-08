// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Run the real entrypoints in a fresh module graph. Only external effects are
// substituted, so listen completion is an explicit barrier rather than a timer.
const STARTUP_PROBE = String.raw`
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
const [root, scenario, port, fault] = process.argv.slice(1)
const trace = []
const env = { SHIKIN_DATA_SERVER_PORT: 'old-port', SHIKIN_WEB_HOSTED: 'old-mode', SHIKIN_WEB_STATIC_ROOT: 'old-root' }
if (scenario === 'direct') {
  delete env.SHIKIN_WEB_HOSTED
  delete env.SHIKIN_WEB_STATIC_ROOT
  if (port === 'default') delete env.SHIKIN_DATA_SERVER_PORT
  else env.SHIKIN_DATA_SERVER_PORT = port
}
let marker = null
let listening
let requestHandler
const signals = new Map()
const server = { listen(port, host, callback) { trace.push(['listen', port, host]); listening = callback } }
const context = createContext({
  URL, Buffer, Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-01-02T03:04:05.000Z'])) } },
  console: { log: (...args) => trace.push(['log', ...args]), error: (...args) => trace.push(['error', ...args]) },
  process: { env, pid: 123, once: (signal, callback) => { trace.push(['signal', signal]); signals.set(signal, callback) }, kill() {} },
})
const fs = {
  existsSync(path) { return String(path).endsWith('index.html') ? fault !== 'assets' : fault === 'restore' && String(path).endsWith('restore.lock') },
  readFileSync(path) { if (String(path).endsWith('package.json')) { trace.push(['version']); return '{"version":"1.2.1"}' }; return JSON.stringify(marker) },
  statSync() { trace.push(['static']); return { isDirectory: () => fault !== 'static' } },
  openSync(path, flags, mode) { trace.push(['marker:open', flags, mode]); return 7 },
  writeFileSync(fd, value) { marker = JSON.parse(value); trace.push(['marker:write', marker]) },
  closeSync() { trace.push(['marker:close']) },
  rmSync() { marker = null; trace.push(['marker:release']) },
  mkdirSync() {}, unlinkSync() {}, readdirSync() {}, lstatSync() {}, realpathSync() {}, createReadStream() {},
}
const modules = new Map()
const evaluations = new Map()
async function synthetic(id, values) {
  if (!modules.has(id)) modules.set(id, new SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value)
  }, { context, identifier: id }))
  return modules.get(id)
}
async function load(id) {
  if (modules.has(id)) return modules.get(id)
  let source = readFileSync(id, 'utf8')
  if (id.endsWith('.ts')) source = stripTypeScriptTypes(source)
  const module = new SourceTextModule(source, {
    context, identifier: id,
    initializeImportMeta(meta) { meta.url = pathToFileURL(id).href },
    importModuleDynamically: async (specifier, parent) => {
      const child = await link(specifier, parent)
      if (!evaluations.has(child)) evaluations.set(child, (async () => {
        if (child.status === 'unlinked') await child.link(link)
        if (child.status === 'linked') await child.evaluate()
        if (child.status === 'errored') throw child.error
        return child
      })())
      return evaluations.get(child)
    },
  })
  modules.set(id, module)
  return module
}
async function link(specifier, parent) {
  if (specifier === 'node:fs') return synthetic(specifier, fs)
  if (specifier === 'node:http') return synthetic(specifier, { createServer(handler) { trace.push(['server']); requestHandler = handler; return server } })
  if (specifier === 'better-sqlite3') return synthetic(specifier, { default: class {
    constructor(path) { trace.push(['probe', path]); if (fault === 'native') throw new Error('native failure') }
    close() { trace.push(['probe:close']) }
  } })
  if (specifier.endsWith('/app-data-dir.mjs')) return synthetic(specifier, {
    PRIVATE_DIR_MODE: 448, PRIVATE_FILE_MODE: 384,
    createStorageContext() { trace.push(['context']); return { databasePath: '/data/shikin.db', restoreLockPath: '/data/restore.lock' } },
    prepareStorageContext() { trace.push(['prepare']); return '/data' },
    ensurePrivateDirectory() {}, hardenPathMode() { trace.push(['harden']) },
  })
  if (specifier.endsWith('/data-server-session.mjs')) return synthetic(specifier, { createDatabaseSession() {
    trace.push(['session'])
    return {
      initialize(callback) { trace.push(['migrations']); if (fault === 'migration') throw new Error('migration failure'); callback() },
      shutdown(signal, actualServer, release) { trace.push(['shutdown', signal, actualServer === server]); release(); trace.push(['exit', 0]) },
    }
  } })
  if (specifier.endsWith('/runtime-identity.mjs')) return synthetic(specifier, {
    initializeRuntimeIdentity(dir, id) { trace.push(['identity', dir, id]) }, readRuntimeIdentity() {},
  })
  if (specifier === 'node:crypto') return synthetic(specifier, { randomUUID: () => 'fixed-id' })
  if (specifier === 'dayjs') return synthetic(specifier, { default() {} })
  if (specifier === 'ulidx') return synthetic(specifier, { ulid() {} })
  if (specifier.startsWith('@shikin/')) {
    // Import names, not a second implementation of migration behavior. Actual
    // migration SQL/SQLite coverage lives in the migration and HTTP suites.
    const source = readFileSync(parent.identifier, 'utf8')
    const names = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)]
      .filter((match) => match[2] === specifier).flatMap((match) => match[1].split(',').map((name) => name.trim()).filter(Boolean))
    return synthetic(parent.identifier + specifier, Object.fromEntries(names.map((name) => [name, () => {}])))
  }
  if (specifier.startsWith('node:')) return synthetic(specifier, await import(specifier))
  return load(resolve(dirname(parent.identifier), specifier))
}
const entry = await load(resolve(root, scenario === 'direct' ? 'scripts/data-server.mjs' : ['inert', 'explicit'].includes(scenario) ? 'scripts/data-server-runtime.mjs' : 'cli/src/web-host.ts'))
const outcomes = []
await entry.link(link)
if (scenario === 'direct') {
  try { await entry.evaluate(); outcomes.push('resolved') } catch (error) { outcomes.push(error.message) }
} else if (scenario === 'inert') {
  await entry.evaluate()
  outcomes.push('imported')
} else if (scenario === 'explicit') {
  await entry.evaluate()
  const first = entry.namespace.startDataServer({ port: 8480, hostedMode: true, staticRoot: '/explicit/web', storageEnvironment: env })
  const second = entry.namespace.startDataServer({ port: 9001, hostedMode: false, staticRoot: null, storageEnvironment: env })
  outcomes.push(first === second && first.server === server && typeof first.shutdown === 'function' ? 'same handle' : 'different handle')
} else if (scenario === 'concurrent') {
  await entry.evaluate()
  await Promise.all([entry.namespace.startWebHost(), entry.namespace.startWebHost('9001')])
  outcomes.push('resolved', 'resolved')
} else {
  await entry.evaluate()
  let previousError
  for (const value of [port === 'default' ? undefined : port, '9001']) {
    try { await entry.namespace.startWebHost(value); outcomes.push('resolved') }
    catch (error) { outcomes.push(error.message); if (previousError) outcomes.push(error === previousError ? 'same error' : 'different error'); previousError = error }
  }
}
trace.push(['completed', !!listening])
if (listening) {
  listening()
  const response = { req: { method: 'GET' }, writeHead(status, headers) { trace.push(['http:headers', status, headers]) }, end(body) { trace.push(['http:body', body]) } }
  await requestHandler({ url: '/api/store', method: 'GET', headers: { host: '127.0.0.1:8480' } }, response)
  signals.get('SIGTERM')()
}
const normalize = (value) => JSON.parse(JSON.stringify(value).split(root).join('<root>'))
process.stdout.write(JSON.stringify(normalize({ outcomes, env, trace, marker })))
`

function probe(
  scenario: 'cli' | 'direct' | 'inert' | 'concurrent' | 'explicit',
  port = 'default',
  fault = ''
) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      '--input-type=module',
      '-e',
      STARTUP_PROBE,
      resolve('.'),
      scenario,
      port,
      fault,
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

const bootstrap = [
  ['version'],
  ['static'],
  ['context'],
  ['probe', ':memory:'],
  ['probe:close'],
  ['prepare'],
  ['marker:open', 'wx', 384],
  ['marker:write', { pid: 123, port: 8480, startedAt: '2026-01-02T03:04:05.000Z' }],
  ['marker:close'],
  ['harden'],
  ['session'],
  ['migrations'],
  ['identity', '/data', 'fixed-id'],
  ['server'],
  ['signal', 'SIGINT'],
  ['signal', 'SIGTERM'],
  ['listen', 8480, '127.0.0.1'],
  ['completed', true],
]

describe('hosted startup boundary characterization', () => {
  it('imports the runtime without acquiring storage, probing SQLite, signals or listening', () => {
    const result = probe('inert')
    expect(result.trace).toEqual([['version'], ['completed', false]])
    expect(result.outcomes).toEqual(['imported'])
    expect(result.env).toEqual({
      SHIKIN_DATA_SERVER_PORT: 'old-port',
      SHIKIN_WEB_HOSTED: 'old-mode',
      SHIKIN_WEB_STATIC_ROOT: 'old-root',
    })
  })

  it('starts from explicit inputs, not the three outward environment variables', () => {
    const result = probe('explicit')
    expect(result.outcomes).toEqual(['same handle'])
    expect(result.trace.slice(0, bootstrap.length)).toEqual(bootstrap)
    expect(result.env).toEqual({
      SHIKIN_DATA_SERVER_PORT: 'old-port',
      SHIKIN_WEB_HOSTED: 'old-mode',
      SHIKIN_WEB_STATIC_ROOT: 'old-root',
    })
    expect(result.marker).toBeNull()
  })

  it('uses the last validated call before concurrent imports finish, but starts only once', () => {
    const result = probe('concurrent')
    expect(result.outcomes).toEqual(['resolved', 'resolved'])
    expect(result.trace.filter((event: unknown[]) => event[0] === 'listen')).toEqual([
      ['listen', 9001, '127.0.0.1'],
    ])
    expect(result.trace.filter((event: unknown[]) => event[0] === 'marker:write')).toEqual([
      ['marker:write', { pid: 123, port: 9001, startedAt: '2026-01-02T03:04:05.000Z' }],
    ])
  })

  it.each([
    ['static', 'Hosted web static root is not a directory: <root>/cli/web', 2],
    ['restore', 'Cannot start hosted web access while a database restore is in progress.', 6],
  ] as const)('preserves %s failure precedence and cached failure', (fault, message, boundary) => {
    const result = probe('cli', 'default', fault)
    expect(result.outcomes).toEqual([message, message, 'same error'])
    expect(result.trace).toEqual([...bootstrap.slice(0, boundary), ['completed', false]])
    expect(result.marker).toBeNull()
  })

  it('keeps one startup, outward env writes, pre-listen completion, logs, HTTP and cleanup', () => {
    const result = probe('cli')
    expect(result.outcomes).toEqual(['resolved', 'resolved'])
    expect(result.env).toEqual({
      SHIKIN_DATA_SERVER_PORT: '9001',
      SHIKIN_WEB_HOSTED: '1',
      SHIKIN_WEB_STATIC_ROOT: '<root>/cli/web',
    })
    expect(result.trace).toEqual([
      ...bootstrap,
      ['log', '[data-server] Listening on http://127.0.0.1:8480'],
      ['log', '[data-server] Data directory: /data'],
      ['log', 'tailscale serve --bg http://127.0.0.1:8480'],
      ['log', 'Stop hosted access with: tailscale serve reset'],
      [
        'http:headers',
        200,
        {
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://www.alphavantage.co https://api.coingecko.com https://api.frankfurter.app https://finnhub.io https://newsapi.org https://house-stock-watcher-data.s3-us-west-2.amazonaws.com https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com https://github.com https://objects.githubusercontent.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Type': 'application/json',
        },
      ],
      ['http:body', '{}'],
      ['shutdown', 'SIGTERM', true],
      ['marker:release'],
      ['exit', 0],
    ])
    expect(result.marker).toBeNull()
  })

  it.each(['default', '', 'invalid', '0', '65536', '8480x', '1023'])(
    'retains the direct executable parser for %j',
    (port) => {
      const result = probe('direct', port)
      expect(result.outcomes).toEqual(['resolved'])
      expect(result.trace.filter((event: unknown[]) => event[0] === 'listen')).toEqual([
        ['listen', port === '8480x' ? 8480 : port === '1023' ? 1023 : 1480, '127.0.0.1'],
      ])
      expect(result.env).toEqual(port === 'default' ? {} : { SHIKIN_DATA_SERVER_PORT: port })
    }
  )

  it.each(['8480x', '1023'])('rejects CLI port %j before startup or env mutation', (port) => {
    const result = probe('cli', port, 'assets')
    expect(result.outcomes).toEqual([
      `Invalid web port "${port}". Use an integer from 1024 to 65535.`,
      'Hosted web assets are missing at <root>/cli/web/index.html. Rebuild Shikin CLI support.',
      'different error',
    ])
    expect(result.env).toEqual({
      SHIKIN_DATA_SERVER_PORT: 'old-port',
      SHIKIN_WEB_HOSTED: 'old-mode',
      SHIKIN_WEB_STATIC_ROOT: 'old-root',
    })
    expect(result.trace).toEqual([['completed', false]])
  })

  it('caches native failure without preparing storage and still rewrites env on another call', () => {
    const result = probe('cli', 'default', 'native')
    const message =
      'The better-sqlite3 native binding could not be loaded for this Node.js runtime. Reinstall or rebuild the CLI dependencies for the active Node ABI.'
    expect(result.outcomes).toEqual([message, message, 'same error'])
    expect(result.trace).toEqual([
      ['version'],
      ['static'],
      ['context'],
      ['probe', ':memory:'],
      ['completed', false],
    ])
    expect(result.env).toEqual({
      SHIKIN_DATA_SERVER_PORT: '9001',
      SHIKIN_WEB_HOSTED: '1',
      SHIKIN_WEB_STATIC_ROOT: '<root>/cli/web',
    })
  })

  it('releases the hosted marker on migration failure and caches that failure', () => {
    const result = probe('cli', 'default', 'migration')
    expect(result.outcomes).toEqual(['migration failure', 'migration failure', 'same error'])
    expect(result.trace).toEqual([
      ...bootstrap.slice(0, 12),
      ['marker:release'],
      ['completed', false],
    ])
    expect(result.marker).toBeNull()
  })
})
