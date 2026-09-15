import { load } from './storage'

export type ThemeTokens = {
  background: string
  surface: string
  foreground: string
  accent: string
  mutedForeground: string
  border: string
  radiusMd: string // e.g. "0px", "8px", "12px", "16px"
  fontPreset: 'current' | 'modern' | 'editorial'
}

export type Appearance = 'native-light' | 'native-dark' | 'custom'

export interface AppearancePreference {
  appearance: Appearance
  customTheme: ThemeTokens
}

export const APPEARANCE_KEY = 'appearance'
export const THEME_KEY = 'theme'

const APPEARANCE_EVENT = 'shikin:appearance-change'
const VALID_APPEARANCES = new Set<Appearance>(['native-light', 'native-dark', 'custom'])

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}%?(\s*,\s*\d{1,3}%?){2}(\s*,\s*(0|1|0?\.\d+))?\s*\))$/
const ALLOWED_RADII = new Set(['0px', '8px', '12px', '16px'])

export const defaultTheme: ThemeTokens = {
  background: '#020203',
  surface: '#101016',
  foreground: '#FFFFFF',
  accent: '#7C5CFF',
  mutedForeground: '#A9A9B4',
  border: '#FFFFFF14',
  radiusMd: '16px',
  fontPreset: 'current',
}

export const presetThemes = {
  default: defaultTheme,
  midnight: {
    background: '#0f172a',
    surface: '#1e293b',
    foreground: '#f8fafc',
    accent: '#3b82f6',
    mutedForeground: '#94a3b8',
    border: 'rgba(255, 255, 255, 0.1)',
    radiusMd: '8px',
    fontPreset: 'modern',
  },
  forest: {
    background: '#052e16',
    surface: '#064e3b',
    foreground: '#ecfdf5',
    accent: '#10b981',
    mutedForeground: '#6ee7b7',
    border: 'rgba(255, 255, 255, 0.1)',
    radiusMd: '12px',
    fontPreset: 'modern',
  },
  rose: {
    background: '#fff1f2',
    surface: '#ffe4e6',
    foreground: '#4c0519',
    accent: '#e11d48',
    mutedForeground: '#9f1239',
    border: 'rgba(0, 0, 0, 0.1)',
    radiusMd: '16px',
    fontPreset: 'editorial',
  },
  aurora: {
    background: '#06111f',
    surface: '#0d1b2f',
    foreground: '#e6f7ff',
    accent: '#2dd4bf',
    mutedForeground: '#9cc6d8',
    border: 'rgba(230, 247, 255, 0.15)',
    radiusMd: '12px',
    fontPreset: 'modern',
  },
  ember: {
    background: '#1a0f0a',
    surface: '#2a1710',
    foreground: '#fff4e8',
    accent: '#f97316',
    mutedForeground: '#e2b8a0',
    border: 'rgba(255, 244, 232, 0.14)',
    radiusMd: '8px',
    fontPreset: 'current',
  },
  slate: {
    background: '#0f1115',
    surface: '#161a21',
    foreground: '#f1f5f9',
    accent: '#8b5cf6',
    mutedForeground: '#a9b3c2',
    border: 'rgba(241, 245, 249, 0.12)',
    radiusMd: '8px',
    fontPreset: 'modern',
  },
  paper: {
    background: '#f8f6f1',
    surface: '#ebe7df',
    foreground: '#1f2937',
    accent: '#2563eb',
    mutedForeground: '#5b6472',
    border: 'rgba(31, 41, 55, 0.16)',
    radiusMd: '12px',
    fontPreset: 'editorial',
  },
  nord: {
    background: '#1f2937',
    surface: '#111827',
    foreground: '#e5e7eb',
    accent: '#60a5fa',
    mutedForeground: '#9ca3af',
    border: 'rgba(229, 231, 235, 0.14)',
    radiusMd: '8px',
    fontPreset: 'modern',
  },
  mono: {
    background: '#0b0b0b',
    surface: '#141414',
    foreground: '#fafafa',
    accent: '#e5e5e5',
    mutedForeground: '#9f9f9f',
    border: 'rgba(250, 250, 250, 0.12)',
    radiusMd: '0px',
    fontPreset: 'current',
  },
  sunset: {
    background: '#1b1220',
    surface: '#2a1a31',
    foreground: '#fff1f2',
    accent: '#fb7185',
    mutedForeground: '#f9a8d4',
    border: 'rgba(255, 241, 242, 0.14)',
    radiusMd: '12px',
    fontPreset: 'editorial',
  },
  ocean: {
    background: '#06263a',
    surface: '#0a3550',
    foreground: '#e0f2fe',
    accent: '#38bdf8',
    mutedForeground: '#93c5fd',
    border: 'rgba(224, 242, 254, 0.14)',
    radiusMd: '12px',
    fontPreset: 'modern',
  },
  matcha: {
    background: '#0d1d16',
    surface: '#152a20',
    foreground: '#ecfdf3',
    accent: '#84cc16',
    mutedForeground: '#bef264',
    border: 'rgba(236, 253, 243, 0.14)',
    radiusMd: '8px',
    fontPreset: 'current',
  },
  terracotta: {
    background: '#221712',
    surface: '#33221b',
    foreground: '#fff7ed',
    accent: '#ea580c',
    mutedForeground: '#fdba74',
    border: 'rgba(255, 247, 237, 0.14)',
    radiusMd: '12px',
    fontPreset: 'editorial',
  },
  violetGlass: {
    background: '#120d1f',
    surface: '#1e1630',
    foreground: '#f5f3ff',
    accent: '#a78bfa',
    mutedForeground: '#c4b5fd',
    border: 'rgba(245, 243, 255, 0.14)',
    radiusMd: '16px',
    fontPreset: 'modern',
  },
  latte: {
    background: '#f6f0e8',
    surface: '#eee3d5',
    foreground: '#3f2d1f',
    accent: '#b45309',
    mutedForeground: '#7c5e45',
    border: 'rgba(63, 45, 31, 0.14)',
    radiusMd: '12px',
    fontPreset: 'editorial',
  },
} satisfies Record<string, ThemeTokens>

