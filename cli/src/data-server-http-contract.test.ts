// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { request as requestHttp } from 'node:http'
import { createServer } from 'node:net'
import { EventEmitter, once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
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

// Observe HTTP dispatch and pause native backups, not the server's ownership internals.
// IPC barriers keep queued/cancelled/restore ordering deterministic without sleeps.
async function withObservedServer(
  run: (server: {
    request: (id: string, path: string, body?: unknown, signal?: AbortSignal) => Promise<Response>
    observed: (event: string) => Promise<void>
    command: (command: string) => Promise<void>
    process: ChildProcessWithoutNullStreams
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  }) => Promise<void>,
  preload = ''
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'shikin-session-boundary-'))
  const preloadPath = join(root, 'observe.mjs')
  writeFileSync(
    preloadPath,
    `${preload}
import { createRequire } from 'node:module'
import { Server } from 'node:http'
const require = createRequire(process.env.SHIKIN_TEST_REQUIRE_FROM)
const Database = require('better-sqlite3')
const emit = Server.prototype.emit
Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [req, res] = args
    const id = req.headers['x-test-request']
    if (id) {
      req.once('end', () => setImmediate(() => process.send('handled:' + id)))
      res.once('close', () => setImmediate(() => process.send('closed:' + id)))
    }
  }
  return emit.call(this, event, ...args)
}
let pause = null
let resume = null
process.on('message', command => {
  if (command === 'release') {
    resume?.()
    resume = null
  } else {
    pause = command
  }
  process.send('command:' + command)
})
const backup = Database.prototype.backup
Database.prototype.backup = async function (destination, ...args) {
  if ((pause === 'export' && destination.includes('.export-')) ||
      (pause === 'rollback' && this.name.includes('.backup-'))) {
    const event = 'paused:' + pause
    pause = null
    const { promise, resolve } = Promise.withResolvers()
    resume = resolve
    process.send(event)
    await promise
  }
  return backup.call(this, destination, ...args)
}
`
  )
  const port = await getFreePort()
  const url = `http://127.0.0.1:${port}`
  const child = spawn('node', ['--import', preloadPath, resolve('scripts/data-server.mjs')], {
    env: {
      ...process.env,
      HOME: root,
      XDG_DATA_HOME: join(root, 'data'),
      SHIKIN_DATA_SERVER_PORT: String(port),
      SHIKIN_DATA_SERVER_BRIDGE_TOKEN: TOKEN,
      SHIKIN_SERVER_TRANSACTION_TTL_MS: '300',
      SHIKIN_TEST_REQUIRE_FROM: resolve('package.json'),
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  }) as ChildProcessWithoutNullStreams
  const events = new Set<string>()
  const notifications = new EventEmitter()
  child.on('message', (message) => {
    const event = String(message)
    events.add(event)
    notifications.emit(event)
  })
  const observed = async (event: string) => {
    if (!events.has(event)) await once(notifications, event)
  }
  const exited = once(child, 'exit').then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
  }))
  try {
    await waitForServerReady(child, url)
    await run({
      request: (id, path, body, signal) =>
        fetch(`${url}/api/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Origin: ORIGIN,
            'X-Shikin-Bridge': TOKEN,
            'X-Test-Request': id,
            'Content-Type':
              body instanceof Uint8Array ? 'application/octet-stream' : 'application/json',
          },
          body:
            body instanceof Uint8Array
              ? body
              : body === undefined
                ? undefined
                : JSON.stringify(body),
          signal,
        }),
      observed,
      command: async (command) => {
        events.delete(`command:${command}`)
        child.send(command)
        await observed(`command:${command}`)
      },
      process: child,
      exited,
    })
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    rmSync(root, { recursive: true, force: true })
  }
}

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

  it('rolls back both due rules and their revisions when the second occurrence fails over HTTP', async () => {
    await withObservedServer(async ({ request }) => {
      for (const [id, sql] of [
        [
          'accounts',
          "INSERT INTO accounts (id, name, type, currency, balance) VALUES ('a', 'A', 'checking', 'USD', 1000)",
        ],
        [
          'rules',
          "INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, account_id, active, anchor_kind, anchor_day, end_date) VALUES ('r1', 'R1', 100, 'USD', 'expense', 'monthly', '2026-11-08', 'a', 1, 'fixed_day', 8, '2026-11-08'), ('r2', 'R2', 100, 'USD', 'expense', 'monthly', '2026-11-08', 'a', 1, 'fixed_day', 8, '2026-11-08')",
        ],
        [
          'fault',
          "CREATE TRIGGER fail_second BEFORE INSERT ON transactions WHEN NEW.recurring_rule_id = 'r2' BEGIN SELECT RAISE(ABORT, 'second occurrence failed'); END",
        ],
      ]) {
        expect((await request(id, 'db/execute', { sql })).status).toBe(200)
      }
      const before = await (
        await request('before', 'db/query', { sql: 'SELECT * FROM app_data_state' })
      ).json()
      const response = await request('materialize', 'recurring/materialize', {})
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'second occurrence failed' })
      expect(
        await (
          await request('state', 'db/query', {
            sql: 'SELECT a.balance, r.id, r.next_date, r.active, (SELECT COUNT(*) FROM transactions) AS count FROM accounts a JOIN recurring_rules r ON r.account_id = a.id ORDER BY r.id',
          })
        ).json()
      ).toEqual([
        { balance: 1000, id: 'r1', next_date: '2026-11-08', active: 1, count: 0 },
        { balance: 1000, id: 'r2', next_date: '2026-11-08', active: 1, count: 0 },
      ])
      expect(
        await (await request('after', 'db/query', { sql: 'SELECT * FROM app_data_state' })).json()
      ).toEqual(before)
    })
  })

  it.each(['archive-two', 'fractional-anchor'])(
    'pins legacy recurring %s handling at the HTTP boundary',
    async (scenario) => {
      await withObservedServer(async ({ request }) => {
        expect(
          (
            await request('account', 'db/execute', {
              sql: "INSERT INTO accounts (id, name, type, currency, balance, is_archived) VALUES ('a', 'A', 'checking', 'USD', 1000, $1)",
              params: [scenario === 'archive-two' ? 2 : 0],
            })
          ).status
        ).toBe(200)
        expect(
          (
            await request('rule', 'db/execute', {
              sql: "INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, account_id, active, anchor_kind, anchor_day, end_date) VALUES ('r', 'R', 100, 'USD', 'expense', 'monthly', '2026-11-08', 'a', 1, 'fixed_day', $1, '2026-11-08')",
              params: [scenario === 'fractional-anchor' ? 8.5 : 8],
            })
          ).status
        ).toBe(200)
        const response = await request('materialize', 'recurring/materialize', {})
        expect(response.status).toBe(scenario === 'archive-two' ? 200 : 500)
        expect(await response.json()).toEqual(
          scenario === 'archive-two'
            ? {
                success: false,
                reason: 'account_archived',
                message:
                  'Recurring rule "R" points at archived account a. Unarchive the account or pause the rule before materializing it.',
              }
            : { error: 'day-of-month recurrence anchor must be an integer from 1 through 31' }
        )
        const state = await request('state', 'db/query', {
          sql: 'SELECT a.balance, r.next_date, r.active, (SELECT COUNT(*) FROM transactions) AS count FROM accounts a JOIN recurring_rules r ON r.account_id = a.id',
        })
        expect(await state.json()).toEqual([
          { balance: 1000, next_date: '2026-11-08', active: 1, count: 0 },
        ])
      })
    }
  )

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
        ).toEqual({ name: '024_scoped_budgets' })
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

describe('database session ownership boundaries', () => {
  it('serves multiple queued operations in FIFO order', async () => {
    await withObservedServer(async (server) => {
      await server.command('export')
      const owner = server.request('owner', 'db/export')
      await server.observed('paused:export')
      const insert = server.request('insert', 'db/execute', {
        sql: "INSERT INTO accounts (id, name, type, balance) VALUES ('fifo', 'FIFO', 'checking', 1)",
      })
      await server.observed('handled:insert')
      const update = server.request('update', 'db/execute', {
        sql: "UPDATE accounts SET balance = balance + 1 WHERE id = 'fifo'",
      })
      await server.observed('handled:update')
      const query = server.request('query', 'db/query', {
        sql: "SELECT balance FROM accounts WHERE id = 'fifo'",
      })
      await server.observed('handled:query')
      await server.command('release')
      expect((await owner).status).toBe(200)
      expect((await insert).status).toBe(200)
      expect((await update).status).toBe(200)
      expect(await (await query).json()).toEqual([{ balance: 2 }])
    })
  })

  it('displaces queued work for pending maintenance and cancels a disconnected restore', async () => {
    await withObservedServer(async (server) => {
      const snapshot = new Uint8Array(
        await (await server.request('snapshot', 'db/export')).arrayBuffer()
      )
      await server.command('export')
      const owner = server.request('owner', 'db/export')
      await server.observed('paused:export')
      const displaced = server.request('displaced', 'db/execute', {
        sql: "INSERT INTO accounts (id, name, type) VALUES ('displaced', 'Displaced', 'checking')",
      })
      await server.observed('handled:displaced')
      const controller = new AbortController()
      const restore = server.request('restore', 'db/import', snapshot, controller.signal).then(
        () => 'completed',
        () => 'cancelled'
      )
      await server.observed('handled:restore')
      const displacedResponse = await displaced
      expect(displacedResponse.status).toBe(409)
      expect(await displacedResponse.json()).toEqual({
        error: 'Database restore started before this queued database request ran.',
      })
      const blocked = await server.request('blocked', 'db/query', { sql: 'SELECT 1' })
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toEqual({ error: 'Database restore is in progress.' })
      const secondRestore = await server.request('second-restore', 'db/import', snapshot)
      expect(secondRestore.status).toBe(409)
      expect(await secondRestore.json()).toEqual({
        error: 'Cannot import a database snapshot while another database restore is in progress.',
      })
      controller.abort()
      expect(await restore).toBe('cancelled')
      await server.observed('closed:restore')
      const query = server.request('after-cancel', 'db/query', {
        sql: "SELECT id FROM accounts WHERE id = 'displaced'",
      })
      await server.observed('handled:after-cancel')
      await server.command('release')
      expect((await owner).status).toBe(200)
      const response = await query
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([])
    })
  })

  it('keeps failed-migration rollback exclusive until original data is restored', async () => {
    const fixture = new Database(':memory:')
    try {
      runHostedTestMigrations(fixture, 21)
      fixture.exec('CREATE TABLE manual_exchange_rates (incompatible TEXT)')
      await withObservedServer(async (server) => {
        expect(
          (
            await server.request('seed', 'db/execute', {
              sql: "INSERT INTO accounts (id, name, type, balance) VALUES ('preserved', 'Preserved', 'checking', 321)",
            })
          ).status
        ).toBe(200)
        await server.command('rollback')
        const restore = server.request('restore', 'db/import', fixture.serialize())
        await server.observed('paused:rollback')
        const blocked = await server.request('blocked', 'db/query', { sql: 'SELECT 1' })
        expect(blocked.status).toBe(409)
        expect(await blocked.json()).toEqual({ error: 'Database restore is in progress.' })
        await server.command('release')
        expect((await restore).status).toBe(500)
        const query = await server.request('after-rollback', 'db/query', {
          sql: 'SELECT id, balance FROM accounts',
        })
        expect(query.status).toBe(200)
        expect(await query.json()).toEqual([{ id: 'preserved', balance: 321 }])
        const begin = await server.request('begin', 'db/transaction', { action: 'begin' })
        expect(begin.status).toBe(200)
        const { transactionId } = await begin.json()
        expect(
          (
            await server.request('rollback', 'db/transaction', {
              action: 'rollback',
              transactionId,
            })
          ).status
        ).toBe(200)
      })
    } finally {
      fixture.close()
    }
  })

  it('rejects queued work and releases an active transaction during shutdown', async () => {
    await withObservedServer(async (server) => {
      expect((await server.request('begin', 'db/transaction', { action: 'begin' })).status).toBe(
        200
      )
      const queued = server.request('queued', 'db/query', { sql: 'SELECT 1' })
      await server.observed('handled:queued')
      server.process.kill('SIGTERM')
      const response = await queued
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Database server is shutting down.' })
      expect(await server.exited).toEqual({ code: 0, signal: null })
    })
  })

  it('renews the lease deadline after one owner query', async () => {
    await withObservedServer(
      async (server) => {
        const begin = await server.request('begin', 'db/transaction', { action: 'begin' })
        expect(begin.status).toBe(200)
        const { transactionId } = await begin.json()

        await server.command('advance:150')
        const query = await server.request('renew', 'db/query', {
          sql: 'SELECT 1 AS ok',
          transactionId,
        })
        expect(query.status).toBe(200)
        expect(await query.json()).toEqual([{ ok: 1 }])

        // Export observes ownership without renewing it: the initial 300 ms
        // deadline is cancelled, and the replacement lease lasts until 450 ms.
        for (const time of [300, 449]) {
          await server.command(`advance:${time}`)
          const blocked = await server.request(`export:${time}`, 'db/export')
          expect(blocked.status).toBe(409)
          expect(await blocked.json()).toEqual({
            error: 'Cannot export the database while server-side transactions are active.',
          })
        }

        await server.command('advance:450')
        const expired = await server.request('expired', 'db/transaction', {
          action: 'commit',
          transactionId,
        })
        expect(expired.status).toBe(200)
        expect(await expired.json()).toEqual({ ok: true, status: 'expired_rolled_back' })
        const released = await server.request('released', 'db/query', {
          sql: 'SELECT 1 AS ok',
        })
        expect(released.status).toBe(200)
        expect(await released.json()).toEqual([{ ok: 1 }])
      },
      // Only this child uses a controlled timer clock; HTTP/IPC and SQLite
      // remain real. A delayed test runner cannot expire the lease.
      `import { mock } from 'node:test'
mock.timers.enable({ apis: ['setTimeout'] })
let elapsed = 0
process.on('message', command => {
  if (!command.startsWith('advance:')) return
  const target = Number(command.slice('advance:'.length))
  mock.timers.tick(target - elapsed)
  elapsed = target
})
`
    )
  })

  it.each(['committed', 'rolled_back', 'rollback_failed'] as const)(
    'retains %s across repeated terminal requests',
    async (status) => {
      const headers = {
        Origin: ORIGIN,
        'X-Shikin-Bridge': TOKEN,
        'Content-Type': 'application/json',
      }
      const transaction = async (body: unknown) =>
        fetch(`${SERVER_URL}/api/db/transaction`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      const begin = await transaction({ action: 'begin' })
      expect(begin.status).toBe(200)
      const { transactionId } = await begin.json()
      if (status === 'rollback_failed') {
        const forced = await fetch(`${SERVER_URL}/api/db/execute`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ sql: 'ROLLBACK', transactionId }),
        })
        expect(forced.status).toBe(200)
      }
      const close = await transaction({
        action: status === 'committed' ? 'commit' : 'rollback',
        transactionId,
      })
      expect(close.status).toBe(status === 'rollback_failed' ? 500 : 200)
      for (const action of ['commit', 'rollback']) {
        const repeated = await transaction({ action, transactionId })
        expect(repeated.status).toBe(200)
        expect(await repeated.json()).toEqual({ ok: true, status })
      }
    }
  )
})

describe('dated FX browser restore boundary', () => {
  const headers = { Origin: ORIGIN, 'X-Shikin-Bridge': TOKEN }
  async function readRows(sql: string) {
    const result = await fetch(`${SERVER_URL}/api/db/query`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params: [] }),
    })
    expect(result.status).toBe(200)
    return result.json()
  }
  it.each([19, 20, 21, 22, 23] as const)(
    'restores schema%i with empty legacy authority or exact schema22 FX snapshots',
    async (version) => {
      const fixture = new Database(':memory:')
      fixture.pragma('foreign_keys = ON')
      try {
        runHostedTestMigrations(fixture, version)
        fixture.exec(
          "INSERT INTO accounts(id,name,type,balance) VALUES ('fx-account','Synthetic','checking',12345)"
        )
        if (version >= 22)
          fixture.exec(`
        INSERT INTO settings(key,value) VALUES ('main_currency','MXN');
        INSERT INTO manual_exchange_rates(id,from_currency,to_currency,rate_decimal,effective_from,created_at) VALUES ('fx-rate','USD','MXN','17','2025-09-01','2025-09-01T00:00:00Z');
        INSERT INTO transaction_fx_evidence(id,original_transaction_id,original_account_id,transaction_type,status,ledger_treatment,input_amount_centavos,input_currency,account_amount_centavos,account_currency,account_balance_delta_centavos,transaction_date,rate_id,rate_decimal,created_at)
        VALUES ('fx-evidence','deleted-transaction','deleted-account','expense','posted','normal',100,'USD',1700,'MXN',-1700,'2025-09-14','fx-rate','17','2025-09-14T00:00:00Z');
      `)
        const response = await fetch(`${SERVER_URL}/api/db/import`, {
          method: 'POST',
          headers,
          body: fixture.serialize(),
        })
        expect(response.status, await response.text()).toBe(200)
        expect(await readRows('SELECT name FROM _migrations WHERE id = 24')).toEqual([
          { name: '024_scoped_budgets' },
        ])
        expect(await readRows("SELECT value FROM settings WHERE key = 'main_currency'")).toEqual(
          version >= 22 ? [{ value: 'MXN' }] : []
        )
        for (const table of ['manual_exchange_rates', 'transaction_fx_evidence'])
          expect(await readRows(`SELECT * FROM ${table}`)).toEqual(
            version >= 22 ? fixture.prepare(`SELECT * FROM ${table}`).all() : []
          )
        const exported = await fetch(`${SERVER_URL}/api/db/export`, { headers })
        expect(exported.status).toBe(200)
        const roundtripPath = join(tempHomeDir, `fx-roundtrip-${version}.db`)
        writeFileSync(roundtripPath, Buffer.from(await exported.arrayBuffer()))
        const roundtrip = new Database(roundtripPath)
        try {
          expect(roundtrip.prepare('SELECT balance FROM accounts').get()).toEqual({
            balance: 12345,
          })
          for (const table of ['manual_exchange_rates', 'transaction_fx_evidence'])
            expect(roundtrip.prepare(`SELECT * FROM ${table}`).all()).toEqual(
              await readRows(`SELECT * FROM ${table}`)
            )
        } finally {
          roundtrip.close()
        }
      } finally {
        fixture.close()
      }
    }
  )
  it.each([19, 20, 21, 25] as const)(
    'restores original live data when schema%i import fails or is future',
    async (version) => {
      const before = await readRows('SELECT * FROM app_data_state')
      const accounts = await readRows('SELECT * FROM accounts')
      const main = await readRows("SELECT value FROM settings WHERE key = 'main_currency'")
      const rates = await readRows('SELECT * FROM manual_exchange_rates')
      const evidence = await readRows('SELECT * FROM transaction_fx_evidence')
      const fixture = new Database(':memory:')
      try {
        runHostedTestMigrations(fixture, version === 25 ? 24 : version)
        if (version === 25)
          fixture.exec("INSERT INTO _migrations(id,name) VALUES (25,'025_future')")
        else fixture.exec('CREATE TABLE manual_exchange_rates (incompatible TEXT)')
        const response = await fetch(`${SERVER_URL}/api/db/import`, {
          method: 'POST',
          headers,
          body: fixture.serialize(),
        })
        expect(response.ok).toBe(false)
        expect(await readRows('SELECT * FROM app_data_state')).toEqual(before)
        expect(await readRows('SELECT * FROM accounts')).toEqual(accounts)
        expect(await readRows("SELECT value FROM settings WHERE key = 'main_currency'")).toEqual(
          main
        )
        expect(await readRows('SELECT * FROM manual_exchange_rates')).toEqual(rates)
        expect(await readRows('SELECT * FROM transaction_fx_evidence')).toEqual(evidence)
      } finally {
        fixture.close()
      }
    }
  )
})
