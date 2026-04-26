export const APP_NAME = 'Shikin'

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
  oauthSupported?: boolean
}

export const AI_PROVIDERS: readonly ProviderInfo[] = [
  // Subscription-based
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-5.4, GPT-5.4 mini — supports ChatGPT subscription login',
    category: 'subscription',
    oauthSupported: true,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Gemini 3.1 Pro, 3.1 Flash — supports Google OAuth login',
    category: 'subscription',
    oauthSupported: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Opus 4.6, Sonnet 4.6, Haiku 4.5',
    category: 'api',
  },
  // API-key providers
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral Large 3, Small 4, and open models',
    category: 'api',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    description: 'Grok-4.1, Grok-4 Heavy',
    category: 'api',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference — Llama, Qwen, DeepSeek',
    category: 'api',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek-V3.2 and DeepSeek-R1 reasoning',
    category: 'api',
  },
  {
    id: 'alibaba',
    name: 'Alibaba Qwen',
    description: 'Qwen 3 Coder Plus — DashScope subscription',
    category: 'subscription',
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

export const SIDEBAR_WIDTH = 280
export const SIDEBAR_COLLAPSED_WIDTH = 60
export const AI_PANEL_WIDTH = 400

export const CHART_TOOLTIP_STYLE = {
  background: 'rgba(16, 16, 22, 0.94)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 18,
  boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
  fontSize: 12,
} as const

export const CHART_LABEL_STYLE = { color: '#A9A9B4' } as const
export const CHART_ITEM_STYLE = { color: '#FFFFFF' } as const
