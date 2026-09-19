// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { request as requestHttp } from 'node:http'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let SERVER_URL = 'http://127.0.0.1:1480'
const ORIGIN = 'http://localhost:1420'
const TOKEN = 'server-http-contract-token'

let serverProcess: ChildProcessWithoutNullStreams | null = null
let tempHomeDir = ''
let tempDataHomeDir = ''

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

async function waitForServerReady(
  processRef: ChildProcessWithoutNullStreams,
  serverUrl = SERVER_URL
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processRef.exitCode !== null) {
      throw new Error(`data-server exited early with code ${processRef.exitCode}`)
    }

    try {
      const response = await fetch(`${serverUrl}/api/store`, {
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
  tempDataHomeDir = join(tempHomeDir, 'xdg-data-home')
  const serverPath = resolve(process.cwd(), 'scripts/data-server.mjs')

  serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      HOME: tempHomeDir,
      XDG_DATA_HOME: tempDataHomeDir,
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

    const appDataRes = await fetch(`${SERVER_URL}/api/fs/appdata`, {
      headers: defaultHeaders,
    })
    const appDataJson = await appDataRes.json()

    expect(appDataRes.status).toBe(200)
    expect(appDataJson).toEqual({ path: join(tempDataHomeDir, 'com.asf.shikin') })
    expect(statSync(appDataJson.path).mode & 0o777).toBe(0o700)

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

    let outsideQuerySettled = false
    const outsideQueryBeforeCommitPromise = fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id FROM accounts WHERE id = $1',
        params: [accountId],
      }),
    }).then((response) => {
      outsideQuerySettled = true
      return response
    })

    await delay(50)
    expect(outsideQuerySettled).toBe(false)

    const commitResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'commit', transactionId }),
    })
    const commitJson = await commitResponse.json()

    expect(commitResponse.status).toBe(200)
    expect(commitJson).toEqual({ ok: true, status: 'committed' })

    const outsideQueryBeforeCommitResponse = await outsideQueryBeforeCommitPromise
    const outsideQueryBeforeCommitJson = await outsideQueryBeforeCommitResponse.json()
    expect(outsideQueryBeforeCommitResponse.status).toBe(200)
    expect(outsideQueryBeforeCommitJson).toEqual([{ id: accountId }])

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
    const dueDate = dayjs().format('YYYY-MM-DD')
    const nextDueDate = dayjs().add(1, 'month').format('YYYY-MM-DD')

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
          dueDate,
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
        next_date: nextDueDate,
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

  it('queues overlapping transaction begins without delaying the owner rollback', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const firstResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const first = await firstResponse.json()

    let secondSettled = false
    const secondPromise = fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    }).then((response) => {
      secondSettled = true
      return response
    })

    await delay(50)
    expect(secondSettled).toBe(false)

    const rollbackStartedAt = Date.now()
    const rollbackResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'rollback', transactionId: first.transactionId }),
    })
    expect(rollbackResponse.status).toBe(200)
    expect(Date.now() - rollbackStartedAt).toBeLessThan(1_000)

    const secondResponse = await secondPromise
    const second = await secondResponse.json()
    expect(secondResponse.status).toBe(200)

    const secondQueryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT 1 AS usable',
        params: [],
        transactionId: second.transactionId,
      }),
    })
    expect(await secondQueryResponse.json()).toEqual([{ usable: 1 }])

    const secondRollbackResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'rollback', transactionId: second.transactionId }),
    })
    expect(secondRollbackResponse.status).toBe(200)
  })

  it('drops a disconnected queued write instead of executing it after the owner releases', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }
    const accountId = 'cancelled-queued-write-account'

    const beginResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const transaction = await beginResponse.json()

    const controller = new AbortController()
    const queuedWrite = fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      signal: controller.signal,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [accountId, 'Cancelled queued write', 'checking', 1],
      }),
    })
    await delay(50)
    controller.abort()
    await expect(queuedWrite).rejects.toThrow()

    await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'rollback', transactionId: transaction.transactionId }),
    })

    const queryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id FROM accounts WHERE id = $1',
        params: [accountId],
      }),
    })
    expect(await queryResponse.json()).toEqual([])

    const nextBeginResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const nextTransaction = await nextBeginResponse.json()
    expect(nextBeginResponse.status).toBe(200)
    await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'rollback', transactionId: nextTransaction.transactionId }),
    })
  })

  it('releases a queued transaction when the owner lease expires', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const firstResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const first = await firstResponse.json()

    const secondResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const second = await secondResponse.json()
    expect(secondResponse.status).toBe(200)

    const expiredResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'rollback', transactionId: first.transactionId }),
    })
    expect(await expiredResponse.json()).toEqual({ ok: true, status: 'expired_rolled_back' })

    const secondRollbackResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'rollback', transactionId: second.transactionId }),
    })
    expect(secondRollbackResponse.status).toBe(200)
  })

  it('queues autocommit SQL without blocking the active transaction commit', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }
    const accountId = 'queued-autocommit-account'

    const beginResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const transaction = await beginResponse.json()

    let writeSettled = false
    const writePromise = fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [accountId, 'Queued autocommit', 'checking', 5],
      }),
    }).then((response) => {
      writeSettled = true
      return response
    })

    await delay(50)
    expect(writeSettled).toBe(false)

    const commitStartedAt = Date.now()
    const commitResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'commit', transactionId: transaction.transactionId }),
    })
    expect(commitResponse.status).toBe(200)
    expect(Date.now() - commitStartedAt).toBeLessThan(1_000)

    const writeResponse = await writePromise
    expect(writeResponse.status).toBe(200)
    const queryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ sql: 'SELECT id FROM accounts WHERE id = $1', params: [accountId] }),
    })
    expect(await queryResponse.json()).toEqual([{ id: accountId }])
  })

  it('releases ownership and reports a truthful status when COMMIT fails', async () => {
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
    const transaction = await beginResponse.json()

    const forceRollbackResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'ROLLBACK',
        params: [],
        transactionId: transaction.transactionId,
      }),
    })
    expect(forceRollbackResponse.status).toBe(200)

    const failedCommitResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'commit', transactionId: transaction.transactionId }),
    })
    expect(failedCommitResponse.status).toBe(500)

    const repeatedCommitResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'commit', transactionId: transaction.transactionId }),
    })
    expect(await repeatedCommitResponse.json()).toEqual({ ok: true, status: 'commit_failed' })

    const queryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ sql: 'SELECT 1 AS ok', params: [] }),
    })
    expect(await queryResponse.json()).toEqual([{ ok: 1 }])
  })

  it('treats recurring rule and account currencies with casing or whitespace drift as equivalent', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }

    const accountId = 'recurring-normalized-account'
    const ruleId = 'recurring-normalized-rule'
    const dueDate = dayjs().format('YYYY-MM-DD')

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
          dueDate,
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

  it('rechecks transaction ownership after snapshot upload before restoring', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }
    const preservedAccountId = 'restore-upload-race-preserved-account'

    const snapshotResponse = await fetch(`${SERVER_URL}/api/db/export`, {
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
      },
    })
    const snapshot = new Uint8Array(await snapshotResponse.arrayBuffer())
    expect(snapshotResponse.status).toBe(200)

    const insertResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [preservedAccountId, 'Restore race preserved', 'checking', 10],
      }),
    })
    expect(insertResponse.status).toBe(200)

    let uploadController: ReadableStreamDefaultController<Uint8Array> | null = null
    const upload = new ReadableStream<Uint8Array>({
      start(controller) {
        uploadController = controller
        controller.enqueue(snapshot.subarray(0, 16))
      },
    })
    const importPromise = fetch(`${SERVER_URL}/api/db/import`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
        'Content-Type': 'application/octet-stream',
      },
      body: upload,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await delay(50)
    const beginResponse = await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'begin' }),
    })
    const transaction = await beginResponse.json()
    expect(beginResponse.status).toBe(200)

    const blockedExportResponse = await fetch(`${SERVER_URL}/api/db/export`, {
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
      },
    })
    expect(blockedExportResponse.status).toBe(409)

    uploadController!.enqueue(snapshot.subarray(16))
    uploadController!.close()
    const importResponse = await importPromise
    expect(importResponse.status).toBe(409)

    await fetch(`${SERVER_URL}/api/db/transaction`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action: 'rollback', transactionId: transaction.transactionId }),
    })

    const queryResponse = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'SELECT id FROM accounts WHERE id = $1',
        params: [preservedAccountId],
      }),
    })
    expect(await queryResponse.json()).toEqual([{ id: preservedAccountId }])
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

  it('waits for a disconnected database restore owner before exiting on SIGTERM', async () => {
    const defaultHeaders = {
      Origin: ORIGIN,
      'X-Shikin-Bridge': TOKEN,
      'Content-Type': 'application/json',
    }
    const restoredAccountId = `shutdown-restore-account-${Date.now()}`
    const seedResponse = await fetch(`${SERVER_URL}/api/db/execute`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        sql: 'INSERT INTO accounts (id, name, type, balance) VALUES ($1, $2, $3, $4)',
        params: [restoredAccountId, 'Shutdown restore account', 'checking', 4321],
      }),
    })
    expect(seedResponse.status).toBe(200)

    const snapshotResponse = await fetch(`${SERVER_URL}/api/db/export`, {
      headers: {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
      },
    })
    const snapshot = new Uint8Array(await snapshotResponse.arrayBuffer())
    expect(snapshotResponse.status).toBe(200)

    const shutdownRoot = mkdtempSync(join(tmpdir(), 'shikin-data-server-shutdown-test-'))
    const shutdownDataHome = join(shutdownRoot, 'xdg-data-home')
    const shutdownDbPath = join(shutdownDataHome, 'com.asf.shikin', 'shikin.db')
    const pauseReadyPath = join(shutdownRoot, 'backup-paused')
    const releaseBackupPath = join(shutdownRoot, 'release-backup')
    const preloadPath = join(shutdownRoot, 'pause-candidate-backup.mjs')
    const serverPath = resolve(process.cwd(), 'scripts/data-server.mjs')
    const requireFrom = resolve(process.cwd(), 'package.json')
    const shutdownPort = await getFreePort()
    const shutdownServerUrl = `http://127.0.0.1:${shutdownPort}`

    writeFileSync(
      preloadPath,
      `import { createRequire } from 'node:module'
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(process.env.SHIKIN_TEST_REQUIRE_FROM)
const Database = require('better-sqlite3')
const originalBackup = Database.prototype.backup
let paused = false

Database.prototype.backup = async function (destinationPath, ...args) {
  if (!paused && destinationPath === process.env.SHIKIN_TEST_PAUSE_BACKUP_DESTINATION) {
    paused = true
    writeFileSync(process.env.SHIKIN_TEST_BACKUP_PAUSED_PATH, 'paused')
    while (!existsSync(process.env.SHIKIN_TEST_RELEASE_BACKUP_PATH)) await delay(10)
  }
  return originalBackup.call(this, destinationPath, ...args)
}
`
    )

    let shutdownProcess: ChildProcessWithoutNullStreams | null = null
    let processOutput = ''
    try {
      shutdownProcess = spawn('node', ['--import', preloadPath, serverPath], {
        env: {
          ...process.env,
          HOME: shutdownRoot,
          XDG_DATA_HOME: shutdownDataHome,
          SHIKIN_RESPECT_XDG_DATA_HOME: '1',
          SHIKIN_DATA_SERVER_BRIDGE_TOKEN: TOKEN,
          SHIKIN_DATA_SERVER_PORT: String(shutdownPort),
          SHIKIN_TEST_REQUIRE_FROM: requireFrom,
          SHIKIN_TEST_PAUSE_BACKUP_DESTINATION: shutdownDbPath,
          SHIKIN_TEST_BACKUP_PAUSED_PATH: pauseReadyPath,
          SHIKIN_TEST_RELEASE_BACKUP_PATH: releaseBackupPath,
        },
        stdio: 'pipe',
      })
      shutdownProcess.stdout.on('data', (chunk) => {
        processOutput += chunk.toString()
      })
      shutdownProcess.stderr.on('data', (chunk) => {
        processOutput += chunk.toString()
      })
      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolveExit) => {
          shutdownProcess!.once('exit', (code, signal) => resolveExit({ code, signal }))
        }
      )

      await waitForServerReady(shutdownProcess, shutdownServerUrl)

      const importRequest = requestHttp(`${shutdownServerUrl}/api/db/import`, {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          'X-Shikin-Bridge': TOKEN,
          'Content-Type': 'application/octet-stream',
          'Content-Length': snapshot.byteLength,
        },
      })
      importRequest.on('response', (response) => response.resume())
      importRequest.on('error', () => {})
      importRequest.end(snapshot)

      for (let attempt = 0; attempt < 200 && !existsSync(pauseReadyPath); attempt += 1) {
        if (shutdownProcess.exitCode !== null) {
          throw new Error(`restore server exited before backup paused:\n${processOutput}`)
        }
        await delay(25)
      }
      expect(existsSync(pauseReadyPath), processOutput).toBe(true)

      const importClosed = new Promise<void>((resolveClose) =>
        importRequest.once('close', resolveClose)
      )
      importRequest.destroy()
      await importClosed
      shutdownProcess.kill('SIGTERM')

      await delay(200)
      expect(shutdownProcess.exitCode, processOutput).toBeNull()

      writeFileSync(releaseBackupPath, 'release')
      const exit = await Promise.race([
        exitPromise,
        delay(5_000).then(() => {
          throw new Error(`restore server did not exit after backup resumed:\n${processOutput}`)
        }),
      ])
      expect(exit).toEqual({ code: 0, signal: null })

      const restoredDb = new Database(shutdownDbPath, { readonly: true, fileMustExist: true })
      try {
        expect(restoredDb.pragma('integrity_check', { simple: true })).toBe('ok')
        expect(
          restoredDb.prepare('SELECT name FROM _migrations ORDER BY id DESC LIMIT 1').get()
        ).toEqual({ name: '021_backend_remediation_foundation' })
        expect(
          restoredDb.prepare('SELECT id, balance FROM accounts WHERE id = ?').get(restoredAccountId)
        ).toEqual({
          id: restoredAccountId,
          balance: 4321,
        })
      } finally {
        restoredDb.close()
      }
    } finally {
      writeFileSync(releaseBackupPath, 'release')
      if (shutdownProcess && shutdownProcess.exitCode === null) {
        shutdownProcess.kill('SIGKILL')
        await delay(50)
      }
      rmSync(shutdownRoot, { recursive: true, force: true })
    }
  }, 30_000)
})
