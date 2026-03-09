import type { OAuthConfig } from '../oauth'
import { decodeJwtPayload } from '../oauth'

export function createOpenAICodexOAuthConfig(): OAuthConfig {
  return {
    providerId: 'openai',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    redirectUri: `${window.location.origin}/oauth/callback`,
  }
}

/** Extract the ChatGPT account ID from the JWT access token */
export function extractAccountId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken)
  if (!payload) return null
  const authClaim = payload['https://api.openai.com/auth'] as
    | Record<string, unknown>
    | undefined
  return (
    (authClaim?.account_id as string) ??
    (authClaim?.org_id as string) ??
    null
  )
}

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

/** Build headers required for Codex API requests */
export function buildCodexHeaders(
  accessToken: string,
  accountId: string
): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    'chatgpt-account-id': accountId,
    'originator': 'codex_cli_rs',
  }
}
