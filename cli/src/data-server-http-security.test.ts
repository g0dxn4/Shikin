// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let SERVER_URL = 'http://127.0.0.1:1480'
const ORIGIN = 'http://localhost:1420'
const TOKEN = 'server-http-test-token'

let serverProcess: ChildProcessWithoutNullStreams | null = null
let tempHomeDir = ''

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const testServer = createServer()
    testServer.once('error', reject)
    testServer.listen(0, '127.0.0.1', () => {
      const address = testServer.address()

      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine ephemeral port'))
        return
      }

      const { port } = address
      testServer.close(() => {
        resolve(port)
      })
    })
  })
}

async function waitForServerReady(processRef: ChildProcessWithoutNullStreams): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processRef.exitCode !== null) {
      throw new Error(`data-server exited early with code ${processRef.exitCode}`)
    }

    try {
      const response = await fetch(`${SERVER_URL}/api/store`, {
        headers: {
          Origin: ORIGIN,
          'X-Shikin-Bridge': TOKEN,
        },
      })

      if (response.ok) return
    } catch {
      // Server still starting up.
    }

    await delay(100)
  }

  throw new Error('Timed out waiting for data-server to start')
}

beforeAll(async () => {
  const port = await getFreePort()
  SERVER_URL = `http://127.0.0.1:${port}`
  tempHomeDir = mkdtempSync(join(tmpdir(), 'shikin-data-server-http-test-'))
  const serverPath = resolve(process.cwd(), 'scripts/data-server.mjs')

  serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      HOME: tempHomeDir,
      SHIKIN_DATA_SERVER_BRIDGE_TOKEN: TOKEN,
      SHIKIN_DATA_SERVER_PORT: String(port),
    },
    stdio: 'pipe',
  })

  await waitForServerReady(serverProcess)
}, 30_000)

afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM')
    await delay(150)
  }

  if (tempHomeDir) {
    rmSync(tempHomeDir, { recursive: true, force: true })
  }
})

describe('data-server request gating', () => {
  it('rejects missing/invalid bridge headers and wrong origin before filesystem side effects', async () => {
    const blockedPath = 'security-test/blocked.md'
    const expectedFile = join(
      tempHomeDir,
      '.local',
      'share',
      'com.asf.shikin',
      'security-test',
      'blocked.md'
    )

    const missingHeaderRes = await fetch(`${SERVER_URL}/api/fs/write`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: blockedPath, content: 'forbidden' }),
    })

    expect(missingHeaderRes.status).toBe(403)
    expect(existsSync(expectedFile)).toBe(false)

    const invalidHeaderRes = await fetch(`${SERVER_URL}/api/fs/write`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'X-Shikin-Bridge': 'invalid',
      },
      body: JSON.stringify({ path: blockedPath, content: 'forbidden' }),
    })

    expect(invalidHeaderRes.status).toBe(403)
    expect(existsSync(expectedFile)).toBe(false)

    const wrongOriginRes = await fetch(`${SERVER_URL}/api/fs/write`, {
      method: 'PUT',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        'X-Shikin-Bridge': TOKEN,
      },
      body: JSON.stringify({ path: blockedPath, content: 'forbidden' }),
    })

    expect(wrongOriginRes.status).toBe(403)
    expect(existsSync(expectedFile)).toBe(false)

    const validTokenRes = await fetch(`${SERVER_URL}/api/fs/write`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'X-Shikin-Bridge': TOKEN,
      },
      body: JSON.stringify({ path: blockedPath, content: 'allowed' }),
    })

    expect(validTokenRes.status).toBe(200)
    expect(existsSync(expectedFile)).toBe(true)
  })
})
