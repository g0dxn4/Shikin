import {
  SCOPED_BUDGETS_MIGRATION,
  SCOPED_BUDGETS_SCHEMA,
  SCOPED_BUDGETS_OBJECTS,
} from '@shikin/finance-core/scoped-budgets-migration'
import {
  CLASSIFICATION_TYPES_MIGRATION,
  CLASSIFICATION_TYPES_SCHEMA,
  CLASSIFICATION_TYPES_OBJECTS,
  DATED_FX_MIGRATION,
  DATED_FX_SCHEMA,
  DATED_FX_OBJECTS,
  BACKEND_FOUNDATION_MIGRATION,
  BACKEND_FOUNDATION_SCHEMA,
  BACKEND_FOUNDATION_OBJECTS,
} from '@shikin/finance-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function within<T>(promise: Promise<T>, timeoutMs = 250): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.doUnmock('@/lib/runtime')
  vi.doUnmock('@tauri-apps/api/core')
  vi.doUnmock('@tauri-apps/api/path')
  vi.doUnmock('@tauri-apps/plugin-sql')
  vi.resetModules()
})

function mockTauriDatabaseModules() {
  const migrationRows = [
    '001_core_tables',
    '003_credit_cards',
    '004_category_rules',
    '005_recurring_rules',
    '006_goals',
    '007_recaps',
    '010_transaction_splits',
    '011_net_worth_snapshots',
    '012_account_balance_history',
    '013_recurring_rules_currency',
    '014_recurring_rules_currency_backfill',
    '015_primary_account',
    '016_cli_qol_foundation',
    '017_investment_type_cetes',
    '018_placeholder_transactions',
    '019_financial_semantics',
    '020_quote_recurrence_import_identity',
    BACKEND_FOUNDATION_MIGRATION,
    DATED_FX_MIGRATION,
    CLASSIFICATION_TYPES_MIGRATION,
    SCOPED_BUDGETS_MIGRATION,
  ].map((name) => ({ name }))
  const tableRows = [
    '_migrations',
    'accounts',
    'categories',
    'subcategories',
    'transactions',
    'subscriptions',
    'budgets',
    'budget_periods',
    'investments',
    'stock_prices',
    'exchange_rates',
    'settings',
    'extension_data',
    'category_rules',
    'goals',
    'recaps',
    'transaction_splits',
    'net_worth_snapshots',
    'account_balance_history',
    'recurring_rules',
    'audit_log',
    'cashflow_buckets',
    'cashflow_bucket_allocations',
    'category_suggestions',
    'credit_card_statements',
    'account_reconciliations',
    'receivables',
    ...Object.keys(BACKEND_FOUNDATION_SCHEMA),
    ...Object.keys(DATED_FX_SCHEMA),
    ...Object.keys(CLASSIFICATION_TYPES_SCHEMA),
    ...Object.keys(SCOPED_BUDGETS_SCHEMA),
  ].map((name) => ({ name }))
  const columnRows = [
    ...Object.values(BACKEND_FOUNDATION_SCHEMA).flat(),
    ...Object.values(DATED_FX_SCHEMA).flat(),
    ...Object.values(CLASSIFICATION_TYPES_SCHEMA).flat(),
    ...Object.values(SCOPED_BUDGETS_SCHEMA).flat(),
    'id',
    'name',
    'applied_at',
    'type',
    'currency',
    'balance',
    'is_archived',
    'is_primary',
    'is_active',
    'credit_limit',
    'statement_closing_day',
    'payment_due_day',
    'account_mode',
    'category_id',
    'sort_order',
    'account_id',
    'amount',
    'date',
    'status',
    'source',
    'note',
    'recurring_rule_id',
    'is_placeholder',
    'placeholder_status',
    'resolved_at',
    'resolved_by_transaction_id',
    'placeholder_reason',
    'placeholder_parent_transaction_id',
    'ledger_treatment',
    'reporting_treatment',
    'transaction_kind',
    'staging_batch_id',
    'reconciliation_id',
    'matched_transaction_id',
    'import_source',
    'import_external_id',
    'import_fingerprint',
    'quote_currency',
    'anchor_kind',
    'anchor_day',
    'billing_cycle',
    'next_billing_date',
    'period',
    'budget_id',
    'start_date',
    'end_date',
    'spent',
    'symbol',
    'shares',
    'price',
    'from_currency',
    'to_currency',
    'rate',
    'value',
    'key',
    'extension_id',
    'pattern',
    'next_date',
    'target_amount',
    'current_amount',
    'deadline',
    'period_start',
    'period_end',
    'summary',
    'generated_at',
    'transaction_id',
    'bucket_id',
    'account_type',
    'snapshot_date',
    'net_worth',
    'old_balance',
    'new_balance',
    'changed_by',
    'entity',
    'entity_id',
    'action',
    'before_json',
    'after_json',
    'description',
    'title',
    'content',
    'balance_delta',
    'target_balance',
    'allocation_date',
    'suggested_category_id',
    'suggested_subcategory_id',
    'confidence',
    'reviewed_at',
    'created_at',
    'updated_at',
    'statement_start_date',
    'statement_end_date',
    'due_date',
    'statement_balance',
    'minimum_payment',
    'paid_amount',
    'reconciliation_date',
    'actual_balance',
    'stored_balance_before',
    'ledger_balance_before',
    'ledger_balance_after',
    'adjustment_amount',
    'adjustment_transaction_id',
    'payer',
    'received_amount',
    'project_reference',
    'invoice_reference',
    'matched_transaction_id',
    'notes',
  ].map((name) => ({ name, notnull: name === 'status' ? 0 : undefined, dflt_value: null }))
  const triggerRows = [
    {
      name: 'trg_transactions_status_insert_default',
      sql: "AFTER INSERT ON transactions UPDATE transactions SET status = 'posted' WHERE id = NEW.id",
    },
    {
      name: 'trg_transactions_status_update_default',
      sql: "AFTER UPDATE OF status ON transactions UPDATE transactions SET status = 'posted' WHERE id = NEW.id",
    },
    {
      name: 'trg_transactions_status_insert_valid',
      sql: "BEFORE INSERT ON transactions NEW.status NOT IN ('pending', 'posted', 'cleared') RAISE(ABORT, 'Invalid transaction status')",
    },
    {
      name: 'trg_transactions_status_update_valid',
      sql: "BEFORE UPDATE OF status ON transactions NEW.status NOT IN ('pending', 'posted', 'cleared') RAISE(ABORT, 'Invalid transaction status')",
    },
  ]

  const tauriDatabase = {
    select: vi.fn(async (sql: string) => {
      if (sql === 'SELECT name FROM _migrations' || sql === 'SELECT id, name FROM _migrations')
        return migrationRows
      if (sql === 'SELECT * FROM app_data_state')
        return [{ id: 1, database_id: 'synthetic', data_revision: 0 }]
      if (
        sql.includes("type IN ('index', 'trigger')") ||
        sql.includes("type IN ('table', 'index', 'trigger')")
      )
        return Object.entries({
          ...BACKEND_FOUNDATION_OBJECTS,
          ...DATED_FX_OBJECTS,
          ...CLASSIFICATION_TYPES_OBJECTS,
          ...SCOPED_BUDGETS_OBJECTS,
        }).map(([name, sql]) => ({ name, sql }))
      if (sql.includes("sqlite_master WHERE type = 'table'")) return tableRows
      if (sql.startsWith('PRAGMA table_info(')) return columnRows
      if (sql.includes("sqlite_master WHERE type = 'trigger'")) return triggerRows
      return []
    }),
    execute: vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 0 })),
    close: vi.fn(async () => {}),
  }
  const loadDatabase = vi.fn(async () => tauriDatabase)
  const invoke = vi.fn()

  vi.doMock('@/lib/runtime', () => ({
    DATA_SERVER_URL: 'http://127.0.0.1:1480',
    isTauri: true,
    withDataServerHeaders: (headers?: HeadersInit) => headers ?? {},
  }))
  vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
  vi.doMock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/tmp/shikin-test'),
    join: vi.fn(async (...parts: string[]) => parts.join('/')),
  }))
  vi.doMock('@tauri-apps/plugin-sql', () => ({
    default: { load: loadDatabase },
  }))

  return { invoke, loadDatabase, tauriDatabase }
}

