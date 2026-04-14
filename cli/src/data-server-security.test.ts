// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  BRIDGE_ALLOWED_ORIGIN,
  BRIDGE_HEADER_NAME,
  getBridgeToken,
  safePath,
  validateBridgePreflight,
  validateBridgeRequest,
} from '../../scripts/data-server-security.mjs'

function createRequest(headers: Record<string, string> = {}) {
  return { headers }
}

describe('data server security helpers', () => {
  it('confines paths using path.relative instead of prefix matching', () => {
    expect(safePath('/tmp/shikin/data', 'notebook/entry.md')).toBe(
      '/tmp/shikin/data/notebook/entry.md'
    )
    expect(() => safePath('/tmp/shikin/data', '../data-evil/secrets.txt')).toThrow(
      'Path traversal detected'
    )
    expect(() => safePath('/tmp/shikin/data', '/etc/passwd')).toThrow('Path traversal detected')
  })

  it('accepts only the expected bridge request origin and header', () => {
    const token = 'test-bridge-token'

    expect(getBridgeToken({ SHIKIN_DATA_SERVER_BRIDGE_TOKEN: token })).toBe(token)
    expect(
      validateBridgeRequest(
        createRequest({
          origin: BRIDGE_ALLOWED_ORIGIN,
          [BRIDGE_HEADER_NAME]: token,
        }),
        token
      )
    ).toBeNull()

    expect(validateBridgeRequest(createRequest({ origin: BRIDGE_ALLOWED_ORIGIN }), token)).toBe(
      'Missing or invalid bridge header'
    )
    expect(
      validateBridgeRequest(
        createRequest({
          origin: 'http://evil.example',
          [BRIDGE_HEADER_NAME]: token,
        }),
        token
      )
    ).toContain('Forbidden origin')
  })

  it('requires the bridge header during CORS preflight', () => {
    expect(
      validateBridgePreflight(
        createRequest({
          origin: BRIDGE_ALLOWED_ORIGIN,
          'access-control-request-headers': 'content-type, x-shikin-bridge',
        })
      )
    ).toBeNull()

    expect(
      validateBridgePreflight(
        createRequest({
          origin: BRIDGE_ALLOWED_ORIGIN,
          'access-control-request-headers': 'content-type',
        })
      )
    ).toBe('Missing required bridge preflight header')
  })
})
