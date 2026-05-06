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

export const SIDEBAR_WIDTH = 280
export const SIDEBAR_COLLAPSED_WIDTH = 60

export const CHART_TOOLTIP_STYLE = {
  background: 'rgba(16, 16, 22, 0.94)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 18,
  boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
  fontSize: 12,
} as const

export const CHART_LABEL_STYLE = { color: '#A9A9B4' } as const
export const CHART_ITEM_STYLE = { color: '#FFFFFF' } as const
