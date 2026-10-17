import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const helper = resolve('scripts/shikin-chatgpt-tunnel.sh')
const roots = []
const tunnelID = 'tunnel_0123456789abcdef0123456789abcdef'
const secret = 'test-runtime-secret-do-not-log'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shikin-tunnel-')))
  roots.push(root)
  // Exercise shell command parsing, settings quoting, XML escaping and argv.
  const state = join(root, "Andres' Application Support & tools")
  const agents = join(root, 'LaunchAgents')
  const bin = join(root, 'bin')
  const data = join(root, "finance's data", 'com.asf.shikin')
  const mcp = join(root, "installed tools' MCP.cjs")
  const key = join(root, 'original-key')
  const log = join(root, 'calls.jsonl')
  mkdirSync(bin)
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'shikin.db'), 'existing-synthetic-db')
  writeFileSync(key, secret, { mode: 0o600 })
  writeFileSync(mcp, `process.stdin.on('data', chunk => process.stdout.write(chunk));`)
  const prelude = `#!${process.execPath}\nconst fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const root = ${JSON.stringify(root)};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({name: require('node:path').basename(process.argv[1]), args}) + '\\n');\n`
  const shim = (name, body) => writeFileSync(join(bin, name), prelude + body, { mode: 0o700 })
  shim('uname', "console.log(process.env.FAKE_OS || 'Darwin');")
  shim('id', "console.log('501');")
  shim(
    'plutil',
    `
if (args[0] === '-lint') process.exit(0);
if (args[0] === '-extract' && args[1] === 'ProgramArguments.4' && args[2] === 'raw' && args[3] === '-o' && args[4] === '-' && args[5] && !process.env.FAKE_PLUTIL_EXTRACT_FAIL) {
  const xml = fs.readFileSync(args[5], 'utf8');
  const m = xml.match(/<string>--state-dir<\\/string>\\s*<string>([^<]*)<\\/string>/);
  if (!m) process.exit(1);
  process.stdout.write(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  process.exit(0);
}
process.exit(args[0] === '-extract' ? 1 : 0);`
  )
  shim(
    'docker',
    `
if (args[0] === 'inspect') { console.log(process.env.FAKE_DOCKER_DOWN ? 'false' : 'true'); process.exit(0); }
if (args[0] !== 'exec' || args[1] !== '-i' || args.includes('-t')) process.exit(9);
let i = 2; const env = {...process.env};
while (args[i] === '--env') { const pair = args[i+1]; const eq = pair.indexOf('='); env[pair.slice(0,eq)] = pair.slice(eq+1); i += 2; }
if (args[i++] !== 'shikin-web') process.exit(10);
if (env.XDG_DATA_HOME !== ${JSON.stringify(dirname(data))} || env.SHIKIN_MIGRATE_LEGACY_DATA !== '0') process.exit(11);
const result = cp.spawnSync(args[i], args.slice(i+1), {env, stdio:'inherit'});
process.exit(result.status ?? 12);`
  )
  shim(
    'launchctl',
    `
const marker = root + '/loaded';
if (args[0] === 'print') process.exit(fs.existsSync(marker) ? 0 : 1);
if (args[0] === 'bootstrap') fs.writeFileSync(marker, 'loaded');
if (args[0] === 'bootout') fs.rmSync(marker, {force:true});
if (args[0] === 'disable') fs.writeFileSync(root + '/disabled', 'disabled');
if (args[0] === 'enable') fs.rmSync(root + '/disabled', {force:true});`
  )
  shim('curl', `if (process.env.FAKE_NOT_READY) process.exit(22); console.log('{"ready":true}');`)
  shim(
    'tunnel-client',
    `
if (args[0] === 'init') {
  if (process.env.FAKE_INIT_FAIL) process.exit(1);
  if (process.env.SHIKIN_TEST_REAL_CLIENT) {
    const r = cp.spawnSync(process.env.SHIKIN_TEST_REAL_CLIENT, args, {stdio:'inherit'});
    process.exit(r.status ?? 1);
  }
  const p = args[args.indexOf('--profile-dir')+1];
  fs.writeFileSync(p + '/shikin.yaml', 'config_version: 1\\n');
}
if (args[0] === 'run') fs.writeFileSync(args[args.indexOf('--health.url-file')+1], 'http://127.0.0.1:41999');`
  )
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SHIKIN_TUNNEL_AGENT_DIR: agents,
  }
  const run = (command, extra = [], overrides = {}) =>
    spawnSync('/bin/bash', [helper, command, '--state-dir', state, ...extra], {
      encoding: 'utf8',
      env: { ...env, ...overrides },
      timeout: 15000,
    })
  const runAt = (stateDir, command, extra = [], overrides = {}) =>
    spawnSync('/bin/bash', [helper, command, '--state-dir', stateDir, ...extra], {
      encoding: 'utf8',
      env: { ...env, ...overrides },
      timeout: 15000,
    })
  const setup = (extra = [], overrides = {}) =>
    run(
      'setup',
      [
        '--tunnel-id',
        tunnelID,
        '--key-file',
        key,
        '--node-path',
        process.execPath,
        '--mcp-path',
        mcp,
        '--data-dir',
        data,
        ...extra,
      ],
      overrides
    )
  const setupAt = (stateDir, extra = [], overrides = {}) =>
    runAt(
      stateDir,
      'setup',
      [
        '--tunnel-id',
        tunnelID,
        '--key-file',
        key,
        '--node-path',
        process.execPath,
        '--mcp-path',
        mcp,
        '--data-dir',
        data,
        ...extra,
      ],
      overrides
    )
  return { root, state, agents, data, mcp, key, log, env, run, runAt, setup, setupAt }
}

