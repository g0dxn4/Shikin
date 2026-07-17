import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageManagerMatch = /^pnpm@(.+)$/.exec(rootPackage.packageManager ?? '')
if (!packageManagerMatch) {
  throw new Error('Root package.json must pin pnpm through packageManager.')
}

const pinnedPnpmVersion = packageManagerMatch[1]
const pnpmCommand =
  process.env.npm_execpath && /(?:^|[\\/])pnpm(?:\.cjs)?$/.test(process.env.npm_execpath)
    ? { command: process.execPath, prefix: [process.env.npm_execpath] }
    : { command: 'pnpm', prefix: [] }

function runPnpm(args, options = {}) {
  const result = spawnSync(pnpmCommand.command, [...pnpmCommand.prefix, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${args.join(' ')} failed with exit code ${result.status}${
        options.capture ? `\n${result.stderr}` : ''
      }`
    )
  }
  return result.stdout?.trim() ?? ''
}

function assertNoFinanceCoreRuntimeImport(file) {
  const source = readFileSync(file, 'utf8')
  if (source.includes('@shikin/finance-core')) {
    throw new Error(`${file} retains a runtime @shikin/finance-core import.`)
  }
}

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `node ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr}`
    )
  }
  return result.stdout.trim()
}

function findAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close((error) => {
        if (error) reject(error)
        else resolvePort(address.port)
      })
    })
  })
}

function waitForDataServer(child, getStderr) {
  return new Promise((resolveReady, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onData = (chunk) => {
      if (!chunk.includes('Listening on')) return
      cleanup()
      resolveReady()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `App data server exited before readiness with code ${code} signal ${signal ?? 'none'}\n${getStderr()}`
        )
      )
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`App data server readiness timed out.\n${getStderr()}`))
    }, 10_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolveExit()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

async function requestDataServer(port, token, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:1420',
      'x-shikin-bridge': token,
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

async function smokeSharedDatabase(cliEntrypoint, isolatedEnv) {
  const port = await findAvailablePort()
  const token = `deploy-smoke-${process.pid}`
  const serverEnv = {
    ...isolatedEnv,
    SHIKIN_DATA_SERVER_PORT: String(port),
    SHIKIN_DATA_SERVER_BRIDGE_TOKEN: token,
  }
  const child = spawn(process.execPath, [join(root, 'scripts', 'data-server.mjs')], {
    cwd: root,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  try {
    await waitForDataServer(child, () => stderr)

    const created = JSON.parse(
      runNode(
        [
          cliEntrypoint,
          'create-account',
          '--name',
          'CLI Shared DB Smoke',
          '--type',
          'checking',
          '--currency',
          'MXN',
          '--json',
        ],
        isolatedEnv
      )
    )
    if (created?.account?.name !== 'CLI Shared DB Smoke') {
      throw new Error(`Unexpected deployed CLI create response: ${JSON.stringify(created)}`)
    }

    const appRows = await requestDataServer(port, token, '/api/db/query', {
      sql: 'SELECT name, currency FROM accounts WHERE name = $1',
      params: ['CLI Shared DB Smoke'],
    })
    if (appRows.length !== 1 || appRows[0].currency !== 'MXN') {
      throw new Error(`App backend did not observe the CLI account: ${JSON.stringify(appRows)}`)
    }

    await requestDataServer(port, token, '/api/db/execute', {
      sql: 'INSERT INTO categories (id, name, type, sort_order) VALUES ($1, $2, $3, $4)',
      params: ['shared-smoke-category', 'App Shared DB Smoke', 'expense', 999],
    })
    const categories = JSON.parse(
      runNode([cliEntrypoint, 'list-categories', '--json'], isolatedEnv)
    )
    if (!categories.categories?.some((category) => category.name === 'App Shared DB Smoke')) {
      throw new Error(`CLI did not observe the app backend category: ${JSON.stringify(categories)}`)
    }
  } finally {
    await stopChild(child)
  }
}

function smokeMcp(entrypoint, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entrypoint], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Deployed MCP entrypoint did not exit after stdin closed.'))
    }, 5_000)

    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(
          new Error(
            `Deployed MCP entrypoint exited with code ${code} signal ${signal ?? 'none'}\n${stderr}`
          )
        )
        return
      }
      resolvePromise()
    })
    child.stdin.end()
  })
}

const actualPnpmVersion = runPnpm(['--version'], { capture: true })
if (actualPnpmVersion !== pinnedPnpmVersion) {
  throw new Error(`Expected pnpm ${pinnedPnpmVersion}, received ${actualPnpmVersion}.`)
}

const tempRoot = mkdtempSync(join(tmpdir(), 'shikin-cli-deploy-smoke-'))
try {
  const deployDir = join(tempRoot, 'cli-support')
  const homeDir = join(tempRoot, 'home')
  const dataDir = join(tempRoot, 'xdg-data')
  const configDir = join(tempRoot, 'xdg-config')
  const cacheDir = join(tempRoot, 'xdg-cache')
  for (const directory of [homeDir, dataDir, configDir, cacheDir]) {
    mkdirSync(directory, { recursive: true })
  }

  runPnpm(['--dir', 'cli', 'build'])
  runPnpm(['--filter', '@shikin/cli', 'deploy', '--prod', deployDir])

  const packageFile = join(deployDir, 'package.json')
  const cliEntrypoint = join(deployDir, 'dist', 'cli.js')
  const mcpEntrypoint = join(deployDir, 'dist', 'mcp-server.js')
  const requiredPaths = [packageFile, cliEntrypoint, mcpEntrypoint, join(deployDir, 'node_modules')]
  for (const requiredPath of requiredPaths) {
    try {
      readFileSync(requiredPath)
    } catch (error) {
      if (requiredPath.endsWith('node_modules')) {
        // Directories cannot be read as files; checking a known production dependency proves usability.
        readFileSync(join(requiredPath, 'better-sqlite3', 'package.json'))
      } else {
        throw error
      }
    }
  }

  assertNoFinanceCoreRuntimeImport(cliEntrypoint)
  assertNoFinanceCoreRuntimeImport(mcpEntrypoint)

  const isolatedEnv = {
    ...process.env,
    HOME: homeDir,
    XDG_DATA_HOME: dataDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
  }
  const version = runNode([cliEntrypoint, '--version'], isolatedEnv)
  if (version !== rootPackage.version) {
    throw new Error(`Deployed CLI reported version ${version}; expected ${rootPackage.version}.`)
  }
  await smokeSharedDatabase(cliEntrypoint, isolatedEnv)
  await smokeMcp(mcpEntrypoint, isolatedEnv)

  console.log(`CLI deployment and app shared-database smoke passed with pnpm ${actualPnpmVersion}.`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