export function isValidTheme(theme: unknown): theme is ThemeTokens {
  if (!theme || typeof theme !== 'object') return false

  const t = theme as Record<string, unknown>
  const colors = [t.background, t.surface, t.foreground, t.accent, t.mutedForeground, t.border]

  return (
    colors.every((v) => typeof v === 'string' && COLOR_RE.test(v)) &&
    typeof t.radiusMd === 'string' &&
    ALLOWED_RADII.has(t.radiusMd) &&
    typeof t.fontPreset === 'string' &&
    ['current', 'modern', 'editorial'].includes(t.fontPreset)
  )
}

function parseStoredTheme(raw: unknown): ThemeTokens | null {
  if (!raw) return null

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return isValidTheme(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function loadSavedTheme(): Promise<ThemeTokens> {
  try {
    const store = await load()
    return parseStoredTheme(await store.get(THEME_KEY)) ?? defaultTheme
  } catch {
    // Ignore unavailable/invalid saved payload and fall back to the legacy default.
    return defaultTheme
  }
}

/**
 * Reads appearance without writing either preference. A valid legacy theme remains selected when
 * the newer appearance key is absent; a completely new install starts in native light.
 */
export async function loadAppearancePreference(): Promise<AppearancePreference> {
  try {
    const store = await load()
    const [rawAppearance, rawTheme] = await Promise.all([
      store.get(APPEARANCE_KEY),
      store.get(THEME_KEY),
    ])
    const customTheme = parseStoredTheme(rawTheme)
    const appearance = VALID_APPEARANCES.has(rawAppearance as Appearance)
      ? (rawAppearance as Appearance)
      : customTheme
        ? 'custom'
        : 'native-light'

    return {
      appearance: appearance === 'custom' && !customTheme ? 'native-light' : appearance,
      customTheme: customTheme ?? defaultTheme,
    }
  } catch {
    return { appearance: 'native-light', customTheme: defaultTheme }
  }
}

export async function saveTheme(theme: ThemeTokens): Promise<void> {
  if (!isValidTheme(theme)) return
  const store = await load()
  await store.set(THEME_KEY, JSON.stringify(theme))
}

/** Writes only the independent appearance selector; the saved custom theme is never rewritten. */
export async function saveAppearance(appearance: Appearance): Promise<void> {
  if (!VALID_APPEARANCES.has(appearance)) return
  const store = await load()
  await store.set(APPEARANCE_KEY, appearance)
}

const CUSTOM_PROPERTIES = [
  '--color-background',
  '--color-surface',
  '--color-surface-elevated',
  '--color-foreground',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-muted',
  '--color-accent-foreground',
  '--color-primary',
  '--color-primary-foreground',
  '--color-muted-foreground',
  '--color-border',
  '--color-border-hover',
  '--color-border-accent',
  '--color-ring',
  '--color-chart-1',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-2xl',
  '--font-heading',
  '--font-sans',
  '--font-mono',
] as const

function announceAppearance(appearance: Appearance) {
  window.dispatchEvent(new CustomEvent<Appearance>(APPEARANCE_EVENT, { detail: appearance }))
}

function requiresDarkControls(background: string) {
  if (!background.startsWith('#')) return true
  const hex = background.slice(1)
  const normalized = hex.length === 3 ? [...hex].map((value) => value + value).join('') : hex
  if (normalized.length < 6) return true
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return red * 0.299 + green * 0.587 + blue * 0.114 < 150
}

export function applyNativeAppearance(appearance: 'native-light' | 'native-dark') {
  const root = document.documentElement
  CUSTOM_PROPERTIES.forEach((property) => root.style.removeProperty(property))
  root.dataset.appearance = appearance
  root.style.colorScheme = appearance === 'native-dark' ? 'dark' : 'light'
  root.classList.toggle('dark', appearance === 'native-dark')
  announceAppearance(appearance)
}

export function applyTheme(theme: ThemeTokens) {
  if (!isValidTheme(theme)) return

  const root = document.documentElement
  const dark = requiresDarkControls(theme.background)
  root.dataset.appearance = 'custom'
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.classList.toggle('dark', dark)

  root.style.setProperty('--color-background', theme.background)
  root.style.setProperty('--color-surface', theme.surface)
  root.style.setProperty('--color-foreground', theme.foreground)
  root.style.setProperty('--color-accent', theme.accent)
  root.style.setProperty('--color-muted-foreground', theme.mutedForeground)
  root.style.setProperty('--color-border', theme.border)
  root.style.setProperty(
    '--color-surface-elevated',
    'color-mix(in srgb, var(--color-surface) 88%, white)'
  )
  root.style.setProperty('--color-primary', theme.accent)
  root.style.setProperty(
    '--color-accent-hover',
    'color-mix(in srgb, var(--color-accent) 82%, white)'
  )
  root.style.setProperty(
    '--color-accent-muted',
    'color-mix(in srgb, var(--color-accent) 15%, transparent)'
  )
  root.style.setProperty('--color-accent-foreground', '#ffffff')
  root.style.setProperty('--color-primary-foreground', '#ffffff')
  root.style.setProperty('--color-ring', theme.accent)
  root.style.setProperty('--color-chart-1', theme.accent)
  root.style.setProperty(
    '--color-border-hover',
    'color-mix(in srgb, var(--color-foreground) 12%, transparent)'
  )
  root.style.setProperty(
    '--color-border-accent',
    'color-mix(in srgb, var(--color-accent) 30%, transparent)'
  )

  const md = parseInt(theme.radiusMd, 10)
  const sm = Number.isFinite(md) ? Math.max(0, md - 4) : 0
  const lg = Number.isFinite(md) ? md + 4 : 12
  root.style.setProperty('--radius-sm', `${sm}px`)
  root.style.setProperty('--radius-md', theme.radiusMd)
  root.style.setProperty('--radius-lg', `${lg}px`)
  root.style.setProperty('--radius-xl', `${lg}px`)
  root.style.setProperty('--radius-2xl', `${lg}px`)

  if (theme.fontPreset === 'modern') {
    root.style.setProperty('--font-heading', '"Inter", system-ui, sans-serif')
    root.style.setProperty('--font-sans', '"Inter", system-ui, sans-serif')
    root.style.setProperty('--font-mono', '"Space Mono", ui-monospace, monospace')
  } else if (theme.fontPreset === 'editorial') {
    root.style.setProperty('--font-heading', '"Playfair Display", Georgia, serif')
    root.style.setProperty('--font-sans', '"Inter", system-ui, sans-serif')
    root.style.setProperty('--font-mono', '"Space Mono", ui-monospace, monospace')
  } else {
    root.style.setProperty(
      '--font-heading',
      '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif'
    )
    root.style.setProperty('--font-sans', '"Outfit Variable", "Outfit", system-ui, sans-serif')
    root.style.setProperty('--font-mono', '"Space Mono", ui-monospace, monospace')
  }
  announceAppearance('custom')
}

export function applyAppearance(preference: AppearancePreference) {
  if (preference.appearance === 'custom') {
    applyTheme(preference.customTheme)
  } else {
    applyNativeAppearance(preference.appearance)
  }
}

export async function setAppearance(appearance: Appearance, customTheme = defaultTheme) {
  await saveAppearance(appearance)
  applyAppearance({ appearance, customTheme })
}

export function getAppliedAppearance(): Appearance {
  const value = document.documentElement.dataset.appearance
  return VALID_APPEARANCES.has(value as Appearance) ? (value as Appearance) : 'native-light'
}

export function subscribeAppearance(listener: (appearance: Appearance) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<Appearance>).detail)
  window.addEventListener(APPEARANCE_EVENT, handler)
  return () => window.removeEventListener(APPEARANCE_EVENT, handler)
}
