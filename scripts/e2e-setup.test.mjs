// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  assertLoopbackTarget,
  ensureTestMainCurrencyBaseline,
  resolveDataServerUrl,
  resolveE2eOrigin,
} from './e2e-setup.mjs'

const DATA_SERVER_URL = 'http://localhost:1480'
const ORIGIN = 'http://localhost:1420'
const QUERY_URL = `${DATA_SERVER_URL}/api/db/query`
const EXECUTE_URL = `${DATA_SERVER_URL}/api/db/execute`

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function connectionError(code) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
}

function createBridgeFetch({
  queryRows,
  queryStatus = 200,
  connectFailures = 0,
  failReadbackConnection = false,
} = {}) {
  const calls = []
  let queryIndex = 0

  const fetchImpl = vi.fn(async (url, init) => {
    const payload = init.body ? JSON.parse(init.body) : null
    calls.push({ url, payload, signal: init.signal })

    if (calls.length <= connectFailures) {
      throw connectionError('ECONNREFUSED')
    }

    if (url === QUERY_URL) {
      if (failReadbackConnection && queryIndex === 1) {
        queryIndex += 1
        throw connectionError('ECONNRESET')
      }
      if (queryStatus !== 200) {
        return jsonResponse({ error: 'query rejected' }, queryStatus)
      }
      const rows = queryRows[Math.min(queryIndex, queryRows.length - 1)] ?? []
      queryIndex += 1
      return jsonResponse(rows)
    }

    if (url === EXECUTE_URL) {
      return jsonResponse({ rowsAffected: 1, lastInsertId: 0 })
    }

    throw new Error(`Unexpected E2E bootstrap request: ${url}`)
  })

  return { fetchImpl, calls }
}

function baselineInput(fetchImpl) {
  return {
    dataServerUrl: DATA_SERVER_URL,
    origin: ORIGIN,
    bridgeToken: 'shikin-e2e-bridge-token',
    fetchImpl,
  }
}

describe('E2E main-currency baseline', () => {
  it('inserts USD when main_currency is absent and verifies the readback', async () => {
    const bridge = createBridgeFetch({ queryRows: [[], [{ value: 'USD' }]] })

    await expect(ensureTestMainCurrencyBaseline(baselineInput(bridge.fetchImpl))).resolves.toEqual({
      currency: 'USD',
      changed: true,
    })

    expect(bridge.calls.map((call) => call.url)).toEqual([QUERY_URL, EXECUTE_URL, QUERY_URL])
    expect(bridge.calls[0].payload).toEqual({
      sql: 'SELECT value FROM settings WHERE key = ?',
      params: ['main_currency'],
    })
    expect(bridge.calls[1].payload).toEqual({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?)',
      params: ['main_currency', 'USD'],
    })
    expect(bridge.calls[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('leaves an existing USD baseline untouched', async () => {
    const bridge = createBridgeFetch({ queryRows: [[{ value: 'USD' }]] })

    await expect(ensureTestMainCurrencyBaseline(baselineInput(bridge.fetchImpl))).resolves.toEqual({
      currency: 'USD',
      changed: false,
    })

    expect(bridge.calls).toHaveLength(1)
    expect(bridge.calls[0].url).toBe(QUERY_URL)
  })

  it('rejects an existing different currency without mutating it', async () => {
    const bridge = createBridgeFetch({ queryRows: [[{ value: 'MXN' }]] })

    await expect(ensureTestMainCurrencyBaseline(baselineInput(bridge.fetchImpl))).rejects.toThrow(
      /refusing to overwrite/i
    )

    expect(bridge.calls).toHaveLength(1)
    expect(bridge.calls[0].url).toBe(QUERY_URL)
  })

  it('fails immediately on an HTTP error without retrying', async () => {
    const bridge = createBridgeFetch({ queryRows: [[]], queryStatus: 500 })

    await expect(
      ensureTestMainCurrencyBaseline({
        ...baselineInput(bridge.fetchImpl),
        readinessTimeoutMs: 250,
        readinessPollMs: 5,
      })
    ).rejects.toThrow(/failed \(500\)/)

    expect(bridge.calls).toHaveLength(1)
  })

  it('waits out connection failures until the backend is ready', async () => {
    const bridge = createBridgeFetch({
      queryRows: [[], [{ value: 'USD' }]],
      connectFailures: 2,
    })

    await expect(
      ensureTestMainCurrencyBaseline({
        ...baselineInput(bridge.fetchImpl),
        readinessTimeoutMs: 500,
        readinessPollMs: 5,
      })
    ).resolves.toEqual({ currency: 'USD', changed: true })

    expect(bridge.calls.map((call) => call.url)).toEqual([
      QUERY_URL,
      QUERY_URL,
      QUERY_URL,
      EXECUTE_URL,
      QUERY_URL,
    ])
  })

  it('fails clearly when the backend stays unreachable past the deadline', async () => {
    const bridge = createBridgeFetch({
      queryRows: [[]],
      connectFailures: Number.MAX_SAFE_INTEGER,
    })

    await expect(
      ensureTestMainCurrencyBaseline({
        ...baselineInput(bridge.fetchImpl),
        readinessTimeoutMs: 20,
        readinessPollMs: 5,
      })
    ).rejects.toThrow(/ECONNREFUSED/)

    expect(bridge.calls.length).toBeGreaterThan(0)
  })

  it('fails when the readback does not confirm the insert and never retries the write', async () => {
    const bridge = createBridgeFetch({ queryRows: [[], [{ value: 'MXN' }]] })

    await expect(ensureTestMainCurrencyBaseline(baselineInput(bridge.fetchImpl))).rejects.toThrow(
      /readback returned MXN/
    )

    expect(bridge.calls.map((call) => call.url)).toEqual([QUERY_URL, EXECUTE_URL, QUERY_URL])
  })

  it('does not re-run the insert when the readback connection drops', async () => {
    const bridge = createBridgeFetch({ queryRows: [[]], failReadbackConnection: true })

    await expect(ensureTestMainCurrencyBaseline(baselineInput(bridge.fetchImpl))).rejects.toThrow(
      /ECONNRESET/
    )

    expect(bridge.calls.map((call) => call.url)).toEqual([QUERY_URL, EXECUTE_URL, QUERY_URL])
  })

  it('resolves the bridge target from explicit E2E environment and config', () => {
    expect(
      resolveDataServerUrl({
        VITE_DATA_SERVER_URL: 'http://127.0.0.1:53805/',
        SHIKIN_DATA_SERVER_PORT: '1481',
      })
    ).toBe('http://127.0.0.1:53805')
    expect(resolveDataServerUrl({ SHIKIN_DATA_SERVER_PORT: '1481' })).toBe('http://localhost:1481')
    expect(resolveDataServerUrl({})).toBe('http://localhost:1480')
    expect(
      resolveE2eOrigin({ projects: [{ use: { baseURL: 'http://localhost:1420' } }] }, {})
    ).toBe('http://localhost:1420')
    expect(resolveE2eOrigin(undefined, { SHIKIN_E2E_ORIGIN: 'http://127.0.0.1:53805' })).toBe(
      'http://127.0.0.1:53805'
    )
    expect(resolveE2eOrigin(undefined, {})).toBe('http://localhost:1420')
  })

  it('refuses non-loopback targets so fixture setup cannot reach a live server', () => {
    expect(() => assertLoopbackTarget('http://192.168.1.10:1480', 'E2E data server URL')).toThrow(
      /loopback/
    )
    expect(() => assertLoopbackTarget('not a url', 'E2E origin')).toThrow(/valid URL/)
  })
})
