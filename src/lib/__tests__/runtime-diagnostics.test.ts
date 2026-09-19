import { afterEach, describe, expect, it, vi } from 'vitest'

const diagnostics = {
  success: true,
  build: 'desktop',
  version: '1.0.10',
  schemaVersion: 21,
  schemaMigration: '021_backend_remediation_foundation',
  databaseLineageId: 'opaque-lineage',
  localInstance: { status: 'available', id: '11111111-1111-4111-8111-111111111111' },
  dataRevision: 7,
  lastFinancialWriteAt: '2025-01-01T00:00:00.000Z',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.doUnmock('@/lib/runtime')
  vi.doUnmock('@tauri-apps/api/core')
})

describe('frontend runtime diagnostics service', () => {
  it('uses the native read-only command without initializing the JS database', async () => {
    const invoke = vi.fn(async () => diagnostics)
    vi.doMock('@/lib/runtime', () => ({
      isTauri: true,
      DATA_SERVER_URL: 'http://127.0.0.1:1',
      withDataServerHeaders: (headers?: HeadersInit) => new Headers(headers),
    }))
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    const { getRuntimeDiagnostics } = await import('@/lib/runtime-diagnostics')
    await expect(getRuntimeDiagnostics()).resolves.toEqual(diagnostics)
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('read_runtime_diagnostics')
  })

  it('uses the protected hosted endpoint and accepts unavailable identity honestly', async () => {
    const hosted = {
      ...diagnostics,
      build: 'hosted-web',
      localInstance: { status: 'unavailable', reason: 'invalid' },
    }
    const fetch = vi.fn(async () => new Response(JSON.stringify(hosted), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    vi.doMock('@/lib/runtime', () => ({
      isTauri: false,
      DATA_SERVER_URL: 'http://127.0.0.1:7777',
      withDataServerHeaders: () => new Headers({ 'X-Shikin-Bridge': 'test-token' }),
    }))

    const { getRuntimeDiagnostics } = await import('@/lib/runtime-diagnostics')
    await expect(getRuntimeDiagnostics()).resolves.toEqual(hosted)
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:7777/api/runtime/diagnostics', {
      method: 'GET',
      headers: expect.any(Headers),
    })
  })

  it('rejects malformed responses instead of fabricating identity metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...diagnostics, localInstance: null })))
    )
    vi.doMock('@/lib/runtime', () => ({
      isTauri: false,
      DATA_SERVER_URL: 'http://127.0.0.1:7777',
      withDataServerHeaders: () => new Headers(),
    }))

    const { getRuntimeDiagnostics } = await import('@/lib/runtime-diagnostics')
    await expect(getRuntimeDiagnostics()).rejects.toThrow(/response is invalid/i)
  })
})
