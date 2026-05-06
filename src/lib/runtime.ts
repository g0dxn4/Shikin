export const isTauri =
  typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)

const configuredDataServerUrl = import.meta.env.VITE_DATA_SERVER_URL?.trim()

export const DATA_SERVER_URL = configuredDataServerUrl
  ? configuredDataServerUrl.replace(/\/+$/, '')
  : 'http://localhost:1480'
const DATA_SERVER_BRIDGE_HEADER = 'X-Shikin-Bridge'
const DATA_SERVER_BRIDGE_TOKEN = import.meta.env.VITE_DATA_SERVER_BRIDGE_TOKEN || ''

export function withDataServerHeaders(headers?: HeadersInit): Headers {
  const bridgeHeaders = new Headers(headers)
  bridgeHeaders.set(DATA_SERVER_BRIDGE_HEADER, DATA_SERVER_BRIDGE_TOKEN)
  return bridgeHeaders
}
