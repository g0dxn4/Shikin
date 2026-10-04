/**
 * Test-only E2E baseline setup for the disposable browser-suite server.
 *
 * `playwright.config.ts` starts `pnpm dev:e2e`, an isolated temporary data
 * server. Existing specs expect a USD main currency to already be configured
 * (budget amount labels, dashboard metrics, goal dialog, gain-layout fixture),
 * so this global setup seeds that single settings row through the same HTTP
 * bridge the specs use, once, before any test runs.
 *
 * This is fixture initialization, not a product currency fallback: it refuses
 * non-loopback targets, never overwrites an existing different value, and
 * bounds the initial backend-readiness wait to connection-level failures.
 */

export const E2E_TEST_MAIN_CURRENCY = 'USD'
export const E2E_TEST_BRIDGE_TOKEN = 'shikin-e2e-bridge-token'
export const E2E_DEFAULT_DATA_SERVER_PORT = '1480'
export const E2E_DEFAULT_ORIGIN = 'http://localhost:1420'
export const E2E_REQUEST_TIMEOUT_MS = 10_000
export const E2E_READINESS_TIMEOUT_MS = 30_000
export const E2E_READINESS_POLL_MS = 250

const MAIN_CURRENCY_KEY = 'main_currency'
const MAIN_CURRENCY_SELECT_SQL = 'SELECT value FROM settings WHERE key = ?'
const MAIN_CURRENCY_INSERT_SQL = 'INSERT INTO settings (key, value) VALUES (?, ?)'
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A fetch that never reached an HTTP response; safe to retry while waiting for the server. */
class BridgeConnectionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BridgeConnectionError'
  }
}

export function resolveDataServerUrl(env = process.env) {
  const configured = env.VITE_DATA_SERVER_URL || env.SHIKIN_DATA_SERVER_URL
  if (configured) return configured.replace(/\/+$/, '')
  return `http://localhost:${env.SHIKIN_DATA_SERVER_PORT || E2E_DEFAULT_DATA_SERVER_PORT}`
}

export function resolveE2eOrigin(config, env = process.env) {
  const configured = env.SHIKIN_E2E_ORIGIN
  if (configured) return configured.replace(/\/+$/, '')

  const baseURL = config?.projects?.[0]?.use?.baseURL
  if (typeof baseURL === 'string' && baseURL.length > 0) {
    return baseURL.replace(/\/+$/, '')
  }

  return E2E_DEFAULT_ORIGIN
}

export function assertLoopbackTarget(rawUrl, label = 'E2E target') {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`${label} must be a valid URL, received: ${rawUrl}`)
  }

  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(`${label} must stay on loopback for test setup, received: ${rawUrl}`)
  }

  return url
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
}

function errorDetail(error, depth = 0) {
  if (!error || typeof error !== 'object' || depth > 3) return []

  const parts = []
  if (typeof error.message === 'string' && error.message) parts.push(error.message)
  if (typeof error.code === 'string') parts.push(error.code)
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    parts.push(...errorDetail(error.errors[0], depth + 1))
  }
  if (error.cause) parts.push(...errorDetail(error.cause, depth + 1))
  return parts
}

async function postBridgeJson(fetchImpl, url, { headers, body, timeoutMs }) {
  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const detail = [...new Set(errorDetail(error))].join(': ') || String(error)
    const message = `E2E bootstrap request to ${url} failed: ${detail}`
    throw isAbortError(error) ? new Error(message) : new BridgeConnectionError(message)
  }

  if (!response?.ok) {
    const status = response?.status ?? 'unknown'
    const detail = typeof response?.text === 'function' ? await response.text().catch(() => '') : ''
    throw new Error(`E2E bootstrap request to ${url} failed (${status}): ${detail}`)
  }

  try {
    return await response.json()
  } catch {
    throw new Error(`E2E bootstrap request to ${url} returned invalid JSON`)
  }
}

