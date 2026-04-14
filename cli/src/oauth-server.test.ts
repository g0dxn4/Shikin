// @vitest-environment node
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'

import { createOauthServer, renderErrorHtml } from '../../scripts/oauth-server.mjs'

describe('oauth-server escaping', () => {
  it('escapes reflected OAuth error text in rendered HTML', () => {
    const payload = `<img src=x onerror=alert('xss')>`
    const html = renderErrorHtml(payload)

    expect(html).toContain('&lt;img src=x onerror=alert(&#39;xss&#39;)&gt;')
    expect(html).not.toContain(payload)
  })

  it('redirects successful callbacks and returns safe HTML for OAuth errors', async () => {
    const server = createOauthServer()

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Unable to determine oauth test server address')
    }

    try {
      const successResponse = await fetch(
        `http://127.0.0.1:${address.port}/auth/callback?code=test-code&state=test-state`,
        { redirect: 'manual' }
      )

      expect(successResponse.status).toBe(302)
      expect(successResponse.headers.get('location')).toBe(
        'http://localhost:1420/auth/callback?code=test-code&state=test-state'
      )

      const errorResponse = await fetch(
        `http://127.0.0.1:${address.port}/auth/callback?error=access_denied&error_description=${encodeURIComponent('<script>alert(1)</script>')}`,
        { redirect: 'manual' }
      )
      const errorHtml = await errorResponse.text()

      expect(errorResponse.status).toBe(400)
      expect(errorHtml).toContain('Authorization failed')
      expect(errorHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(errorHtml).not.toContain('<script>alert(1)</script>')
    } finally {
      server.close()
      await delay(0)
    }
  })
})
