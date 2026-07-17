import { lstatSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export const BRIDGE_ALLOWED_ORIGIN = 'http://localhost:1420'
export const BRIDGE_HEADER_NAME = 'x-shikin-bridge'
const BRIDGE_TOKEN_ENV = 'SHIKIN_DATA_SERVER_BRIDGE_TOKEN'
const BRIDGE_ALLOW_HEADERS = ['Content-Type', 'Authorization', 'originator', 'X-Shikin-Bridge']

function hasAllowedOrigin(headers) {
  return headers?.origin === BRIDGE_ALLOWED_ORIGIN
}

function getHeaderValue(headers, name) {
  const value = headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function getHostedRequestHosts(headers) {
  return [getHeaderValue(headers, 'host'), getHeaderValue(headers, 'x-forwarded-host')]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function isMutationMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase())
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

export function safePathNoSymlinks(base, userPath, { allowMissing = false } = {}) {
  const resolvedBase = resolve(base)
  const resolvedPath = safePath(resolvedBase, userPath)

  const baseStats = lstatSync(resolvedBase)
  if (baseStats.isSymbolicLink() || !baseStats.isDirectory()) {
    throw new Error('App data directory is not a safe directory')
  }

  const confinedPath = relative(resolvedBase, resolvedPath)
  if (!confinedPath) return resolvedPath

  let currentPath = resolvedBase
  for (const segment of confinedPath.split(/[\\/]+/)) {
    currentPath = resolve(currentPath, segment)
    try {
      const stats = lstatSync(currentPath)
      if (stats.isSymbolicLink()) {
        throw new Error('Path symlink detected')
      }
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissing) {
        break
      }
      throw error
    }
  }

  return resolvedPath
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

/**
 * Hosted mode is reached only through a loopback reverse proxy. A supplied
 * Origin must still name the same public host the proxy received so a page on
 * another site cannot issue state-changing requests on a user's tailnet.
 */
export function validateHostedRequest(req) {
  const origin = getHeaderValue(req.headers, 'origin')
  const mutation = isMutationMethod(req.method)

  if (!origin) {
    return mutation ? 'Missing Origin header for hosted mutation request' : null
  }

  let originHost
  try {
    const originUrl = new URL(origin)
    if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.pathname !== '/') {
      throw new Error('invalid origin')
    }
    originHost = originUrl.host.toLowerCase()
  } catch {
    return 'Invalid Origin header'
  }

  const requestHosts = getHostedRequestHosts(req.headers)
  if (!requestHosts.includes(originHost)) {
    return 'Forbidden origin. Origin host must match Host or X-Forwarded-Host'
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
