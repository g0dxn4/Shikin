import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('virtual-fs browser bridge response checking', () => {
  const DATA_SERVER_URL = 'http://127.0.0.1:1480'

  beforeEach(() => {
    vi.stubEnv('VITE_DATA_SERVER_URL', DATA_SERVER_URL)
    vi.stubEnv('VITE_DATA_SERVER_BRIDGE_TOKEN', 'test-token')
  })

  describe('writeTextFile', () => {
    it('throws error when browser bridge returns non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('write failed: disk full', {
              status: 507,
              statusText: 'Insufficient Storage',
            })
        )
      )

      const { writeTextFile } = await import('@/lib/virtual-fs')

      await expect(writeTextFile('/test/file.txt', 'content')).rejects.toThrow(
        'Failed to write file: 507 write failed: disk full'
      )
    })

    it('resolves when browser bridge returns ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('{}', {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
        )
      )

      const { writeTextFile } = await import('@/lib/virtual-fs')

      await expect(writeTextFile('/test/file.txt', 'content')).resolves.toBeUndefined()
    })
  })

  describe('mkdir', () => {
    it('throws error when browser bridge returns non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('mkdir failed: permission denied', {
              status: 403,
              statusText: 'Forbidden',
            })
        )
      )

      const { mkdir } = await import('@/lib/virtual-fs')

      await expect(mkdir('/test/dir')).rejects.toThrow(
        'Failed to create directory: 403 mkdir failed: permission denied'
      )
    })

    it('resolves when browser bridge returns ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('{}', {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
        )
      )

      const { mkdir } = await import('@/lib/virtual-fs')

      await expect(mkdir('/test/dir')).resolves.toBeUndefined()
    })
  })

  describe('remove', () => {
    it('throws error when browser bridge returns non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('remove failed: file not found', {
              status: 404,
              statusText: 'Not Found',
            })
        )
      )

      const { remove } = await import('@/lib/virtual-fs')

      await expect(remove('/test/file.txt')).rejects.toThrow(
        'Failed to remove file: 404 remove failed: file not found'
      )
    })

    it('resolves when browser bridge returns ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(null, {
              status: 204,
            })
        )
      )

      const { remove } = await import('@/lib/virtual-fs')

      await expect(remove('/test/file.txt')).resolves.toBeUndefined()
    })
  })

  describe('error message handling', () => {
    it('uses "Unknown error" when response body cannot be read', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          return {
            ok: false,
            status: 500,
            text: vi.fn().mockRejectedValue(new Error('read error')),
          } as unknown as Response
        })
      )

      const { writeTextFile } = await import('@/lib/virtual-fs')

      await expect(writeTextFile('/test/file.txt', 'content')).rejects.toThrow(
        'Failed to write file: 500 Unknown error'
      )
    })
  })
})
