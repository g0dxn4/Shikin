import type { AIProvider } from './agent'
import { ALIBABA_MODELS } from '@/lib/oauth-providers/alibaba'

export interface ModelInfo {
  id: string
  name: string
}

// -- models.dev integration --
// Fetches model lists dynamically from the models.dev open-source database
// via GitHub Contents API. Falls back to static lists on failure.

const MODELS_DEV_BASE = 'https://api.github.com/repos/anomalyco/models.dev/contents/providers'
const MODELS_DEV_RAW = 'https://raw.githubusercontent.com/anomalyco/models.dev/dev/providers'

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
  /^gpt-4($|[^.0-9])/, // gpt-4 base (not gpt-4o or gpt-4.1)
  /^grok-beta/,
  /^grok-vision-beta/,
  /^grok-2/, // old grok-2 family
  /^grok-code/, // code-specific
  /-\d{4}-\d{2}-\d{2}/, // date-suffixed snapshots
  /preview/i,
  /^llama-guard/,
  /^labs-/,
  /^llama3-/, // old llama3 (not 3.x)
  /^open-mistral/,
  /^open-mixtral/,
  /^mistral-nemo/,
  /^pixtral/, // vision-only
  /^ministral/, // small models
  /deep-research/, // deep research variants
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

  // Step 2: Fetch TOMLs for display names + tool support (parallel)
  const models = await Promise.all(
    tomlFiles.map(async (modelId): Promise<(ModelInfo & { hasTools: boolean }) | null> => {
      try {
        const res = await fetch(`${MODELS_DEV_RAW}/${providerDir}/models/${modelId}.toml`)
        if (res.ok) {
          const text = await res.text()
          const nameMatch = text.match(/^name\s*=\s*"(.+?)"/m)
          const toolMatch = text.match(/^tool_call\s*=\s*(true|false)/m)
          const hasTools = toolMatch ? toolMatch[1] === 'true' : false
          return {
            id: modelId,
            name: nameMatch?.[1] ?? modelId,
            hasTools,
          }
        }
      } catch {
        // Fall through
      }
      return null
    })
  )

  // Filter: must have tool support, exclude embeddings/snapshots/previews
  const filtered = (models.filter(Boolean) as (ModelInfo & { hasTools: boolean })[]).filter(
    (m) => m.hasTools && !EXCLUDE_PATTERNS.some((p) => p.test(m.id))
  )

  // Sort: newest/most capable first (higher version numbers first)
  filtered.sort((a, b) => b.id.localeCompare(a.id))

  modelsCache.set(providerDir, { models: filtered, fetchedAt: Date.now() })
  return filtered
}

// -- Static fallbacks (used when models.dev is unreachable) --

const FALLBACK: Partial<Record<AIProvider, ModelInfo[]>> = {
  openai: [
    { id: 'gpt-5.4', name: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'o3', name: 'o3' },
    { id: 'o4-mini', name: 'o4 Mini' },
  ],
  anthropic: [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  ],
  google: [
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
    { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  ],
  mistral: [
    { id: 'mistral-large-latest', name: 'Mistral Large 3' },
    { id: 'mistral-small-latest', name: 'Mistral Small 4' },
    { id: 'codestral-latest', name: 'Codestral' },
  ],
  xai: [
    { id: 'grok-4.1', name: 'Grok-4.1' },
    { id: 'grok-4-heavy', name: 'Grok-4 Heavy' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
    { id: 'qwen-qwq-32b', name: 'Qwen QwQ 32B' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek-V3.2' },
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
    'openai',
    'anthropic',
    'google',
    'mistral',
    'xai',
    'groq',
    'deepseek',
    'alibaba',
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

  const chatPrefixes = ['gpt-4', 'gpt-5', 'o1', 'o3', 'o4', 'o5']
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
