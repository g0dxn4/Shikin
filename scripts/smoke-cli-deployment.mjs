import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  await smokeMcp(mcpEntrypoint, isolatedEnv)

  console.log(`CLI deployment smoke passed with pnpm ${actualPnpmVersion}.`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
