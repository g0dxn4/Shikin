import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('browser storage bridge failures', () => {
  it('throws a descriptive error when the browser bridge is unreachable during reads', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:19999')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connect ECONNREFUSED')))
    )

    const { load } = await import('@/lib/storage')
    const store = await load()

    await expect(store.get('theme')).rejects.toThrow(
      'Cannot reach data server at http://127.0.0.1:19999 while reading storage key "theme".'
    )
  })

  it('throws on non-ok browser bridge writes instead of silently dropping them', async () => {
    vi.stubEnv('VITE_DATA_SERVER_URL', 'http://127.0.0.1:17777')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('write failed', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
      )
    )

    const { load } = await import('@/lib/storage')
    const store = await load()

    await expect(store.set('theme', 'night')).rejects.toThrow(
      'Storage request failed (503) while writing storage key "theme": write failed'
    )
  })
})
