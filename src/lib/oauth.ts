/**
 * Generic OAuth 2.0 Authorization Code + PKCE flow for browser apps.
 * Uses window.crypto.subtle — no external dependencies.
 */

export interface OAuthConfig {
  providerId: string
  clientId: string
  clientSecret?: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  redirectUri: string
  extraAuthParams?: Record<string, string>
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number // epoch ms
  tokenType: string
}

// --- PKCE utilities ---

export function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}

export function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- OAuth Flow ---

interface PkceState {
  verifier: string
  state: string
  returnUrl?: string
}

function storePkceState(providerId: string, state: PkceState) {
  sessionStorage.setItem(`oauth_${providerId}`, JSON.stringify(state))
}

export function loadPkceState(providerId: string): PkceState | null {
  const raw = sessionStorage.getItem(`oauth_${providerId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function clearPkceState(providerId: string) {
  sessionStorage.removeItem(`oauth_${providerId}`)
}

export async function startOAuthFlow(
  config: OAuthConfig
): Promise<{ code: string; state: string; verifier: string }> {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateState()

  storePkceState(config.providerId, { verifier, state })

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...config.extraAuthParams,
  })

  const authUrl = `${config.authUrl}?${params.toString()}`

  return new Promise((resolve, reject) => {
    // Try popup
    const width = 800
    const height = 600
    const left = Math.round(window.screenX + (window.outerWidth - width) / 2)
    const top = Math.round(window.screenY + (window.outerHeight - height) / 2)

    const popup = window.open(
      authUrl,
      'oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`
    )

    if (!popup) {
      // Popup blocked — fall back to same-window redirect
      storePkceState(config.providerId, { verifier, state, returnUrl: window.location.href })
      window.location.href = authUrl
      // Will never resolve — page navigates away
      return
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'oauth_callback') return

      window.removeEventListener('message', handleMessage)
      clearInterval(pollTimer)

      const { code, state: returnedState } = event.data
      if (returnedState !== state) {
        clearPkceState(config.providerId)
        reject(new Error('OAuth state mismatch — possible CSRF attack'))
        return
      }

      if (!code) {
        clearPkceState(config.providerId)
        reject(new Error('No authorization code received'))
        return
      }

      resolve({ code, state: returnedState, verifier })
    }

    window.addEventListener('message', handleMessage)

    // Poll in case popup closes without posting message
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer)
        window.removeEventListener('message', handleMessage)
        clearPkceState(config.providerId)
        reject(new Error('OAuth popup was closed'))
      }
    }, 500)
  })
}

export async function exchangeCodeForToken(
  config: OAuthConfig,
  code: string,
  verifier: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  })

  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret)
  }

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type ?? 'Bearer',
  }
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  })

  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret)
  }

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }

  const data = await res.json()

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type ?? 'Bearer',
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    // base64url → base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    return null
  }
}
