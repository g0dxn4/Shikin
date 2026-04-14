import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

const bridgeToken = randomBytes(24).toString('hex')
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

const sharedEnv = {
  ...process.env,
  SHIKIN_DATA_SERVER_PORT: dataServerPort,
  SHIKIN_DATA_SERVER_BRIDGE_TOKEN: bridgeToken,
  VITE_DATA_SERVER_URL: dataServerUrl,
  VITE_DATA_SERVER_BRIDGE_TOKEN: bridgeToken,
}

const children = [
  spawn('node', ['scripts/oauth-server.mjs'], { stdio: 'inherit', env: sharedEnv }),
  spawn('node', ['scripts/data-server.mjs'], { stdio: 'inherit', env: sharedEnv }),
  spawn('pnpm', ['exec', 'vite'], { stdio: 'inherit', env: sharedEnv }),
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
