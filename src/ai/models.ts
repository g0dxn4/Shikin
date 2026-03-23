import type { AIProvider } from './agent'
import { ALIBABA_MODELS } from '@/lib/oauth-providers/alibaba'

export interface ModelInfo {
  id: string
  name: string
}

// -- models.dev integration --
// Fetches model lists dynamically from the models.dev open-source database
// via GitHub Contents API. Falls back to static lists on failure.

const MODELS_DEV_BASE =
  'https://api.github.com/repos/anomalyco/models.dev/contents/providers'
const MODELS_DEV_RAW =
  'https://raw.githubusercontent.com/anomalyco/models.dev/dev/providers'

/** Map our provider IDs to models.dev provider directory names */
const PROVIDER_MAP: Partial<Record<AIProvider, string>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  mistral: 'mistral',
  xai: 'xai',
  groq: 'groq',
  deepseek: 'deepseek',
}

/** Filter out embedding, deprecated, and date-suffixed snapshot models */
const EXCLUDE_PATTERNS = [
  /^text-embedding/,
  /^gemini-embedding/,
  /^mistral-embed/,
  /^gpt-3\.5/,
  /^gpt-4(?!\.)/, // gpt-4 (not gpt-4.x or gpt-4o)
  /^grok-beta/,
  /^grok-vision-beta/,
  /-\d{4}-\d{2}-\d{2}/, // date-suffixed snapshots (gpt-4o-2024-08-06)
  /preview/i,
  /^o1-preview/,
  /^llama-guard/,
  /^labs-/,
]

/** In-memory cache: provider → models (avoids re-fetching during session) */
const modelsCache = new Map<string, { models: ModelInfo[]; fetchedAt: number }>()
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

interface GitHubFile {
  name: string
  type: string
  download_url: string
}

/**
 * Fetch model list from models.dev GitHub repo.
 * 1. List the provider's models/ directory (1 API call)
 * 2. Fetch each TOML to get the display name (parallel, batched)
 */
async function fetchModelsFromModelsDev(providerDir: string): Promise<ModelInfo[]> {
  const cached = modelsCache.get(providerDir)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.models
  }

  // Step 1: List model files
  const listRes = await fetch(`${MODELS_DEV_BASE}/${providerDir}/models?ref=dev`)
  if (!listRes.ok) throw new Error(`models.dev listing failed: ${listRes.status}`)
  const files: GitHubFile[] = await listRes.json()

  const tomlFiles = files
    .filter((f) => f.type === 'file' && f.name.endsWith('.toml'))
    .map((f) => f.name.slice(0, -5)) // strip .toml → model ID

  // Step 2: Fetch TOMLs for display names (parallel)
  const models = await Promise.all(
    tomlFiles.map(async (modelId): Promise<ModelInfo> => {
      try {
        const res = await fetch(
          `${MODELS_DEV_RAW}/${providerDir}/models/${modelId}.toml`
        )
        if (res.ok) {
          const text = await res.text()
          const nameMatch = text.match(/^name\s*=\s*"(.+?)"/m)
          if (nameMatch) {
            return { id: modelId, name: nameMatch[1] }
          }
        }
      } catch {
        // Fall through to ID-based name
      }
      return { id: modelId, name: modelId }
    })
  )

  // Filter out embeddings, snapshots, previews
  const filtered = models.filter(
    (m) => !EXCLUDE_PATTERNS.some((p) => p.test(m.id))
  )

  // Sort: newest/most capable first (higher version numbers first)
  filtered.sort((a, b) => b.id.localeCompare(a.id))

  modelsCache.set(providerDir, { models: filtered, fetchedAt: Date.now() })
  return filtered
}

// -- Static fallbacks (used when models.dev is unreachable) --

const FALLBACK: Partial<Record<AIProvider, ModelInfo[]>> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'o3', name: 'o3' },
    { id: 'o3-mini', name: 'o3 Mini' },
    { id: 'o4-mini', name: 'o4 Mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4' },
  ],
  google: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  ],
  mistral: [
    { id: 'mistral-large-latest', name: 'Mistral Large' },
    { id: 'mistral-small-latest', name: 'Mistral Small' },
    { id: 'codestral-latest', name: 'Codestral' },
  ],
  xai: [
    { id: 'grok-3', name: 'Grok 3' },
    { id: 'grok-3-mini', name: 'Grok 3 Mini' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
    { id: 'qwen-qwq-32b', name: 'Qwen QwQ 32B' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek-V3' },
    { id: 'deepseek-reasoner', name: 'DeepSeek-R1' },
  ],
}

// -- Public API --

export async function fetchModels(provider: AIProvider, apiKey: string): Promise<ModelInfo[]> {
  // Providers with their own model listing APIs
  if (provider === 'openrouter') return fetchOpenRouterModels(apiKey)
  if (provider === 'ollama') return fetchOllamaModels()
  if (provider === 'alibaba') return ALIBABA_MODELS

  // OpenAI with API key → use their own API (more accurate for the user's plan)
  if (provider === 'openai' && apiKey) {
    try {
      return await fetchOpenAIModels(apiKey)
    } catch {
      // Fall through to models.dev
    }
  }

  // Try models.dev for all supported providers
  const providerDir = PROVIDER_MAP[provider]
  if (providerDir) {
    try {
      return await fetchModelsFromModelsDev(providerDir)
    } catch {
      // Fall back to static list
    }
  }

  return FALLBACK[provider] ?? []
}

/** Returns true if the provider does not require an API key */
export function isKeylessProvider(provider: string): boolean {
  return provider === 'ollama'
}

/** Returns true if the provider can show models without an API key */
export function isStaticModelList(provider: string): boolean {
  return [
    'openai', 'anthropic', 'google', 'mistral',
    'xai', 'groq', 'deepseek', 'alibaba',
  ].includes(provider)
}

// -- Provider-specific fetchers --

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
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
  const data = await res.json()

  const chatPrefixes = ['gpt-4', 'gpt-5', 'o1', 'o3', 'o4']
  return (data.data as Array<{ id: string }>)
    .filter((m) => chatPrefixes.some((p) => m.id.startsWith(p)))
    .map((m) => ({ id: m.id, name: m.id }))
    .sort((a, b) => b.name.localeCompare(a.name))
}

async function fetchOllamaModels(): Promise<ModelInfo[]> {
  const res = await fetch('http://localhost:11434/api/tags')
  if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
  const data = await res.json()

  return (data.models as Array<{ name: string }>)
    .map((m) => ({ id: m.name, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
