interface BridgeRequestLike {
  headers?: Record<string, string | string[] | undefined>
}

export const BRIDGE_ALLOWED_ORIGIN: string
export const BRIDGE_HEADER_NAME: string
export const BRIDGE_TOKEN_ENV: string
export const BRIDGE_ALLOW_HEADERS: string[]
export function getBridgeToken(env?: Record<string, string | undefined>): string
export function safePath(base: string, userPath: string): string
export function validateBridgeRequest(req: BridgeRequestLike, expectedToken?: string): string | null
export function validateBridgePreflight(req: BridgeRequestLike): string | null
export function buildBridgeCorsHeaders(extraHeaders?: Record<string, string>): Record<string, string>
