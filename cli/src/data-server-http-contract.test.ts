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
      SHIKIN_SERVER_TRANSACTION_TTL_MS: '300',
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

  it('keeps browser-style transaction operations isolated until commit', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const beginResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const beginJson = await beginResponse.json()

    expect(beginResponse.status).toBe(200)
    expect(beginJson.transactionId).toEqual(expect.any(String))

    const transactionId = beginJson.transactionId as string
    const accountId = 'server-transaction-account'

    const insertResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [accountId, 'Transaction Scoped Account', 'checking', 4321],
        transactionId,
      }),
    })
    const insertJson = await insertResponse.json()

    expect(insertResponse.status).toBe(200)
    expect(insertJson).toEqual(
      expect.objectContaining({
        rowsAffected: 1,
      })
    )

    const insideQueryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id, name, balance FROM accounts WHERE id = $1',
        params: [accountId],
        transactionId,
      }),
    })
    const insideQueryJson = await insideQueryResponse.json()

    expect(insideQueryResponse.status).toBe(200)
    expect(insideQueryJson).toEqual([
      {
        id: accountId,
        name: 'Transaction Scoped Account',
        balance: 4321,
      },
    ])

    const outsideQueryBeforeCommitResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id FROM accounts WHERE id = $1',
        params: [accountId],
      }),
    })
    const outsideQueryBeforeCommitJson = await outsideQueryBeforeCommitResponse.json()

    expect(outsideQueryBeforeCommitResponse.status).toBe(200)
    expect(outsideQueryBeforeCommitJson).toEqual([])

    const commitResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'commit', transactionId }),
    })
    const commitJson = await commitResponse.json()

    expect(commitResponse.status).toBe(200)
    expect(commitJson).toEqual({ ok: true, status: 'committed' })

    const outsideQueryAfterCommitResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id, name, balance FROM accounts WHERE id = $1',
        params: [accountId],
      }),
    })
    const outsideQueryAfterCommitJson = await outsideQueryAfterCommitResponse.json()

    expect(outsideQueryAfterCommitResponse.status).toBe(200)
    expect(outsideQueryAfterCommitJson).toEqual([
      {
        id: accountId,
        name: 'Transaction Scoped Account',
        balance: 4321,
      },
    ])
  })

  it('materializes recurring rules atomically through the dedicated server endpoint', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const accountId = 'recurring-contract-account'
    const ruleId = 'recurring-contract-rule'

    const insertAccountResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, currency, balance) VALUES ($1, $2, $3, $4, $5)',
        params: [accountId, 'Recurring Contract Account', 'checking', 'USD', 10000],
      }),
    })

    expect(insertAccountResponse.status).toBe(200)

    const insertRuleResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: `INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, end_date, account_id, to_account_id, category_id, subcategory_id, tags, notes, active)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        params: [
          ruleId,
          'Contract recurring coffee',
          250,
          'USD',
          'expense',
          'monthly',
          '2026-04-01',
          null,
          accountId,
          null,
          null,
          null,
          '[]',
          null,
          1,
        ],
      }),
    })

    expect(insertRuleResponse.status).toBe(200)

    const materializeResponse = await fetch(`${SERVER_URL}/api/recurring/materialize`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({}),
    })
    const materializeJson = await materializeResponse.json()

    expect(materializeResponse.status).toBe(200)
    expect(materializeJson).toMatchObject({
      success: true,
      created: 1,
      message: 'Created 1 transaction(s) from recurring rules.',
    })

    const queryRuleStateResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: `SELECT a.balance, r.next_date
              FROM accounts a
              JOIN recurring_rules r ON r.account_id = a.id
              WHERE a.id = $1 AND r.id = $2`,
        params: [accountId, ruleId],
      }),
    })
    const queryRuleStateJson = await queryRuleStateResponse.json()

    const queryTransactionStateResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: `SELECT COUNT(*) AS recurring_count
              FROM transactions
              WHERE account_id = $1 AND description = $2 AND is_recurring = 1`,
        params: [accountId, 'Contract recurring coffee'],
      }),
    })
    const queryTransactionStateJson = await queryTransactionStateResponse.json()

    expect(queryRuleStateResponse.status).toBe(200)
    expect(queryRuleStateJson).toEqual([
      {
        balance: 9750,
        next_date: '2026-05-01',
      },
    ])
    expect(queryTransactionStateResponse.status).toBe(200)
    expect(queryTransactionStateJson).toEqual([{ recurring_count: 1 }])
  })

  it('rolls back abandoned server-side transactions after the lease expires', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const beginResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const beginJson = await beginResponse.json()
    const transactionId = beginJson.transactionId as string
    const accountId = 'expired-transaction-account'

    await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [accountId, 'Expired Transaction Account', 'checking', 999],
        transactionId,
      }),
    })

    await delay(350)

    const expiredQueryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id FROM accounts WHERE id = $1',
        params: [accountId],
        transactionId,
      }),
    })
    const expiredQueryJson = await expiredQueryResponse.json()

    expect(expiredQueryResponse.status).toBe(409)
    expect(expiredQueryJson.error).toContain('expired rolled back')

    const outsideQueryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id FROM accounts WHERE id = $1',
        params: [accountId],
      }),
    })
    const outsideQueryJson = await outsideQueryResponse.json()

    expect(outsideQueryResponse.status).toBe(200)
    expect(outsideQueryJson).toEqual([])
  })

  it('rejects invalid transactionId values and reports closed/unknown transaction states', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const beginResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const beginJson = await beginResponse.json()
    const transactionId = beginJson.transactionId as string

    const blankIdResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [], transactionId: '   ' }),
    })
    const blankIdJson = await blankIdResponse.json()

    expect(blankIdResponse.status).toBe(400)
    expect(blankIdJson.error).toBe('Invalid transactionId')

    const missingIdResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'commit' }),
    })
    const missingIdJson = await missingIdResponse.json()

    expect(missingIdResponse.status).toBe(400)
    expect(missingIdJson.error).toBe('Missing transactionId')

    const commitResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'commit', transactionId }),
    })
    const commitJson = await commitResponse.json()

    expect(commitResponse.status).toBe(200)
    expect(commitJson).toEqual({ ok: true, status: 'committed' })

    const closedQueryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [], transactionId }),
    })
    const closedQueryJson = await closedQueryResponse.json()

    expect(closedQueryResponse.status).toBe(409)
    expect(closedQueryJson.error).toContain('already committed')

    const unknownTxResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ sql: 'SELECT 1', params: [], transactionId: 'tx-does-not-exist' }),
    })
    const unknownTxJson = await unknownTxResponse.json()

    expect(unknownTxResponse.status).toBe(404)
    expect(unknownTxJson.error).toContain('Unknown transaction: tx-does-not-exist')
  })

  it('treats recurring rule and account currencies with casing or whitespace drift as equivalent', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const accountId = 'recurring-normalized-account'
    const ruleId = 'recurring-normalized-rule'

    const insertAccountResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, currency, balance) VALUES ($1, $2, $3, $4, $5)',
        params: [accountId, 'Recurring Normalized Account', 'checking', 'USD', 10000],
      }),
    })

    expect(insertAccountResponse.status).toBe(200)

    const insertRuleResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: `INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, end_date, account_id, to_account_id, category_id, subcategory_id, tags, notes, active)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        params: [
          ruleId,
          'Normalized recurring coffee',
          250,
          ' usd ',
          'expense',
          'monthly',
          '2026-04-01',
          null,
          accountId,
          null,
          null,
          null,
          '[]',
          null,
          1,
        ],
      }),
    })

    expect(insertRuleResponse.status).toBe(200)

    const materializeResponse = await fetch(`${SERVER_URL}/api/recurring/materialize`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({}),
    })
    const materializeJson = await materializeResponse.json()

    expect(materializeResponse.status).toBe(200)
    expect(materializeJson).toMatchObject({
      success: true,
      created: 1,
      message: 'Created 1 transaction(s) from recurring rules.',
    })

    const transactionCurrencyResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT currency FROM transactions WHERE account_id = $1 AND description = $2',
        params: [accountId, 'Normalized recurring coffee'],
      }),
    })
    const transactionCurrencyJson = await transactionCurrencyResponse.json()

    expect(transactionCurrencyResponse.status).toBe(200)
    expect(transactionCurrencyJson).toEqual([{ currency: 'USD' }])
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