describe('database browser transactions', () => {
  it('binds browser transaction queries and writes to one server transaction', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')
    vi.stubEnv('VITE_DATA_SERVER_BRIDGE_TOKEN', 'db-transaction-test-token')

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}

      if (url.endsWith('/api/db/transaction') && body.action === 'begin') {
        return jsonResponse({ transactionId: 'browser-tx-123' })
      }

      if (url.endsWith('/api/db/query')) {
        expect(body.transactionId).toBe('browser-tx-123')
        return jsonResponse([{ id: 'row-1' }])
      }

      if (url.endsWith('/api/db/execute')) {
        expect(body.transactionId).toBe('browser-tx-123')
        return jsonResponse({ rowsAffected: 1, lastInsertId: 0 })
      }

      if (url.endsWith('/api/db/transaction') && body.action === 'commit') {
        expect(body.transactionId).toBe('browser-tx-123')
        return jsonResponse({ ok: true, status: 'committed' })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { withTransaction } = await import('@/lib/database')
    const result = await withTransaction(async (tx) => {
      const rows = await tx.query<{ id: string }>('SELECT id FROM accounts')
      const write = await tx.execute('UPDATE accounts SET balance = $1 WHERE id = $2', [
        100,
        'acct-1',
      ])
      return { rows, write }
    })

    expect(result).toEqual({
      rows: [{ id: 'row-1' }],
      write: { rowsAffected: 1, lastInsertId: 0 },
    })
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:1480/api/db/transaction',
      'http://127.0.0.1:1480/api/db/query',
      'http://127.0.0.1:1480/api/db/execute',
      'http://127.0.0.1:1480/api/db/transaction',
    ])
  })

  it('keeps the transaction owner moving ahead of six connection-blocking browser operations', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')

    const transactionId = 'browser-owner'
    const callbackStarted = deferred<void>()
    const releaseCallback = deferred<void>()
    const ownershipReleased = deferred<void>()
    const events: string[] = []
    const waiters: Array<() => void> = []
    let availableConnections = 6
    let ownerActive = false

    const acquireConnection = async () => {
      if (availableConnections > 0) {
        availableConnections -= 1
        return
      }
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
    const releaseConnection = () => {
      const next = waiters.shift()
      if (next) next()
      else availableConnections += 1
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await acquireConnection()
      try {
        const url = String(input)
        const body = init?.body instanceof Uint8Array ? {} : JSON.parse(String(init?.body ?? '{}'))
        const owned = body.transactionId === transactionId

        if (ownerActive && !owned) await ownershipReleased.promise

        if (url.endsWith('/api/db/transaction') && body.action === 'begin') {
          events.push('begin')
          ownerActive = true
          return jsonResponse({ transactionId })
        }
        if (url.endsWith('/api/db/transaction') && body.action === 'commit') {
          events.push('commit')
          ownerActive = false
          ownershipReleased.resolve()
          return jsonResponse({ ok: true, status: 'committed' })
        }
        if (url.endsWith('/api/db/query')) {
          events.push(owned ? `tx-query:${body.sql}` : `query:${body.sql}`)
          return jsonResponse([])
        }
        if (url.endsWith('/api/db/execute')) {
          events.push(owned ? `tx-execute:${body.sql}` : `execute:${body.sql}`)
          return jsonResponse({ rowsAffected: 1, lastInsertId: 0 })
        }
        if (url.endsWith('/api/recurring/materialize')) {
          events.push('recurring')
          return jsonResponse({ success: true, created: 0, message: 'none due' })
        }
        if (url.endsWith('/api/runtime/diagnostics')) {
          events.push('diagnostics')
          return jsonResponse({
            success: true,
            build: 'hosted-web',
            version: '1.1.0',
            schemaVersion: 24,
            schemaMigration: '024_classification_types',
            databaseLineageId: 'lineage',
            localInstance: { status: 'available', id: 'instance' },
            dataRevision: 1,
            lastFinancialWriteAt: null,
          })
        }
        if (url.endsWith('/api/db/export')) {
          events.push('export')
          return new Response(new Uint8Array([1, 2, 3]))
        }
        if (url.endsWith('/api/db/import')) {
          events.push('import')
          return jsonResponse({ ok: true })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      } finally {
        releaseConnection()
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const database = await import('@/lib/database')
    const { getRuntimeDiagnostics } = await import('@/lib/runtime-diagnostics')
    const db = await database.getDb()
    events.length = 0

    const transaction = database.withTransaction(async (tx) => {
      callbackStarted.resolve()
      await releaseCallback.promise
      await Promise.all([
        tx.query('owner query 1'),
        tx.query('owner query 2'),
        tx.execute('owner execute'),
      ])
      return 'committed'
    })
    await callbackStarted.promise

    const nonOwners = [
      database.query('outside query'),
      database.execute('outside execute'),
      db.select('shim query'),
      db.execute('shim execute'),
      database.getDb(),
      database.materializeRecurringTransactionsBrowser(),
      getRuntimeDiagnostics(),
      database.exportDatabaseSnapshot(),
      database.importDatabaseSnapshot(new Uint8Array([4, 5, 6])),
    ]

    // Let all current-code fetches take browser slots before the owner callback continues.
    await Promise.resolve()
    await Promise.resolve()
    releaseCallback.resolve()

    try {
      await expect(within(transaction)).resolves.toBe('committed')
      await expect(Promise.all(nonOwners)).resolves.toHaveLength(9)
    } finally {
      ownershipReleased.resolve()
      releaseCallback.resolve()
      await Promise.allSettled([transaction, ...nonOwners])
    }

    expect(events.slice(0, 5)).toEqual([
      'begin',
      'tx-query:owner query 1',
      'tx-query:owner query 2',
      'tx-execute:owner execute',
      'commit',
    ])
    expect(events.slice(5)).toEqual([
      'query:outside query',
      'execute:outside execute',
      'query:shim query',
      'execute:shim execute',
      'query:SELECT 1 AS ok',
      'recurring',
      'diagnostics',
      'export',
      'import',
    ])
  })

  it('waits for the first browser transaction before beginning a second one', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')
    const releaseFirst = deferred<void>()
    const firstStarted = deferred<void>()
    const events: string[] = []
    let sequence = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        if (body.action === 'begin') {
          sequence += 1
          events.push(`begin:${sequence}`)
          return jsonResponse({ transactionId: `tx-${sequence}` })
        }
        if (body.action === 'commit') {
          events.push(`commit:${body.transactionId}`)
          return jsonResponse({ ok: true, status: 'committed' })
        }
        throw new Error('Unexpected request')
      })
    )

    const { withTransaction } = await import('@/lib/database')
    const first = withTransaction(async () => {
      firstStarted.resolve()
      await releaseFirst.promise
      return 'first'
    })
    await firstStarted.promise
    const second = withTransaction(async () => 'second')
    await Promise.resolve()

    expect(events).toEqual(['begin:1'])
    releaseFirst.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(events).toEqual(['begin:1', 'commit:tx-1', 'begin:2', 'commit:tx-2'])
  })

  it('holds the browser queue until a response body is consumed', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')
    const bodyStarted = deferred<void>()
    const releaseBody = deferred<void>()
    const events: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/db/query')) {
          events.push('query-fetch')
          return {
            ok: true,
            json: async () => {
              bodyStarted.resolve()
              await releaseBody.promise
              return []
            },
          } as Response
        }
        events.push('execute-fetch')
        return jsonResponse({ rowsAffected: 1, lastInsertId: 0 })
      })
    )

    const { execute, query } = await import('@/lib/database')
    const first = query('SELECT 1')
    await bodyStarted.promise
    const second = execute('UPDATE settings SET value = value')
    await Promise.resolve()
    expect(events).toEqual(['query-fetch'])

    releaseBody.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(['query-fetch', 'execute-fetch'])
  })

  it('releases the browser queue after begin fails', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')
    const releaseBegin = deferred<void>()
    const events: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/db/transaction')) {
          events.push('begin')
          await releaseBegin.promise
          return jsonResponse({ error: 'begin failed' }, 500)
        }
        events.push('query')
        return jsonResponse([])
      })
    )

    const { query, withTransaction } = await import('@/lib/database')
    const failed = withTransaction(async () => undefined)
    await Promise.resolve()
    const next = query('SELECT 1')
    await Promise.resolve()
    expect(events).toEqual(['begin'])

    releaseBegin.resolve()
    await expect(failed).rejects.toThrow('begin failed')
    await expect(next).resolves.toEqual([])
    expect(events).toEqual(['begin', 'query'])
  })

  it('preserves a callback error when rollback fails and then continues the browser queue', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')
    const rollbackStarted = deferred<void>()
    const releaseRollback = deferred<void>()
    const events: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        if (body.action === 'begin') return jsonResponse({ transactionId: 'callback-failure' })
        if (body.action === 'rollback') {
          events.push('rollback')
          rollbackStarted.resolve()
          await releaseRollback.promise
          return jsonResponse({ error: 'rollback transport failed' }, 500)
        }
        if (String(input).endsWith('/api/db/query')) {
          events.push('query')
          return jsonResponse([])
        }
        throw new Error('Unexpected request')
      })
    )

    const { query, withTransaction } = await import('@/lib/database')
    const failed = withTransaction(async () => {
      throw new Error('original callback failure')
    })
    await rollbackStarted.promise
    const next = query('SELECT 1')
    await Promise.resolve()
    expect(events).toEqual(['rollback'])

    releaseRollback.resolve()
    await expect(failed).rejects.toThrow('original callback failure')
    await expect(next).resolves.toEqual([])
    expect(events).toEqual(['rollback', 'query'])
  })

  it('preserves a commit error when rollback fails and then continues the browser queue', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')
    const rollbackStarted = deferred<void>()
    const releaseRollback = deferred<void>()
    const events: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        if (body.action === 'begin') return jsonResponse({ transactionId: 'commit-failure' })
        if (body.action === 'commit') return jsonResponse({ error: 'commit transport failed' }, 500)
        if (body.action === 'rollback') {
          events.push('rollback')
          rollbackStarted.resolve()
          await releaseRollback.promise
          return jsonResponse({ error: 'rollback transport failed' }, 500)
        }
        if (String(input).endsWith('/api/db/query')) {
          events.push('query')
          return jsonResponse([])
        }
        throw new Error('Unexpected request')
      })
    )

    const { query, withTransaction } = await import('@/lib/database')
    const failed = withTransaction(async () => 'result')
    await rollbackStarted.promise
    const next = query('SELECT 1')
    await Promise.resolve()
    expect(events).toEqual(['rollback'])

    releaseRollback.resolve()
    await expect(failed).rejects.toThrow('commit transport failed')
    await expect(next).resolves.toEqual([])
    expect(events).toEqual(['rollback', 'query'])
  })

  it('rolls back the browser transaction when the callback fails', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}

      if (url.endsWith('/api/db/transaction') && body.action === 'begin') {
        return jsonResponse({ transactionId: 'browser-tx-rollback' })
      }

      if (url.endsWith('/api/db/execute')) {
        expect(body.transactionId).toBe('browser-tx-rollback')
        return jsonResponse({ rowsAffected: 1, lastInsertId: 0 })
      }

      if (url.endsWith('/api/db/transaction') && body.action === 'rollback') {
        expect(body.transactionId).toBe('browser-tx-rollback')
        return jsonResponse({ ok: true, status: 'rolled_back' })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { withTransaction } = await import('@/lib/database')

    await expect(
      withTransaction(async (tx) => {
        await tx.execute('DELETE FROM transactions WHERE id = $1', ['tx-1'])
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:1480/api/db/transaction',
      'http://127.0.0.1:1480/api/db/execute',
      'http://127.0.0.1:1480/api/db/transaction',
    ])
  })

  it('keeps runInTransaction explicit-only in browser mode', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:1480')

    const { runInTransaction } = await import('@/lib/database')

    await expect(runInTransaction(async () => 'nope')).rejects.toThrow(
      'runInTransaction() is no longer supported.'
    )
  })
})

