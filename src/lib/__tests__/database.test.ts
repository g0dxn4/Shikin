import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  ].map((name) => ({ name }))
  const columnRows = [
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
      if (sql === 'SELECT name FROM _migrations') return migrationRows
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
      'shikin_db_tx_begin',
      'shikin_db_tx_query',
      'shikin_db_tx_execute',
      'shikin_db_tx_commit',
    ])
    const transactionId = invoke.mock.calls[0][1]?.transactionId
    expect(transactionId).toMatch(/^shikin-tx-/)
    expect(invoke.mock.calls[1][1]).toEqual({
      statement: {
        transactionId,
        query: 'SELECT id FROM accounts WHERE id = $1',
        values: ['acct-1'],
      },
    })
    expect(invoke.mock.calls[3][1]).toEqual({ transactionId })
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
      'shikin_db_tx_begin',
      'shikin_db_tx_execute',
      'shikin_db_tx_commit',
      'shikin_db_tx_rollback',
    ])
    const transactionId = invoke.mock.calls[0][1]?.transactionId
    expect(invoke.mock.calls[2][1]).toEqual({ transactionId })
    expect(invoke.mock.calls[3][1]).toEqual({ transactionId })
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
