import { afterEach, describe, expect, it, vi } from 'vitest'

function getBridgeHeader(headers: HeadersInit | undefined): string | null {
  if (!headers) return null
  const normalized = new Headers(headers)
  return normalized.get('X-Shikin-Bridge')
}

function getCallInit(fetchMock: ReturnType<typeof vi.fn>, index: number): RequestInit {
  expect(fetchMock.mock.calls[index]).toBeDefined()
  return (fetchMock.mock.calls[index]?.[1] ?? {}) as RequestInit
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('browser bridge headers', () => {
  it('database browser requests include the per-run bridge token', async () => {
    vi.stubEnv('VITE_DATA_SERVER_BRIDGE_TOKEN', 'db-test-token')
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { query } = await import('@/lib/database')
    await query('SELECT 1')

    const requestInit = getCallInit(fetchMock, 0)
    expect(getBridgeHeader(requestInit.headers)).toBe('db-test-token')
  })

  it('storage browser requests include the per-run bridge token', async () => {
    vi.stubEnv('VITE_DATA_SERVER_BRIDGE_TOKEN', 'storage-test-token')
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:17890/')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/store/')) {
        if (init?.method === 'PUT') {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({ value: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { load } = await import('@/lib/storage')
    const store = await load()
    await store.get('test-key')
    await store.set('test-key', { ok: true })

    const getCallInitValue = getCallInit(fetchMock, 0)
    const putCallInitValue = getCallInit(fetchMock, 1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:17890/api/store/test-key')
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://127.0.0.1:17890/api/store/test-key')
    expect(getBridgeHeader(getCallInitValue.headers)).toBe('storage-test-token')
    expect(getBridgeHeader(putCallInitValue.headers)).toBe('storage-test-token')
  })

  it('virtual-fs browser requests include the per-run bridge token', async () => {
    vi.stubEnv('VITE_DATA_SERVER_BRIDGE_TOKEN', 'fs-test-token')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/fs/appdata')) {
        return new Response(JSON.stringify({ path: '/tmp/data' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/api/fs/write')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { appDataDir, writeTextFile } = await import('@/lib/virtual-fs')
    await appDataDir()
    await writeTextFile('/tmp/data/notes.md', '# note')

    const getCallInitValue = getCallInit(fetchMock, 0)
    const putCallInitValue = getCallInit(fetchMock, 1)
    expect(getBridgeHeader(getCallInitValue.headers)).toBe('fs-test-token')
    expect(getBridgeHeader(putCallInitValue.headers)).toBe('fs-test-token')
  })

  it('exportDatabaseSnapshot browser request includes the per-run bridge token', async () => {
    vi.stubEnv('VITE_DATA_SERVER_BRIDGE_TOKEN', 'db-export-test-token')

    const expectedSnapshot = new Uint8Array([1, 2, 3, 4])
    const fetchMock = vi.fn(
      async () =>
        new Response(expectedSnapshot, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { exportDatabaseSnapshot } = await import('@/lib/database')
    const snapshot = await exportDatabaseSnapshot()

    const requestInit = getCallInit(fetchMock, 0)
    expect(getBridgeHeader(requestInit.headers)).toBe('db-export-test-token')
    expect(snapshot).toEqual(expectedSnapshot)
  })

  it('importDatabaseSnapshot browser request includes the per-run bridge token', async () => {
    vi.stubEnv('VITE_DATA_SERVER_BRIDGE_TOKEN', 'db-import-test-token')

    const snapshot = new Uint8Array([4, 3, 2, 1])
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { importDatabaseSnapshot } = await import('@/lib/database')
    await importDatabaseSnapshot(snapshot)

    const requestInit = getCallInit(fetchMock, 0)
    expect(requestInit.method).toBe('POST')
    expect(getBridgeHeader(requestInit.headers)).toBe('db-import-test-token')
  })
})