describe('Shikin Docker tunnel helper', () => {
  it('installs a private profile and valid login service without leaking credentials', () => {
    const f = fixture()
    const result = f.setup()
    expect(result.stderr, result.stdout).not.toContain(secret)
    expect(result.status, result.stderr).toBe(0)
    const settings = readFileSync(join(f.state, 'settings.sh'), 'utf8')
    const calls = readFileSync(f.log, 'utf8')
    expect(settings + calls).not.toContain(secret)
    expect(readFileSync(join(f.state, 'runtime-key'), 'utf8')).toBe(secret)
    expect(statSync(join(f.state, 'runtime-key')).mode & 0o777).toBe(0o600)
    expect(statSync(f.state).mode & 0o777).toBe(0o700)
    const xml = readFileSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'), 'utf8')
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect([...parsed.querySelectorAll('string')].map((node) => node.textContent)).toContain(
      f.state
    )
    expect(xml).toContain('<key>KeepAlive</key><true/>')
    expect(calls).toContain('file:')
    expect(calls).not.toContain('docker.sock')
    expect(f.run('check').status).toBe(0)
  })

  it('preserves bidirectional stdio and the existing database through the guarded command', () => {
    const f = fixture()
    expect(f.setup().status).toBe(0)
    const input = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'
    const r = spawnSync('/bin/bash', [helper, 'mcp', '--state-dir', f.state], {
      env: f.env,
      input,
      encoding: 'utf8',
      timeout: 15000,
    })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe(input)
    expect(readFileSync(join(f.data, 'shikin.db'), 'utf8')).toBe('existing-synthetic-db')
  })

  it('refuses missing databases before setup and again before every MCP start', () => {
    const f = fixture()
    rmSync(join(f.data, 'shikin.db'))
    expect(f.setup().status).not.toBe(0)
    expect(existsSync(f.state)).toBe(false)
    const nested = join(f.root, 'fresh', 'nested-state')
    expect(f.setupAt(nested).status).not.toBe(0)
    expect(existsSync(join(f.root, 'fresh'))).toBe(false)
    writeFileSync(join(f.data, 'shikin.db'), 'existing-db')
    expect(f.setup().status).toBe(0)
    rmSync(join(f.data, 'shikin.db'))
    const r = f.run('mcp')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('refusing to start MCP')
    expect(existsSync(join(f.data, 'shikin.db'))).toBe(false)
  })

  it('fails clearly while Docker is unavailable, allowing launchd to retry', () => {
    const f = fixture()
    expect(f.setup().status).toBe(0)
    writeFileSync(join(f.state, 'health-url'), 'http://127.0.0.1:41999')
    const r = f.run('run', [], { FAKE_DOCKER_DOWN: '1' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('unavailable')
    expect(existsSync(join(f.state, 'health-url'))).toBe(false)
  })

  it('distinguishes a loaded service from a ready tunnel and requires a loopback health URL', () => {
    const f = fixture()
    expect(f.setup().status).toBe(0)
    expect(f.run('status').status).not.toBe(0)
    expect(f.run('run').status).toBe(0)
    expect(f.run('status', [], { FAKE_NOT_READY: '1' }).status).not.toBe(0)
    expect(f.run('status').stderr).toContain('successful ChatGPT tool call is still needed')
    writeFileSync(join(f.state, 'health-url'), 'https://example.com')
    expect(f.run('status').status).not.toBe(0)
  })

  it('stops persistently, restarts without duplicate bootstraps and uninstalls only its own files', () => {
    const f = fixture()
    expect(f.setup().status).toBe(0)
    expect(f.run('start').status).toBe(0)
    expect(readFileSync(f.log, 'utf8').match(/"bootstrap"/g)).toHaveLength(1)
    expect(f.run('stop').status).toBe(0)
    expect(existsSync(join(f.root, 'disabled'))).toBe(true)
    expect(existsSync(join(f.root, 'loaded'))).toBe(false)
    expect(f.run('start').status).toBe(0)
    writeFileSync(join(f.state, 'unrelated-file'), 'keep')
    expect(f.run('uninstall').status).toBe(0)
    expect(existsSync(join(f.state, 'runtime-key'))).toBe(false)
    expect(existsSync(join(f.state, 'unrelated-file'))).toBe(true)
    expect(readFileSync(f.key, 'utf8')).toBe(secret)
    expect(readFileSync(join(f.data, 'shikin.db'), 'utf8')).toBe('existing-synthetic-db')
  })

  it('rejects duplicate setup, malformed targets, symlink state and the wrong OS', () => {
    const f = fixture()
    expect(f.setup([], { FAKE_OS: 'Linux' }).status).not.toBe(0)
    expect(f.setup(['--container', '--privileged']).status).not.toBe(0)
    expect(f.setup(['--data-dir', '/tmp/wrong']).status).not.toBe(0)
    symlinkSync(f.data, f.state)
    expect(f.setup().status).not.toBe(0)
    rmSync(f.state)
    expect(f.setup().status).toBe(0)
    expect(f.setup().status).not.toBe(0)
  })

  it('does not let uninstall of a rejected second state dir stop or delete the first installation', () => {
    const f = fixture()
    expect(f.setup().status).toBe(0)
    const stateB = join(f.root, 'second-state')
    const setupB = f.setupAt(stateB)
    expect(setupB.status, setupB.stderr).not.toBe(0)
    expect(setupB.stderr).toContain('Existing LaunchAgent')
    expect(existsSync(join(stateB, 'settings.sh'))).toBe(false)

    const uninstallB = f.runAt(stateB, 'uninstall')
    expect(uninstallB.status, uninstallB.stderr).not.toBe(0)
    expect(uninstallB.stderr).toMatch(/owned by this state directory|Run setup first/)
    expect(existsSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'))).toBe(true)
    expect(existsSync(join(f.state, 'settings.sh'))).toBe(true)
    expect(existsSync(join(f.state, 'runtime-key'))).toBe(true)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)
    expect(existsSync(join(f.root, 'disabled'))).toBe(false)
    expect(readFileSync(join(f.state, 'runtime-key'), 'utf8')).toBe(secret)
  })

  it('does not delete a pre-existing runtime-key after a rejected colliding setup', () => {
    const f = fixture()
    const stateB = join(f.root, 'key-collision-state')
    mkdirSync(stateB, { recursive: true, mode: 0o700 })
    const preexisting = join(stateB, 'runtime-key')
    writeFileSync(preexisting, 'original-untouched-key', { mode: 0o600 })
    const setupB = f.setupAt(stateB, ['--key-file', preexisting])
    expect(setupB.status, setupB.stderr).not.toBe(0)
    expect(setupB.stderr).toContain('Existing setup file')

    const uninstallB = f.runAt(stateB, 'uninstall')
    expect(uninstallB.status, uninstallB.stderr).not.toBe(0)
    expect(existsSync(preexisting)).toBe(true)
    expect(readFileSync(preexisting, 'utf8')).toBe('original-untouched-key')
    expect(existsSync(join(f.root, 'disabled'))).toBe(false)
    expect(existsSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'))).toBe(false)
  })

  it('cleans a claimed partial install without stopping another state directory service', () => {
    const f = fixture()
    const partialA = f.setup([], { FAKE_INIT_FAIL: '1' })
    expect(partialA.status, partialA.stderr).not.toBe(0)
    expect(existsSync(join(f.state, 'settings.sh'))).toBe(true)
    expect(existsSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'))).toBe(false)

    const stateB = join(f.root, 'healthy-state')
    const setupB = f.setupAt(stateB)
    expect(setupB.status, setupB.stderr).toBe(0)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)

    const stopA = f.run('stop')
    expect(stopA.status, stopA.stderr).not.toBe(0)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)
    expect(existsSync(join(f.root, 'disabled'))).toBe(false)

    const startA = f.run('start')
    expect(startA.status, startA.stderr).not.toBe(0)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)

    const uninstallA = f.run('uninstall')
    expect(uninstallA.status, uninstallA.stderr).toBe(0)
    expect(existsSync(join(f.state, 'runtime-key'))).toBe(false)
    expect(existsSync(join(f.state, 'settings.sh'))).toBe(false)
    expect(readFileSync(f.key, 'utf8')).toBe(secret)
    expect(existsSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'))).toBe(true)
    expect(existsSync(join(stateB, 'settings.sh'))).toBe(true)
    expect(existsSync(join(stateB, 'runtime-key'))).toBe(true)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)
    expect(existsSync(join(f.root, 'disabled'))).toBe(false)
  })

  it('treats equivalent state path spellings as one owned installation', () => {
    const f = fixture()
    expect(f.setup().status).toBe(0)
    writeFileSync(join(f.state, 'unrelated-file'), 'keep')
    const xml = readFileSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'), 'utf8')
    expect(
      [...new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('string')].map(
        (node) => node.textContent
      )
    ).toContain(f.state)

    const stop = f.runAt(`${f.state}/`, 'stop', [], { FAKE_PLUTIL_EXTRACT_FAIL: '1' })
    expect(stop.status, stop.stderr).toBe(0)
    expect(existsSync(join(f.root, 'loaded'))).toBe(false)
    expect(existsSync(join(f.root, 'disabled'))).toBe(true)

    const start = f.runAt(`${f.state}/.`, 'start')
    expect(start.status, start.stderr).toBe(0)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)
    expect(existsSync(join(f.root, 'disabled'))).toBe(false)

    const uninstall = f.runAt(`${f.state}/`, 'uninstall')
    expect(uninstall.status, uninstall.stderr).toBe(0)
    expect(existsSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'))).toBe(false)
    expect(existsSync(join(f.root, 'loaded'))).toBe(false)
    expect(existsSync(join(f.state, 'runtime-key'))).toBe(false)
    expect(existsSync(join(f.state, 'settings.sh'))).toBe(false)
    expect(existsSync(join(f.state, 'shikin-chatgpt-tunnel.sh'))).toBe(false)
    expect(existsSync(join(f.state, 'unrelated-file'))).toBe(true)
    expect(readFileSync(f.key, 'utf8')).toBe(secret)
    expect(readFileSync(join(f.data, 'shikin.db'), 'utf8')).toBe('existing-synthetic-db')

    const again = f.setup()
    expect(again.status, again.stderr).toBe(0)
  })

  it('resolves a noncanonical recorded plist path and keeps sibling installs separate', () => {
    const f = fixture()
    expect(f.setupAt(`${f.state}/`).status).toBe(0)
    const plist = join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist')
    const xml = readFileSync(plist, 'utf8')
    const needle = '<string>--state-dir</string><string>'
    const start = xml.indexOf(needle)
    expect(start).toBeGreaterThan(-1)
    const valueStart = start + needle.length
    const valueEnd = xml.indexOf('</string>', valueStart)
    const recorded = xml.slice(valueStart, valueEnd)
    const legacy = recorded.endsWith('/') ? recorded : `${recorded}/`
    writeFileSync(plist, `${xml.slice(0, valueStart)}${legacy}${xml.slice(valueEnd)}`)

    expect(f.run('stop').status).toBe(0)
    expect(f.run('start').status).toBe(0)

    const sibling = join(f.root, 'sibling-state')
    const setupSib = f.setupAt(sibling)
    expect(setupSib.status, setupSib.stderr).not.toBe(0)
    const uninstallSib = f.runAt(`${sibling}/`, 'uninstall')
    expect(uninstallSib.status, uninstallSib.stderr).not.toBe(0)
    expect(existsSync(plist)).toBe(true)
    expect(existsSync(join(f.state, 'runtime-key'))).toBe(true)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)

    expect(f.runAt(`${f.state}/.`, 'uninstall').status).toBe(0)
    expect(existsSync(plist)).toBe(false)
    expect(existsSync(join(f.root, 'loaded'))).toBe(false)
    expect(existsSync(join(f.state, 'runtime-key'))).toBe(false)
  })

  it('refuses direct symlink state aliases without modifying referenced files', () => {
    const f = fixture()
    const target = join(f.root, 'referenced-state')
    mkdirSync(target, { mode: 0o700 })
    writeFileSync(join(target, 'keep-me'), 'preserve')
    const link = join(f.root, 'state-link')
    symlinkSync(target, link)
    for (const alias of [link, `${link}/`, `${link}/.`]) {
      const r = f.setupAt(alias)
      expect(r.status, `${alias}: ${r.stderr}`).not.toBe(0)
      expect(r.stderr).toMatch(/symlink/i)
    }
    expect(readFileSync(join(target, 'keep-me'), 'utf8')).toBe('preserve')
    expect(existsSync(join(target, 'settings.sh'))).toBe(false)
    expect(existsSync(join(target, 'runtime-key'))).toBe(false)

    const actualParent = join(f.root, 'actual-parent')
    mkdirSync(actualParent)
    const aliasParent = join(f.root, 'alias-parent')
    symlinkSync(actualParent, aliasParent)
    const nested = join(aliasParent, 'nested-state')
    const setupNested = f.setupAt(nested)
    expect(setupNested.status, setupNested.stderr).toBe(0)
    const physical = join(actualParent, 'nested-state')
    expect(existsSync(join(physical, 'settings.sh'))).toBe(true)
    expect(f.runAt(physical, 'stop').status).toBe(0)
    expect(f.runAt(`${nested}/.`, 'uninstall').status).toBe(0)
    expect(existsSync(join(physical, 'settings.sh'))).toBe(false)
    expect(existsSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'))).toBe(false)
  })

  it('does not delete installation files when LaunchAgent ownership cannot be determined', () => {
    const f = fixture()
    expect(f.setup().status).toBe(0)
    writeFileSync(
      join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'),
      '<plist version="1.0"><dict></dict></plist>'
    )
    const r = f.run('uninstall')
    expect(r.status, r.stderr).not.toBe(0)
    expect(r.stderr).toMatch(/cannot determine/i)
    expect(existsSync(join(f.state, 'settings.sh'))).toBe(true)
    expect(existsSync(join(f.state, 'runtime-key'))).toBe(true)
    expect(readFileSync(join(f.state, 'runtime-key'), 'utf8')).toBe(secret)
    expect(existsSync(join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist'))).toBe(true)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)
  })

  it('follows .. through an ancestor symlink instead of a lexical sibling', () => {
    const f = fixture()
    const actual = join(f.root, 'actual')
    mkdirSync(join(actual, 'deeper'), { recursive: true })
    const intended = join(actual, 'state')
    const lexicalSibling = join(f.root, 'state')
    mkdirSync(lexicalSibling, { mode: 0o700 })
    writeFileSync(join(lexicalSibling, 'sentinel'), 'sibling-keep')
    symlinkSync(join(actual, 'deeper'), join(f.root, 'alias'))
    const via = `${f.root}/alias/../state`
    expect(f.setupAt(intended).status).toBe(0)
    writeFileSync(join(intended, 'unrelated-file'), 'keep')

    const plist = join(f.agents, 'com.asf.shikin.chatgpt-tunnel.plist')
    const xml = readFileSync(plist, 'utf8')
    const needle = '<string>--state-dir</string><string>'
    const start = xml.indexOf(needle)
    expect(start).toBeGreaterThan(-1)
    const valueStart = start + needle.length
    const valueEnd = xml.indexOf('</string>', valueStart)
    const recorded = via.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    writeFileSync(plist, `${xml.slice(0, valueStart)}${recorded}${xml.slice(valueEnd)}`)

    expect(f.runAt(intended, 'stop').status).toBe(0)
    expect(existsSync(join(f.root, 'loaded'))).toBe(false)
    expect(f.runAt(`${via}/.`, 'start').status).toBe(0)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)
    expect(readFileSync(f.log, 'utf8')).toContain('ProgramArguments.4')

    const missing = f.runAt(`${f.root}/actual/missing/../state`, 'uninstall')
    expect(missing.status, missing.stderr).not.toBe(0)
    expect(existsSync(join(intended, 'settings.sh'))).toBe(true)
    expect(existsSync(join(lexicalSibling, 'sentinel'))).toBe(true)

    expect(f.runAt(via, 'uninstall').status).toBe(0)
    expect(existsSync(join(intended, 'settings.sh'))).toBe(false)
    expect(existsSync(join(intended, 'unrelated-file'))).toBe(true)
    expect(existsSync(plist)).toBe(false)
    expect(existsSync(join(lexicalSibling, 'sentinel'))).toBe(true)
    expect(readFileSync(join(lexicalSibling, 'sentinel'), 'utf8')).toBe('sibling-keep')
    expect(existsSync(join(lexicalSibling, 'settings.sh'))).toBe(false)
    expect(readFileSync(f.key, 'utf8')).toBe(secret)
  })

  it('does not uninstall a lexical sibling when .. walks through an ancestor symlink', () => {
    const f = fixture()
    const actual = join(f.root, 'actual')
    mkdirSync(join(actual, 'deeper'), { recursive: true })
    mkdirSync(join(actual, 'state'), { recursive: true, mode: 0o700 })
    writeFileSync(join(actual, 'state', 'sentinel'), 'leave-intended')
    symlinkSync(join(actual, 'deeper'), join(f.root, 'alias'))
    const sibling = join(f.root, 'state')
    expect(f.setupAt(sibling).status).toBe(0)
    const via = `${f.root}/alias/../state`
    const uninstall = f.runAt(via, 'uninstall')
    expect(uninstall.status, uninstall.stderr).not.toBe(0)
    expect(existsSync(join(sibling, 'settings.sh'))).toBe(true)
    expect(existsSync(join(sibling, 'runtime-key'))).toBe(true)
    expect(existsSync(join(f.root, 'loaded'))).toBe(true)
    expect(readFileSync(join(actual, 'state', 'sentinel'), 'utf8')).toBe('leave-intended')
    expect(existsSync(join(actual, 'state', 'settings.sh'))).toBe(false)
  })
})
