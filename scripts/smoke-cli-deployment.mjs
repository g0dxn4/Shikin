import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  if (child.exitCode !== null) return { code: child.exitCode, signal: child.signalCode }

  child.kill('SIGTERM')
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolveExit({ code: child.exitCode, signal: child.signalCode })
    }, 3_000)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveExit({ code, signal })
    })
  })
}

async function requestHostedApi(port, path, body, options = {}) {
  const origin = options.origin ?? `http://127.0.0.1:${port}`
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(origin ? { origin } : {}),
      ...(options.headers ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

function assertPackagedWebAssets(webRoot) {
  const indexPath = join(webRoot, 'index.html')
  if (!existsSync(indexPath)) throw new Error('Deployed CLI package omitted web/index.html.')

  const index = readFileSync(indexPath, 'utf8')
  const assetPaths = [...index.matchAll(/(?:src|href)="([^"?#]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/assets/'))
  if (assetPaths.length === 0) throw new Error('Packaged web/index.html does not reference any assets.')

  for (const assetPath of assetPaths) {
    if (!existsSync(join(webRoot, assetPath))) {
      throw new Error(`Packaged web asset is missing: ${assetPath}`)
    }
  }

  return assetPaths
}

async function smokeHostedWeb(cliEntrypoint, deployedWebRoot, isolatedEnv) {
  const packagedAssets = assertPackagedWebAssets(deployedWebRoot)
  const port = await findAvailablePort()
  const child = spawn(process.execPath, [cliEntrypoint, 'web', '--port', String(port)], {
    cwd: root,
    env: isolatedEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  try {
    await waitForDataServer(child, () => stderr)

    for (const path of ['/', '/settings']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      const html = await response.text()
      if (!response.ok || !html.includes('<div id="root">')) {
        throw new Error(`Hosted web path ${path} did not serve the production SPA.`)
      }
    }
    for (const assetPath of packagedAssets) {
      const response = await fetch(`http://127.0.0.1:${port}${assetPath}`)
      if (!response.ok) {
        throw new Error(`Hosted web asset ${assetPath} did not serve successfully.`)
      }
    }

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

    const webRows = await requestHostedApi(port, '/api/db/query', {
      sql: 'SELECT name, currency FROM accounts WHERE name = $1',
      params: ['CLI Shared DB Smoke'],
    })
    if (webRows.length !== 1 || webRows[0].currency !== 'MXN') {
      throw new Error(`Hosted web API did not observe the CLI account: ${JSON.stringify(webRows)}`)
    }

    await requestHostedApi(port, '/api/db/execute', {
      sql: 'INSERT INTO categories (id, name, type, sort_order) VALUES ($1, $2, $3, $4)',
      params: ['shared-smoke-category', 'Web Shared DB Smoke', 'expense', 999],
    })
    const categories = JSON.parse(
      runNode([cliEntrypoint, 'list-categories', '--json'], isolatedEnv)
    )
    if (!categories.categories?.some((category) => category.name === 'Web Shared DB Smoke')) {
      throw new Error(`CLI did not observe the hosted web category: ${JSON.stringify(categories)}`)
    }

    const wrongOrigin = await fetch(`http://127.0.0.1:${port}/api/db/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://wrong-origin.example',
      },
      body: JSON.stringify({ sql: 'SELECT 1', params: [] }),
    })
    if (wrongOrigin.status !== 403) {
      throw new Error(`Hosted web API accepted a wrong Origin with status ${wrongOrigin.status}.`)
    }
  } finally {
    const stopped = await stopChild(child)
    if (stopped.code !== 0 || stopped.signal !== null) {
      throw new Error(
        `Hosted web server did not stop cleanly (code ${stopped.code}, signal ${stopped.signal ?? 'none'}).`
      )
    }
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
  const deployedWebRoot = join(deployDir, 'web')
  const requiredPaths = [
    packageFile,
    cliEntrypoint,
    mcpEntrypoint,
    join(deployedWebRoot, 'index.html'),
    join(deployDir, 'node_modules'),
  ]
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
  await smokeHostedWeb(cliEntrypoint, deployedWebRoot, isolatedEnv)
  await smokeMcp(mcpEntrypoint, isolatedEnv)

  console.log(`CLI deployment and hosted web shared-database smoke passed with pnpm ${actualPnpmVersion}.`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
