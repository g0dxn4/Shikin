// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let SERVER_URL = 'http://127.0.0.1:1480'
const ORIGIN = 'http://localhost:1420'
const TOKEN = 'server-http-contract-token'

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
      // Server still booting.
    }

    await delay(100)
  }

  throw new Error('Timed out waiting for data-server to start')
}

beforeAll(async () => {
  const port = await getFreePort()
  SERVER_URL = `http://127.0.0.1:${port}`
  tempHomeDir = mkdtempSync(join(tmpdir(), 'shikin-data-server-contract-test-'))
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

describe('data-server authenticated contract', () => {
  it('supports store, filesystem, and DB operations with valid bridge auth', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    // Store set/get
    const setStoreRes = await fetch(`${SERVER_URL}/api/store/contract-key`, {
      method: 'PUT',
      headers: defaultHeaders,
      body: JSON.stringify({ value: 'contract-value' }),
    })

    expect(setStoreRes.status).toBe(200)

    const getStoreRes = await fetch(`${SERVER_URL}/api/store/contract-key`, {
      headers: defaultHeaders,
    })
    const getStoreJson = await getStoreRes.json()

    expect(getStoreRes.status).toBe(200)
    expect(getStoreJson).toEqual({ value: 'contract-value' })

    // FS write/read/readdir
    const notePath = 'contract/notebook/note.md'
    const noteContent = 'Contract test note'

    const fsWriteRes = await fetch(`${SERVER_URL}/api/fs/write`, {
      method: 'PUT',
      headers: defaultHeaders,
      body: JSON.stringify({ path: notePath, content: noteContent }),
    })
    const fsWriteJson = await fsWriteRes.json()

    expect(fsWriteRes.status).toBe(200)
    expect(fsWriteJson).toEqual({ ok: true })

    const fsReadRes = await fetch(`${SERVER_URL}/api/fs/read?path=contract/notebook/note.md`, {
      headers: defaultHeaders,
    })
    const fsReadJson = await fsReadRes.json()

    expect(fsReadRes.status).toBe(200)
    expect(fsReadJson).toEqual({ content: noteContent })

    const fsReaddirRes = await fetch(`${SERVER_URL}/api/fs/readdir?path=contract/notebook`, {
      headers: defaultHeaders,
    })
    const fsReaddirJson = await fsReaddirRes.json()

    expect(fsReaddirRes.status).toBe(200)
    expect(fsReaddirJson.entries).toEqual(
      expect.arrayContaining([{ name: 'note.md', isDirectory: false }])
    )

    // DB execute/query using positional SQL params
    const executeRes = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: ['contract-account', 'Contract Account', 'checking', 7777],
      }),
    })
    const executeJson = await executeRes.json()

    expect(executeRes.status).toBe(200)
    expect(executeJson).toEqual(
      expect.objectContaining({
        rowsAffected: 1,
        lastInsertId: expect.any(Number),
      })
    )

    const queryRes = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT name, type, balance FROM accounts WHERE id = $1',
        params: ['contract-account'],
      }),
    })
    const queryJson = await queryRes.json()

    expect(queryRes.status).toBe(200)
    expect(queryJson).toEqual([
      {
        name: 'Contract Account',
        type: 'checking',
        balance: 7777,
      },
    ])
  })

  it('exports a SQLite snapshot with download headers', async () => {
    const response = await fetch(`${SERVER_URL}/api/db/export`, {
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
      },
    })

    const snapshot = new Uint8Array(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toContain('shikin.db')
    expect(Buffer.from(snapshot.subarray(0, 16)).toString('ascii')).toBe('SQLite format 3\u0000')
  })

  it('can import an exported snapshot and continue serving queries without restart', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const seedAccountId = 'import-seed-account'
    const transientAccountId = 'import-transient-account'

    const insertSeedResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [seedAccountId, 'Imported Snapshot Seed', 'checking', 1000],
      }),
    })

    expect(insertSeedResponse.status).toBe(200)

    const exportedSnapshotResponse = await fetch(`${SERVER_URL}/api/db/export`, {
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
      },
    })
    const exportedSnapshot = new Uint8Array(await exportedSnapshotResponse.arrayBuffer())

    expect(exportedSnapshotResponse.status).toBe(200)

    const insertTransientResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [transientAccountId, 'Transient Account', 'checking', 2000],
      }),
    })

    expect(insertTransientResponse.status).toBe(200)

    const importResponse = await fetch(`${SERVER_URL}/api/db/import`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
        'Content-Type': 'application/octet-stream',
      },
      body: exportedSnapshot,
    })
    const importJson = await importResponse.json()

    expect(importResponse.status).toBe(200)
    expect(importJson).toEqual({ ok: true, message: 'Database imported successfully.' })

    const queryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id, name, balance FROM accounts WHERE id IN ($1, $2) ORDER BY id',
        params: [seedAccountId, transientAccountId],
      }),
    })
    const queryJson = await queryResponse.json()

    expect(queryResponse.status).toBe(200)
    expect(queryJson).toEqual([
      {
        id: seedAccountId,
        name: 'Imported Snapshot Seed',
        balance: 1000,
      },
    ])
  })

  it('rejects oversized JSON request bodies with a 413 response', async () => {
    const response = await fetch(`${SERVER_URL}/api/fs/write`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: 'contract/oversized.txt',
        content: 'x'.repeat(1_050_000),
      }),
    })

    const payload = await response.json()

    expect(response.status).toBe(413)
    expect(payload).toEqual({
      error: 'JSON request body exceeds the 1000000-byte limit.',
    })
  })
})
