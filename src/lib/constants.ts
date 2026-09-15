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

export const SIDEBAR_WIDTH = 216
export const SIDEBAR_COLLAPSED_WIDTH = 72

export const CHART_TOOLTIP_STYLE = {
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-panel)',
  color: 'var(--color-popover-foreground)',
  fontSize: 12,
} as const

export const CHART_LABEL_STYLE = { color: 'var(--color-muted-foreground)' } as const
export const CHART_ITEM_STYLE = { color: 'var(--color-foreground)' } as const
export const CHART_GRID_COLOR = 'var(--color-chart-grid)'
export const CHART_AXIS_COLOR = 'var(--color-chart-axis)'
export const CHART_LEGEND_STYLE = { color: 'var(--color-muted-foreground)' } as const
