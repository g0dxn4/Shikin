type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'openrouter'

export interface ModelInfo {
  id: string
  name: string
}

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4' },
]

export async function fetchModels(provider: AIProvider, apiKey: string): Promise<ModelInfo[]> {
  switch (provider) {
    case 'openrouter':
      return fetchOpenRouterModels(apiKey)
    case 'openai':
      return fetchOpenAIModels(apiKey)
    case 'anthropic':
      return ANTHROPIC_MODELS
    case 'ollama':
      return fetchOllamaModels()
    default:
      return []
  }
}

async function fetchOpenRouterModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`)
  const data = await res.json()

  return (data.data as Array<{ id: string; name: string }>)
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  if (!apiKey) return []
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
  const data = await res.json()

  const chatPrefixes = ['gpt-4', 'gpt-3.5', 'o1', 'o3', 'o4']
  return (data.data as Array<{ id: string }>)
    .filter((m) => chatPrefixes.some((p) => m.id.startsWith(p)))
    .map((m) => ({ id: m.id, name: m.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchOllamaModels(): Promise<ModelInfo[]> {
  const res = await fetch('http://localhost:11434/api/tags')
  if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
  const data = await res.json()

  return (data.models as Array<{ name: string }>)
    .map((m) => ({ id: m.name, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
