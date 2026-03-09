export const APP_NAME = 'Valute'

export const DEFAULT_CURRENCY = 'USD'

export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'MXN',
  'BRL',
  'ARS',
  'COP',
  'CLP',
  'PEN',
  'CAD',
  'AUD',
] as const

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Espa\u00f1ol' },
] as const

export type ProviderCategory = 'subscription' | 'api' | 'local' | 'gateway'

export interface ProviderInfo {
  id: string
  name: string
  description: string
  category: ProviderCategory
}

export const AI_PROVIDERS: readonly ProviderInfo[] = [
  // Subscription-based
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, o3, and more — works with ChatGPT Plus API access',
    category: 'subscription',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Free tier + Google One AI Premium',
    category: 'subscription',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Sonnet 4, Haiku 4, and more',
    category: 'api',
  },
  // API-key providers
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral Large, Codestral, and open models',
    category: 'api',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    description: 'Grok-2 and Grok-3 models',
    category: 'api',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference — Llama, Mixtral, Gemma',
    category: 'api',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek-V3 and DeepSeek-R1 reasoning',
    category: 'api',
  },
  // Gateway
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access 200+ models through one API key',
    category: 'gateway',
  },
  // Local
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Run models locally — fully private, no API key needed',
    category: 'local',
  },
] as const

export const PROVIDER_CATEGORIES: Record<ProviderCategory, { label: string; color: string }> = {
  subscription: { label: 'Subscription', color: 'var(--color-accent)' },
  api: { label: 'API Key', color: 'var(--color-muted-foreground)' },
  gateway: { label: 'Gateway', color: 'var(--color-chart-3)' },
  local: { label: 'Local', color: 'var(--color-success)' },
}

export const SIDEBAR_WIDTH = 240
export const SIDEBAR_COLLAPSED_WIDTH = 60
export const AI_PANEL_WIDTH = 400
