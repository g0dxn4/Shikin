import type { AIProvider } from './agent'

export interface ModelInfo {
  id: string
  name: string
}

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4' },
]

const GOOGLE_MODELS: ModelInfo[] = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
]

const MISTRAL_MODELS: ModelInfo[] = [
  { id: 'mistral-large-latest', name: 'Mistral Large' },
  { id: 'mistral-medium-latest', name: 'Mistral Medium' },
  { id: 'mistral-small-latest', name: 'Mistral Small' },
  { id: 'codestral-latest', name: 'Codestral' },
]

const XAI_MODELS: ModelInfo[] = [
  { id: 'grok-3', name: 'Grok 3' },
  { id: 'grok-3-mini', name: 'Grok 3 Mini' },
  { id: 'grok-2', name: 'Grok 2' },
]

const GROQ_MODELS: ModelInfo[] = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
]

const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek-V3' },
  { id: 'deepseek-reasoner', name: 'DeepSeek-R1' },
]

export async function fetchModels(provider: AIProvider, apiKey: string): Promise<ModelInfo[]> {
  switch (provider) {
    case 'openrouter':
      return fetchOpenRouterModels(apiKey)
    case 'openai':
      return fetchOpenAIModels(apiKey)
    case 'anthropic':
      return ANTHROPIC_MODELS
    case 'google':
      return GOOGLE_MODELS
    case 'mistral':
      return MISTRAL_MODELS
    case 'xai':
      return XAI_MODELS
    case 'groq':
      return GROQ_MODELS
    case 'deepseek':
      return DEEPSEEK_MODELS
    case 'ollama':
      return fetchOllamaModels()
    default:
      return []
  }
}

/** Returns true if the provider does not require an API key */
export function isKeylessProvider(provider: string): boolean {
  return provider === 'ollama'
}

/** Returns true if the provider uses a static model list (no API fetch needed) */
export function isStaticModelList(provider: string): boolean {
  return ['anthropic', 'google', 'mistral', 'xai', 'groq', 'deepseek'].includes(provider)
}

interface OpenRouterModel {
  id: string
  name: string
  supported_parameters?: string[]
}

async function fetchOpenRouterModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`)
  const data = await res.json()

  return (data.data as OpenRouterModel[])
    .filter((m) => m.supported_parameters?.includes('tools'))
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
