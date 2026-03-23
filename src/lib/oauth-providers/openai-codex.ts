import { decodeJwtPayload } from '../oauth'

export const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const OPENAI_ISSUER = 'https://auth.openai.com'
export const OPENAI_OAUTH_PORT = 1455
export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

export interface OpenAIOAuthTokens {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  token_type?: string
}

// -- PKCE utilities --

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => chars[byte % chars.length]).join('')
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PkceCodes {
  verifier: string
  challenge: string
  state: string
}

export async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const challenge = await sha256Base64Url(verifier)
  const state = generateRandomString(32)
  return { verifier, challenge, state }
}

// -- Auth URL builder --

export function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state: pkce.state,
    originator: 'valute',
  })
  return `${OPENAI_ISSUER}/oauth/authorize?${params.toString()}`
}

// -- Token exchange --

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes
): Promise<OpenAIOAuthTokens> {
  const res = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: OPENAI_CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  return res.json()
}

// -- Token refresh --

export async function refreshOpenAIToken(refreshToken: string): Promise<OpenAIOAuthTokens> {
  const res = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OPENAI_CLIENT_ID,
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }

  return res.json()
}

// -- Account ID extraction --

/** Extract ChatGPT account ID from id_token or access_token JWT */
export function extractAccountId(token: string): string | null {
  const payload = decodeJwtPayload(token)
  if (!payload) return null

  // Direct field
  if (typeof payload.chatgpt_account_id === 'string') return payload.chatgpt_account_id

  // From organizations array (id_token_add_organizations=true)
  const orgs = payload.organizations as Array<Record<string, unknown>> | undefined
  if (Array.isArray(orgs) && orgs.length > 0) {
    return (orgs[0].id as string) ?? null
  }

  // Legacy: auth claim in access token
  const authClaim = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined
  return (authClaim?.account_id as string) ?? (authClaim?.org_id as string) ?? null
}

/** Build headers required for ChatGPT API requests */
export function buildCodexHeaders(
  accessToken: string,
  accountId: string
): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    'chatgpt-account-id': accountId,
    'originator': 'valute',
  }
}