async function readMainCurrencyRows({ dataServerUrl, headers, fetchImpl, timeoutMs }) {
  const rows = await postBridgeJson(fetchImpl, `${dataServerUrl}/api/db/query`, {
    headers,
    timeoutMs,
    body: { sql: MAIN_CURRENCY_SELECT_SQL, params: [MAIN_CURRENCY_KEY] },
  })

  if (!Array.isArray(rows)) {
    throw new Error('E2E main_currency query returned a non-array payload')
  }
  if (rows.length > 1) {
    throw new Error(`E2E main_currency query returned ${rows.length} rows for one settings key`)
  }
  if (rows.length === 1) {
    const value = rows[0]?.value
    if (typeof value !== 'string') {
      throw new Error('E2E main_currency query returned a row without a string value')
    }
    return value
  }
  return null
}

/**
 * The configured webServer only probes the Vite port; the backend may listen
 * slightly later. Retry the initial read on connection-level failures only,
 * until the deadline, then surface the failure. HTTP/SQL failures and every
 * mutation are never retried.
 */
async function readMainCurrencyWhenReady(options, { readinessTimeoutMs, readinessPollMs }) {
  const deadline = Date.now() + readinessTimeoutMs

  for (;;) {
    try {
      return await readMainCurrencyRows(options)
    } catch (error) {
      if (!(error instanceof BridgeConnectionError) || Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, readinessPollMs))
    }
  }
}

export async function ensureTestMainCurrencyBaseline({
  dataServerUrl,
  origin,
  bridgeToken,
  currency = E2E_TEST_MAIN_CURRENCY,
  fetchImpl = globalThis.fetch,
  timeoutMs = E2E_REQUEST_TIMEOUT_MS,
  readinessTimeoutMs = E2E_READINESS_TIMEOUT_MS,
  readinessPollMs = E2E_READINESS_POLL_MS,
}) {
  assertLoopbackTarget(dataServerUrl, 'E2E data server URL')
  assertLoopbackTarget(origin, 'E2E origin')

  if (typeof fetchImpl !== 'function') {
    throw new Error('E2E bootstrap requires a fetch implementation')
  }
  if (typeof bridgeToken !== 'string' || bridgeToken.length === 0) {
    throw new Error('E2E bootstrap requires a data server bridge token')
  }

  const headers = {
    'Content-Type': 'application/json',
    Origin: origin,
    'X-Shikin-Bridge': bridgeToken,
  }
  const requestOptions = { dataServerUrl, headers, fetchImpl, timeoutMs }

  const current = await readMainCurrencyWhenReady(requestOptions, {
    readinessTimeoutMs,
    readinessPollMs,
  })

  if (current === currency) return { currency, changed: false }
  if (current !== null) {
    throw new Error(
      `E2E bootstrap requires existing ${currency} main currency, found ${current}; refusing to overwrite the ephemeral test database`
    )
  }

  await postBridgeJson(fetchImpl, `${dataServerUrl}/api/db/execute`, {
    headers,
    timeoutMs,
    body: { sql: MAIN_CURRENCY_INSERT_SQL, params: [MAIN_CURRENCY_KEY, currency] },
  })

  const readback = await readMainCurrencyRows(requestOptions)
  if (readback !== currency) {
    throw new Error(
      `E2E bootstrap inserted ${currency} main currency but readback returned ${readback ?? 'unset'}`
    )
  }

  return { currency, changed: true }
}

export default async function globalSetup(config) {
  const dataServerUrl = resolveDataServerUrl()
  const origin = resolveE2eOrigin(config)
  const bridgeToken = process.env.SHIKIN_DATA_SERVER_BRIDGE_TOKEN || E2E_TEST_BRIDGE_TOKEN

  const { currency, changed } = await ensureTestMainCurrencyBaseline({
    dataServerUrl,
    origin,
    bridgeToken,
  })

  console.log(
    `[e2e-setup] main_currency=${currency} ${changed ? 'inserted as explicit test baseline' : 'already configured'} via ${dataServerUrl}`
  )
}
