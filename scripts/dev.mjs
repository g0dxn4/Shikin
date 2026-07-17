import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  REAL_DATA_OPT_IN,
  isolatedAppDataEnvironment,
  shouldUseRealAppData,
} from './dev-environment.mjs'

const require = createRequire(import.meta.url)
const viteEntry = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

const bridgeToken =
  process.env.SHIKIN_DATA_SERVER_BRIDGE_TOKEN ||
  process.env.VITE_DATA_SERVER_BRIDGE_TOKEN ||
  randomBytes(24).toString('hex')
const DEFAULT_DATA_SERVER_PORT = '1480'

function resolveDataServerUrl() {
  const configuredUrl = process.env.VITE_DATA_SERVER_URL || process.env.SHIKIN_DATA_SERVER_URL
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '')
  }

  const configuredPort = process.env.SHIKIN_DATA_SERVER_PORT || DEFAULT_DATA_SERVER_PORT
  return `http://localhost:${configuredPort}`
}

function resolveDataServerPort(dataServerUrl) {
  if (process.env.SHIKIN_DATA_SERVER_PORT) {
    return process.env.SHIKIN_DATA_SERVER_PORT
  }

  try {
    const parsed = new URL(dataServerUrl)
    if (parsed.port) return parsed.port
    return parsed.protocol === 'https:' ? '443' : '80'
  } catch {
    return DEFAULT_DATA_SERVER_PORT
  }
}

const dataServerUrl = resolveDataServerUrl()
const dataServerPort = resolveDataServerPort(dataServerUrl)
const useRealData = shouldUseRealAppData()
const isolatedDataRoot = useRealData ? null : mkdtempSync(join(tmpdir(), 'shikin-dev-data-'))

if (useRealData) {
  console.warn(`Shikin dev server is using your real app data (${REAL_DATA_OPT_IN}=1).`)
} else {
  console.log(`Shikin dev server is using isolated temporary data: ${isolatedDataRoot}`)
}

const sharedEnv = {
  ...process.env,
  ...(isolatedDataRoot ? isolatedAppDataEnvironment(isolatedDataRoot) : {}),
  SHIKIN_DATA_SERVER_PORT: dataServerPort,
  SHIKIN_DATA_SERVER_BRIDGE_TOKEN: bridgeToken,
  VITE_DATA_SERVER_URL: dataServerUrl,
  VITE_DATA_SERVER_BRIDGE_TOKEN: bridgeToken,
}

const children = [
  spawn(process.execPath, ['scripts/data-server.mjs'], { stdio: 'inherit', env: sharedEnv }),
  spawn(process.execPath, [viteEntry], { stdio: 'inherit', env: sharedEnv }),
]

let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }
    if (isolatedDataRoot) {
      rmSync(isolatedDataRoot, { recursive: true, force: true })
    }
    process.exit(code)
  }, 500).unref()
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    if (signal) {
      shutdown(1)
      return
    }
    shutdown(code ?? 0)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
