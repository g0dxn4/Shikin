import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
}))

const mockLoad = vi.hoisted(() => vi.fn().mockResolvedValue(mockStore))

vi.mock('@/lib/storage', () => ({
  load: mockLoad,
}))

vi.mock('@/lib/oauth', () => ({
  refreshAccessToken: vi.fn(),
}))

vi.mock('@/lib/oauth-providers/google', () => ({
  createGoogleOAuthConfig: vi.fn(),
}))

vi.mock('@/lib/oauth-providers/openai-codex', () => ({
  createOpenAICodexOAuthConfig: vi.fn(),
}))

import { useAIStore } from '../ai-store'

describe('ai-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAIStore.setState({
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
    })
  })

  describe('defaults', () => {
    it('has correct initial state', () => {
      const state = useAIStore.getState()
      expect(state.provider).toBe('openai')
      expect(state.apiKey).toBe('')
      expect(state.model).toBe('')
      expect(state.isConfigured).toBe(false)
      expect(state.authMode).toBe('api_key')
      expect(state.oauthAccessToken).toBeNull()
    })
  })

  describe('loadSettings', () => {
    it('reads settings from Tauri store', async () => {
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'ai_provider') return 'anthropic'
        if (key === 'ai_api_key') return 'sk-test-123'
        if (key === 'ai_model') return 'claude-sonnet-4-20250514'
        return null
      })

      await useAIStore.getState().loadSettings()

      const state = useAIStore.getState()
      expect(state.provider).toBe('anthropic')
      expect(state.apiKey).toBe('sk-test-123')
      expect(state.model).toBe('claude-sonnet-4-20250514')
      expect(state.isConfigured).toBe(true)
    })

    it('reads OAuth settings', async () => {
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'ai_provider') return 'google'
        if (key === 'ai_auth_mode') return 'oauth'
        if (key === 'ai_oauth_access_token') return 'ya29.test-token'
        if (key === 'ai_oauth_refresh_token') return 'refresh-test'
        if (key === 'ai_oauth_expires_at') return Date.now() + 3600000
        if (key === 'ai_oauth_email') return 'user@gmail.com'
        if (key === 'ai_oauth_client_id') return 'test-client-id'
        return null
      })

      await useAIStore.getState().loadSettings()

      const state = useAIStore.getState()
      expect(state.provider).toBe('google')
      expect(state.authMode).toBe('oauth')
      expect(state.oauthAccessToken).toBe('ya29.test-token')
      expect(state.oauthEmail).toBe('user@gmail.com')
      expect(state.isConfigured).toBe(true)
    })

    it('uses defaults when keys are missing', async () => {
      mockStore.get.mockResolvedValue(null)

      await useAIStore.getState().loadSettings()

      const state = useAIStore.getState()
      expect(state.provider).toBe('openai')
      expect(state.apiKey).toBe('')
      expect(state.model).toBe('')
      expect(state.isConfigured).toBe(false)
    })

    it('silently catches errors', async () => {
      mockLoad.mockRejectedValueOnce(new Error('fail'))

      await useAIStore.getState().loadSettings()

      // State unchanged
      expect(useAIStore.getState().provider).toBe('openai')
    })
  })

  describe('saveSettings', () => {
    it('writes settings to Tauri store', async () => {
      await useAIStore.getState().saveSettings('anthropic', 'sk-key', 'claude-sonnet-4-20250514')

      expect(mockStore.set).toHaveBeenCalledWith('ai_provider', 'anthropic')
      expect(mockStore.set).toHaveBeenCalledWith('ai_api_key', 'sk-key')
      expect(mockStore.set).toHaveBeenCalledWith('ai_model', 'claude-sonnet-4-20250514')
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('sets isConfigured=true when apiKey is provided', async () => {
      await useAIStore.getState().saveSettings('openai', 'sk-key', 'gpt-4o')

      expect(useAIStore.getState().isConfigured).toBe(true)
    })

    it('sets isConfigured=false when apiKey is empty', async () => {
      await useAIStore.getState().saveSettings('openai', '', 'gpt-4o')

      expect(useAIStore.getState().isConfigured).toBe(false)
    })

    it('silently catches errors', async () => {
      mockLoad.mockRejectedValueOnce(new Error('fail'))

      await useAIStore.getState().saveSettings('openai', 'key', 'model')

      // State unchanged — save failed before set()
      expect(useAIStore.getState().provider).toBe('openai')
    })
  })

  describe('setOAuthTokens', () => {
    it('stores OAuth tokens and sets authMode to oauth', async () => {
      await useAIStore.getState().setOAuthTokens({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 3600,
        email: 'user@example.com',
      })

      const state = useAIStore.getState()
      expect(state.authMode).toBe('oauth')
      expect(state.oauthAccessToken).toBe('test-access-token')
      expect(state.oauthRefreshToken).toBe('test-refresh-token')
      expect(state.oauthEmail).toBe('user@example.com')
      expect(state.isConfigured).toBe(true)
      expect(mockStore.set).toHaveBeenCalledWith('ai_auth_mode', 'oauth')
      expect(mockStore.set).toHaveBeenCalledWith('ai_oauth_access_token', 'test-access-token')
    })
  })

  describe('clearOAuth', () => {
    it('resets OAuth state back to api_key mode', async () => {
      // First set OAuth state
      useAIStore.setState({
        authMode: 'oauth',
        oauthAccessToken: 'token',
        oauthEmail: 'user@test.com',
        isConfigured: true,
      })

      await useAIStore.getState().clearOAuth()

      const state = useAIStore.getState()
      expect(state.authMode).toBe('api_key')
      expect(state.oauthAccessToken).toBeNull()
      expect(state.oauthEmail).toBeNull()
      expect(mockStore.set).toHaveBeenCalledWith('ai_auth_mode', 'api_key')
    })
  })

  describe('getEffectiveApiKey', () => {
    it('returns apiKey in api_key mode', async () => {
      useAIStore.setState({ authMode: 'api_key', apiKey: 'sk-test' })

      const key = await useAIStore.getState().getEffectiveApiKey()
      expect(key).toBe('sk-test')
    })

    it('returns oauthAccessToken in oauth mode', async () => {
      useAIStore.setState({
        authMode: 'oauth',
        oauthAccessToken: 'oauth-token',
        oauthExpiresAt: Date.now() + 3600000, // 1 hour from now
      })

      const key = await useAIStore.getState().getEffectiveApiKey()
      expect(key).toBe('oauth-token')
    })
  })
})
