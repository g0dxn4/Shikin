import { create } from 'zustand'
import { load } from '@/lib/storage'
import { refreshAccessToken } from '@/lib/oauth'
import type { OAuthConfig } from '@/lib/oauth'
import { createGoogleOAuthConfig } from '@/lib/oauth-providers/google'
import { createOpenAICodexOAuthConfig } from '@/lib/oauth-providers/openai-codex'

interface AIState {
  provider: string
  apiKey: string
  model: string
  isConfigured: boolean

  // OAuth state
  authMode: 'api_key' | 'oauth'
  oauthAccessToken: string | null
  oauthRefreshToken: string | null
  oauthExpiresAt: number | null
  oauthClientId: string
  oauthEmail: string | null
  codexAccountId: string | null

  // Actions
  loadSettings: () => Promise<void>
  saveSettings: (provider: string, apiKey: string, model: string) => Promise<void>
  setOAuthTokens: (tokens: {
    accessToken: string
    refreshToken?: string
    expiresIn: number
    email?: string
    codexAccountId?: string
  }) => Promise<void>
  setAuthMode: (mode: 'api_key' | 'oauth') => void
  setOAuthClientId: (clientId: string) => Promise<void>
  getEffectiveApiKey: () => Promise<string>
  clearOAuth: () => Promise<void>
}

function getOAuthConfig(provider: string, clientId: string): OAuthConfig | null {
  switch (provider) {
    case 'google':
      return clientId ? createGoogleOAuthConfig(clientId) : null
    case 'openai':
      return createOpenAICodexOAuthConfig()
    default:
      return null
  }
}

export const useAIStore = create<AIState>((set, get) => ({
  provider: 'openai',
  apiKey: '',
  model: '',
  isConfigured: false,

  authMode: 'api_key',
  oauthAccessToken: null,
  oauthRefreshToken: null,
  oauthExpiresAt: null,
  oauthClientId: '',
  oauthEmail: null,
  codexAccountId: null,

  loadSettings: async () => {
    try {
      const store = await load('settings.json')
      const provider = ((await store.get('ai_provider')) as string) || 'openai'
      const apiKey = ((await store.get('ai_api_key')) as string) || ''
      const model = ((await store.get('ai_model')) as string) || ''
      const authMode = ((await store.get('ai_auth_mode')) as 'api_key' | 'oauth') || 'api_key'
      const oauthAccessToken = ((await store.get('ai_oauth_access_token')) as string) || null
      const oauthRefreshToken = ((await store.get('ai_oauth_refresh_token')) as string) || null
      const oauthExpiresAt = ((await store.get('ai_oauth_expires_at')) as number) || null
      const oauthClientId = ((await store.get('ai_oauth_client_id')) as string) || ''
      const oauthEmail = ((await store.get('ai_oauth_email')) as string) || null
      const codexAccountId = ((await store.get('ai_codex_account_id')) as string) || null

      const isConfigured = authMode === 'oauth' ? !!oauthAccessToken : !!apiKey

      set({
        provider,
        apiKey,
        model,
        isConfigured,
        authMode,
        oauthAccessToken,
        oauthRefreshToken,
        oauthExpiresAt,
        oauthClientId,
        oauthEmail,
        codexAccountId,
      })
    } catch {
      // Store not available (e.g. in tests)
    }
  },

  saveSettings: async (provider, apiKey, model) => {
    try {
      const state = get()
      const store = await load('settings.json')
      await store.set('ai_provider', provider)
      await store.set('ai_api_key', apiKey)
      await store.set('ai_model', model)
      await store.save()
      const isConfigured = state.authMode === 'oauth' ? !!state.oauthAccessToken : !!apiKey
      set({ provider, apiKey, model, isConfigured })
    } catch {
      // Store not available
    }
  },

  setOAuthTokens: async (tokens) => {
    const expiresAt = Date.now() + tokens.expiresIn * 1000
    try {
      const store = await load('settings.json')
      await store.set('ai_auth_mode', 'oauth')
      await store.set('ai_oauth_access_token', tokens.accessToken)
      await store.set('ai_oauth_refresh_token', tokens.refreshToken ?? null)
      await store.set('ai_oauth_expires_at', expiresAt)
      if (tokens.email) await store.set('ai_oauth_email', tokens.email)
      if (tokens.codexAccountId) await store.set('ai_codex_account_id', tokens.codexAccountId)
      await store.save()
    } catch {
      // Store not available
    }
    set({
      authMode: 'oauth',
      oauthAccessToken: tokens.accessToken,
      oauthRefreshToken: tokens.refreshToken ?? null,
      oauthExpiresAt: expiresAt,
      oauthEmail: tokens.email ?? get().oauthEmail,
      codexAccountId: tokens.codexAccountId ?? get().codexAccountId,
      isConfigured: true,
    })
  },

  setAuthMode: (mode) => {
    set({ authMode: mode })
  },

  setOAuthClientId: async (clientId) => {
    try {
      const store = await load('settings.json')
      await store.set('ai_oauth_client_id', clientId)
      await store.save()
    } catch {
      // Store not available
    }
    set({ oauthClientId: clientId })
  },

  getEffectiveApiKey: async () => {
    const state = get()

    if (state.authMode === 'api_key') {
      return state.apiKey
    }

    // OAuth mode — check if token needs refresh (5-minute buffer)
    const REFRESH_BUFFER = 5 * 60 * 1000
    if (
      state.oauthExpiresAt &&
      state.oauthRefreshToken &&
      Date.now() > state.oauthExpiresAt - REFRESH_BUFFER
    ) {
      const config = getOAuthConfig(state.provider, state.oauthClientId)
      if (config) {
        try {
          const tokens = await refreshAccessToken(config, state.oauthRefreshToken)
          // Persist refreshed tokens
          const store = await load('settings.json')
          await store.set('ai_oauth_access_token', tokens.accessToken)
          await store.set('ai_oauth_refresh_token', tokens.refreshToken ?? state.oauthRefreshToken)
          await store.set('ai_oauth_expires_at', tokens.expiresAt)
          await store.save()

          set({
            oauthAccessToken: tokens.accessToken,
            oauthRefreshToken: tokens.refreshToken ?? state.oauthRefreshToken,
            oauthExpiresAt: tokens.expiresAt,
          })

          return tokens.accessToken
        } catch {
          // Refresh failed — clear OAuth state
          await get().clearOAuth()
          return ''
        }
      }
    }

    return state.oauthAccessToken || ''
  },

  clearOAuth: async () => {
    try {
      const store = await load('settings.json')
      await store.set('ai_auth_mode', 'api_key')
      await store.set('ai_oauth_access_token', null)
      await store.set('ai_oauth_refresh_token', null)
      await store.set('ai_oauth_expires_at', null)
      await store.set('ai_oauth_email', null)
      await store.set('ai_codex_account_id', null)
      await store.save()
    } catch {
      // Store not available
    }
    set({
      authMode: 'api_key',
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthExpiresAt: null,
      oauthEmail: null,
      codexAccountId: null,
      isConfigured: !!get().apiKey,
    })
  },
}))
