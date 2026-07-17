// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let serverUrl = 'http://127.0.0.1:8480'
let serverProcess: ChildProcessWithoutNullStreams | null = null
let tempHomeDir = ''
let tempDataHomeDir = ''
let tempWebRoot = ''
let serverOutput = ''

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine ephemeral port'))
        return
      }
      probe.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}

async function waitForServerReady(processRef: ChildProcessWithoutNullStreams): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processRef.exitCode !== null) {
      throw new Error(`hosted data-server exited early with code ${processRef.exitCode}`)
    }

    try {
      if ((await fetch(`${serverUrl}/api/store`)).ok) return
    } catch {
      // Server is still starting.
    }
    await delay(100)
  }

  throw new Error('Timed out waiting for hosted data-server to start')
}

async function stopServer(processRef: ChildProcessWithoutNullStreams): Promise<void> {
  if (processRef.exitCode !== null) return

  processRef.kill('SIGTERM')
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit) => processRef.once('exit', (code, signal) => resolveExit({ code, signal }))
  )
  expect(result).toEqual({ code: 0, signal: null })
}

beforeAll(async () => {
  const port = await getFreePort()
  serverUrl = `http://127.0.0.1:${port}`
  tempHomeDir = mkdtempSync(join(tmpdir(), 'shikin-hosted-web-test-'))
  tempDataHomeDir = join(tempHomeDir, 'xdg-data-home')
  tempWebRoot = join(tempHomeDir, 'web')
  mkdirSync(join(tempWebRoot, 'assets'), { recursive: true })
  writeFileSync(
    join(tempWebRoot, 'index.html'),
    '<!doctype html><html><body><div id="root">Hosted Shikin</div><script src="/assets/app-abc12345.js"></script></body></html>'
  )
  writeFileSync(join(tempWebRoot, 'assets', 'app-abc12345.js'), 'console.log("hosted")')
  writeFileSync(join(tempWebRoot, 'assets', 'app.css'), 'body { color: black; }')

  serverProcess = spawn('node', [resolve(process.cwd(), 'scripts/data-server.mjs')], {
    env: {
      ...process.env,
      HOME: tempHomeDir,
      XDG_DATA_HOME: tempDataHomeDir,
      SHIKIN_DATA_SERVER_PORT: String(port),
      SHIKIN_WEB_HOSTED: '1',
      SHIKIN_WEB_STATIC_ROOT: tempWebRoot,
    },
    stdio: 'pipe',
  })
  serverProcess.stdout.setEncoding('utf8')
  serverProcess.stdout.on('data', (chunk) => {
    serverOutput += chunk
  })

  await waitForServerReady(serverProcess)
}, 30_000)

afterAll(async () => {
  if (serverProcess) await stopServer(serverProcess)
  if (tempDataHomeDir) {
    expect(existsSync(join(tempDataHomeDir, 'com.asf.shikin', '.shikin-web.pid'))).toBe(false)
  }
  if (tempHomeDir) rmSync(tempHomeDir, { recursive: true, force: true })
})

