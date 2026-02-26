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

export const AI_PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'ollama', name: 'Ollama (Local)' },
] as const

export const SIDEBAR_WIDTH = 240
export const SIDEBAR_COLLAPSED_WIDTH = 60
export const AI_PANEL_WIDTH = 400