describe('database Tauri transactions', () => {
  it('routes desktop transaction operations through one Tauri transaction bridge', async () => {
    const { invoke } = mockTauriDatabaseModules()
    invoke.mockImplementation(async (command: string) => {
      if (command === 'shikin_db_tx_query') return [{ id: 'acct-1' }]
      if (command === 'shikin_db_tx_execute') return { rowsAffected: 1, lastInsertId: 0 }
      return undefined
    })

    const { withTransaction } = await import('@/lib/database')
    const result = await withTransaction(async (tx) => {
      const rows = await tx.query<{ id: string }>('SELECT id FROM accounts WHERE id = $1', [
        'acct-1',
      ])
      const write = await tx.execute('UPDATE accounts SET balance = $1 WHERE id = $2', [
        200,
        'acct-1',
      ])
      return { rows, write }
    })

    expect(result).toEqual({
      rows: [{ id: 'acct-1' }],
      write: { rowsAffected: 1, lastInsertId: 0 },
    })
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'initialize_runtime_identity',
      'shikin_db_tx_begin',
      'shikin_db_tx_query',
      'shikin_db_tx_execute',
      'shikin_db_tx_commit',
    ])
    expect(invoke.mock.calls[0][1]?.localInstanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    const transactionId = invoke.mock.calls[1][1]?.transactionId
    expect(transactionId).toMatch(/^shikin-tx-/)
    expect(invoke.mock.calls[2][1]).toEqual({
      statement: {
        transactionId,
        query: 'SELECT id FROM accounts WHERE id = $1',
        values: ['acct-1'],
      },
    })
    expect(invoke.mock.calls[4][1]).toEqual({ transactionId })
  })

  it('keeps the original desktop error when rollback also fails', async () => {
    const { invoke } = mockTauriDatabaseModules()
    invoke.mockImplementation(async (command: string) => {
      if (command === 'shikin_db_tx_execute') return { rowsAffected: 1, lastInsertId: 0 }
      if (command === 'shikin_db_tx_rollback') throw new Error('rollback failed')
      return undefined
    })

    const { withTransaction } = await import('@/lib/database')

    await expect(
      withTransaction(async (tx) => {
        await tx.execute('DELETE FROM transactions WHERE id = $1', ['tx-1'])
        throw new Error('original write failure')
      })
    ).rejects.toThrow('original write failure')

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'initialize_runtime_identity',
      'shikin_db_tx_begin',
      'shikin_db_tx_execute',
      'shikin_db_tx_rollback',
    ])
  })

  it('rolls back and preserves the commit error when desktop commit fails', async () => {
    const { invoke } = mockTauriDatabaseModules()
    invoke.mockImplementation(async (command: string) => {
      if (command === 'shikin_db_tx_execute') return { rowsAffected: 1, lastInsertId: 0 }
      if (command === 'shikin_db_tx_commit') throw new Error('commit failed')
      return undefined
    })

    const { withTransaction } = await import('@/lib/database')

    await expect(
      withTransaction(async (tx) => {
        await tx.execute('UPDATE accounts SET balance = balance + 1')
      })
    ).rejects.toThrow('commit failed')

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'initialize_runtime_identity',
      'shikin_db_tx_begin',
      'shikin_db_tx_execute',
      'shikin_db_tx_commit',
      'shikin_db_tx_rollback',
    ])
    const transactionId = invoke.mock.calls[1][1]?.transactionId
    expect(invoke.mock.calls[3][1]).toEqual({ transactionId })
    expect(invoke.mock.calls[4][1]).toEqual({ transactionId })
  })

  it('waits for a desktop transaction before running normal plugin queries', async () => {
    const { invoke, tauriDatabase } = mockTauriDatabaseModules()
    let releaseCommit: (() => void) | undefined
    invoke.mockImplementation(async (command: string) => {
      if (command === 'shikin_db_tx_execute') return { rowsAffected: 1, lastInsertId: 0 }
      if (command === 'shikin_db_tx_commit') {
        await new Promise<void>((resolve) => {
          releaseCommit = resolve
        })
      }
      return undefined
    })

    const { query, withTransaction } = await import('@/lib/database')
    const transaction = withTransaction(async (tx) => {
      await tx.execute('UPDATE accounts SET balance = balance + 1')
      return 'committed'
    })

    await vi.waitFor(() => {
      expect(invoke.mock.calls.map(([command]) => command)).toContain('shikin_db_tx_commit')
    })

    const outsideQuery = query('SELECT id FROM accounts')
    await Promise.resolve()
    expect(tauriDatabase.select).not.toHaveBeenCalledWith('SELECT id FROM accounts', [])

    releaseCommit?.()
    await expect(transaction).resolves.toBe('committed')
    await outsideQuery
    expect(tauriDatabase.select).toHaveBeenCalledWith('SELECT id FROM accounts', [])
  })

  it('rejects the legacy desktop runInTransaction helper', async () => {
    mockTauriDatabaseModules()

    const { runInTransaction } = await import('@/lib/database')

    await expect(runInTransaction(async () => 'nope')).rejects.toThrow(
      'Use withTransaction((tx) => ...)'
    )
  })
})
