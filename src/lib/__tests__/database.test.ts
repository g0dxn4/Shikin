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
  vi.resetModules()
})

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
      'runInTransaction() is only supported in Tauri mode.'
    )
  })
})