describe('hosted data-server', () => {
  it('prints Tailscale Serve and reset guidance without invoking Tailscale', () => {
    expect(serverOutput).toContain(`tailscale serve --bg ${serverUrl}`)
    expect(serverOutput).toContain('tailscale serve reset')
  })

  it('owns one hosted process marker and refuses a second hosted server', async () => {
    const markerPath = join(tempDataHomeDir, 'com.asf.shikin', '.shikin-web.pid')
    expect(JSON.parse(readFileSync(markerPath, 'utf8')).pid).toBe(serverProcess?.pid)

    const secondPort = await getFreePort()
    const secondProcess = spawn('node', [resolve(process.cwd(), 'scripts/data-server.mjs')], {
      env: {
        ...process.env,
        HOME: tempHomeDir,
        XDG_DATA_HOME: tempDataHomeDir,
        SHIKIN_DATA_SERVER_PORT: String(secondPort),
        SHIKIN_WEB_HOSTED: '1',
        SHIKIN_WEB_STATIC_ROOT: tempWebRoot,
      },
      stdio: 'pipe',
    })
    let secondError = ''
    secondProcess.stderr.setEncoding('utf8')
    secondProcess.stderr.on('data', (chunk) => {
      secondError += chunk
    })
    const exitCode = await new Promise<number | null>((resolveExit) =>
      secondProcess.once('exit', resolveExit)
    )

    expect(exitCode).toBe(1)
    expect(secondError).toContain('Hosted web access is already running')
  })

  it('serves static files, SPA fallbacks, cache policy, and security headers without CORS', async () => {
    const indexResponse = await fetch(`${serverUrl}/`)
    const settingsResponse = await fetch(`${serverUrl}/settings`)
    const assetResponse = await fetch(`${serverUrl}/assets/app-abc12345.js`)
    const headResponse = await fetch(`${serverUrl}/assets/app-abc12345.js`, { method: 'HEAD' })

    expect(indexResponse.status).toBe(200)
    expect(await indexResponse.text()).toContain('Hosted Shikin')
    expect(indexResponse.headers.get('content-type')).toContain('text/html')
    expect(indexResponse.headers.get('cache-control')).toBe('no-cache')
    expect(indexResponse.headers.get('x-content-type-options')).toBe('nosniff')
    expect(indexResponse.headers.get('x-frame-options')).toBe('DENY')
    expect(indexResponse.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(indexResponse.headers.get('content-security-policy')).toContain(
      'https://api.frankfurter.app'
    )
    expect(indexResponse.headers.get('access-control-allow-origin')).toBeNull()

    expect(settingsResponse.status).toBe(200)
    expect(await settingsResponse.text()).toContain('Hosted Shikin')
    expect(assetResponse.headers.get('content-type')).toContain('application/javascript')
    expect(assetResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(headResponse.status).toBe(200)
    expect(await headResponse.text()).toBe('')
  })

  it('confines static paths and keeps API routes JSON rather than SPA fallbacks', async () => {
    const traversalResponse = await fetch(`${serverUrl}/assets/%2e%2e%2findex.html`)
    const missingApiResponse = await fetch(`${serverUrl}/api/not-found`)

    expect(traversalResponse.status).toBe(404)
    expect(await traversalResponse.json()).toEqual({ error: 'Not found' })
    expect(missingApiResponse.status).toBe(404)
    expect(missingApiResponse.headers.get('content-type')).toContain('application/json')
    expect(await missingApiResponse.json()).toEqual({ error: 'Not found' })
  })

  it('uses same-origin validation for hosted API mutations without bridge CORS', async () => {
    const validOrigin = serverUrl
    const noOriginRead = await fetch(`${serverUrl}/api/store`)
    const noOriginHead = await fetch(`${serverUrl}/api/store`, { method: 'HEAD' })
    const mismatchedRead = await fetch(`${serverUrl}/api/store`, {
      headers: { Origin: 'https://wrong-origin.example' },
    })
    const missingOriginMutation = await fetch(`${serverUrl}/api/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [] }),
    })
    const mismatchedMutation = await fetch(`${serverUrl}/api/db/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://wrong-origin.example',
      },
      body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [] }),
    })
    const validMutation = await fetch(`${serverUrl}/api/db/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: validOrigin,
      },
      body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [] }),
    })
    const forwardedTailscaleMutation = await fetch(`${serverUrl}/api/db/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://shikin.tailnet.ts.net',
        'X-Forwarded-Host': 'shikin.tailnet.ts.net',
        'X-Forwarded-Proto': 'http',
      },
      body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [] }),
    })

    expect(noOriginRead.status).toBe(200)
    expect(noOriginHead.status).toBe(200)
    expect(await noOriginHead.text()).toBe('')
    expect(mismatchedRead.status).toBe(403)
    expect(missingOriginMutation.status).toBe(403)
    expect(mismatchedMutation.status).toBe(403)
    expect(validMutation.status).toBe(200)
    expect(await validMutation.json()).toEqual([{ ok: 1 }])
    expect(forwardedTailscaleMutation.status).toBe(200)
    expect(forwardedTailscaleMutation.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows exports but blocks database import and restore while hosted access is active', async () => {
    const headers = { Origin: serverUrl }
    const exportResponse = await fetch(`${serverUrl}/api/db/export`, { headers })
    const importResponse = await fetch(`${serverUrl}/api/db/import`, {
      method: 'POST',
      headers,
      body: Buffer.from('SQLite format 3\0'),
    })

    expect(exportResponse.status).toBe(200)
    expect(
      Buffer.from(await exportResponse.arrayBuffer())
        .subarray(0, 16)
        .toString('ascii')
    ).toBe('SQLite format 3\0')
    expect(importResponse.status).toBe(409)
    expect((await importResponse.json()).error).toContain(
      'Stop hosted access and use the desktop app'
    )
  })
})
