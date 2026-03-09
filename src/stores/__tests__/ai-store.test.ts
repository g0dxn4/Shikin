import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
}))

const mockLoad = vi.hoisted(() => vi.fn().mockResolvedValue(mockStore))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: mockLoad,
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
    })
  })

  describe('defaults', () => {
    it('has correct initial state', () => {
      const state = useAIStore.getState()
      expect(state.provider).toBe('openai')
      expect(state.apiKey).toBe('')
      expect(state.model).toBe('')
      expect(state.isConfigured).toBe(false)
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
})
