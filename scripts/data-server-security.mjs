import { isAbsolute, relative, resolve } from 'node:path'

export const BRIDGE_ALLOWED_ORIGIN = 'http://localhost:1420'
export const BRIDGE_HEADER_NAME = 'x-shikin-bridge'
export const BRIDGE_TOKEN_ENV = 'SHIKIN_DATA_SERVER_BRIDGE_TOKEN'
export const BRIDGE_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'originator',
  'X-Shikin-Bridge',
]

function hasAllowedOrigin(headers) {
  return headers?.origin === BRIDGE_ALLOWED_ORIGIN
}

export function getBridgeToken(env = process.env) {
  return env[BRIDGE_TOKEN_ENV] || ''
}

export function safePath(base, userPath) {
  if (typeof userPath !== 'string' || userPath.length === 0) {
    throw new Error('Path is required')
  }

  const resolvedBase = resolve(base)
  const resolvedPath = resolve(resolvedBase, userPath)
  const confinedPath = relative(resolvedBase, resolvedPath)

  if (confinedPath === '' || (!confinedPath.startsWith('..') && !isAbsolute(confinedPath))) {
    return resolvedPath
  }

  throw new Error('Path traversal detected')
}

export function validateBridgeRequest(req, expectedToken = getBridgeToken()) {
  if (!hasAllowedOrigin(req.headers)) {
    return `Forbidden origin. Expected ${BRIDGE_ALLOWED_ORIGIN}`
  }

  if (!expectedToken) {
    return 'Bridge token is not configured'
  }

  if (req.headers?.[BRIDGE_HEADER_NAME] !== expectedToken) {
    return 'Missing or invalid bridge header'
  }

  return null
}

export function validateBridgePreflight(req) {
  if (!hasAllowedOrigin(req.headers)) {
    return `Forbidden origin. Expected ${BRIDGE_ALLOWED_ORIGIN}`
  }

  const requestedHeaders = String(req.headers?.['access-control-request-headers'] || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)

  if (!requestedHeaders.includes(BRIDGE_HEADER_NAME)) {
    return 'Missing required bridge preflight header'
  }

  return null
}

export function buildBridgeCorsHeaders(extraHeaders = {}) {
  return {
    'Access-Control-Allow-Origin': BRIDGE_ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': BRIDGE_ALLOW_HEADERS.join(', '),
    Vary: 'Origin',
    ...extraHeaders,
  }
}
