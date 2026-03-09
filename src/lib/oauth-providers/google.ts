import type { OAuthConfig } from '../oauth'

/**
 * Google OAuth for Gemini API access.
 * The user must provide their own OAuth Client ID from Google Cloud Console:
 * APIs & Services → Credentials → Create OAuth Client ID → Web Application
 * Add {origin}/oauth/callback as an authorized redirect URI.
 */
export function createGoogleOAuthConfig(clientId: string): OAuthConfig {
  return {
    providerId: 'google',
    clientId,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    redirectUri: `${window.location.origin}/oauth/callback`,
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  }
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.email ?? null
  } catch {
    return null
  }
}
