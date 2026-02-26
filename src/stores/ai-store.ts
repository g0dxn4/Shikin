import { create } from 'zustand'
import { load } from '@tauri-apps/plugin-store'

interface AIState {
  provider: string
  apiKey: string
  model: string
  isConfigured: boolean
  loadSettings: () => Promise<void>
  saveSettings: (provider: string, apiKey: string, model: string) => Promise<void>
}

export const useAIStore = create<AIState>((set) => ({
  provider: 'openai',
  apiKey: '',
  model: '',
  isConfigured: false,

  loadSettings: async () => {
    try {
      const store = await load('settings.json')
      const provider = ((await store.get('ai_provider')) as string) || 'openai'
      const apiKey = ((await store.get('ai_api_key')) as string) || ''
      const model = ((await store.get('ai_model')) as string) || ''
      set({
        provider,
        apiKey,
        model,
        isConfigured: !!apiKey,
      })
    } catch {
      // Store not available (e.g. in tests)
    }
  },

  saveSettings: async (provider, apiKey, model) => {
    try {
      const store = await load('settings.json')
      await store.set('ai_provider', provider)
      await store.set('ai_api_key', apiKey)
      await store.set('ai_model', model)
      await store.save()
      set({ provider, apiKey, model, isConfigured: !!apiKey })
    } catch {
      // Store not available
    }
  },
}))
