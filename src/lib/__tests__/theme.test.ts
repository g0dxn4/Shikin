import { beforeEach, describe, expect, it, vi } from 'vitest'

const stored = vi.hoisted(() => new Map<string, unknown>())
const mockStore = vi.hoisted(() => ({
  get: vi.fn(async (key: string) => stored.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    stored.set(key, value)
  }),
  save: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue(mockStore),
}))

import enSettings from '../../i18n/locales/en/settings.json'
import esSettings from '../../i18n/locales/es/settings.json'
import {
  APPEARANCE_KEY,
  THEME_KEY,
  applyAppearance,
  applyNativeAppearance,
  applyTheme,
  customAccentForeground,
  defaultTheme,
  isValidTheme,
  loadAppearancePreference,
  loadSavedTheme,
  presetThemes,
  saveAppearance,
  saveTheme,
  themeTone,
} from '../theme'

describe('Theme Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stored.clear()
    document.documentElement.style.cssText = ''
    document.documentElement.className = ''
    delete document.documentElement.dataset.appearance
  })

  it('validates a correct theme and rejects malformed themes', () => {
    expect(isValidTheme(defaultTheme)).toBe(true)
    expect(isValidTheme(presetThemes.midnight)).toBe(true)
    expect(isValidTheme(null)).toBe(false)
    expect(isValidTheme({})).toBe(false)
    expect(isValidTheme({ ...defaultTheme, fontPreset: 'invalid' })).toBe(false)
  })

  it('saves and loads a valid custom theme', async () => {
    await saveTheme(presetThemes.midnight)
    expect(mockStore.set).toHaveBeenCalledWith(THEME_KEY, JSON.stringify(presetThemes.midnight))
    expect(await loadSavedTheme()).toEqual(presetThemes.midnight)
  })

  it('does not save invalid theme payloads', async () => {
    await saveTheme({ ...defaultTheme, accent: 'not-a-color' } as typeof defaultTheme)
    expect(mockStore.set).not.toHaveBeenCalled()
  })

  it('returns the legacy default when the saved custom payload is absent or invalid', async () => {
    expect(await loadSavedTheme()).toEqual(defaultTheme)
    stored.set(THEME_KEY, 'invalid json')
    expect(await loadSavedTheme()).toEqual(defaultTheme)
    stored.set(THEME_KEY, JSON.stringify({ bg: 'red' }))
    expect(await loadSavedTheme()).toEqual(defaultTheme)
  })

  it('selects legacy custom appearance when appearance is absent and theme is valid', async () => {
    stored.set(THEME_KEY, JSON.stringify(presetThemes.paper))
    expect(await loadAppearancePreference()).toEqual({
      appearance: 'custom',
      customTheme: presetThemes.paper,
    })
  })

  it('selects native light when both preferences are absent or invalid', async () => {
    expect((await loadAppearancePreference()).appearance).toBe('native-light')
    stored.set(APPEARANCE_KEY, 'system')
    stored.set(THEME_KEY, '{invalid')
    expect((await loadAppearancePreference()).appearance).toBe('native-light')
  })

  it('preserves a seeded custom payload byte-for-byte through native switching and reload', async () => {
    const seededPayload = ` {\n  "background": "#fff1f2", "surface": "#ffe4e6",\n  "foreground": "#4c0519", "accent": "#e11d48",\n  "mutedForeground": "#9f1239", "border": "rgba(0, 0, 0, 0.1)",\n  "radiusMd": "16px", "fontPreset": "editorial"\n}`
    stored.set(THEME_KEY, seededPayload)

    const legacyPreference = await loadAppearancePreference()
    expect(legacyPreference.appearance).toBe('custom')
    applyAppearance(legacyPreference)

    await saveAppearance('native-dark')
    applyNativeAppearance('native-dark')
    expect(stored.get(THEME_KEY)).toBe(seededPayload)
    expect(mockStore.set).toHaveBeenCalledTimes(1)
    expect(mockStore.set).toHaveBeenCalledWith(APPEARANCE_KEY, 'native-dark')

    const reloadedNative = await loadAppearancePreference()
    expect(reloadedNative.appearance).toBe('native-dark')
    expect(reloadedNative.customTheme).toEqual(legacyPreference.customTheme)
    expect(stored.get(THEME_KEY)).toBe(seededPayload)

    await saveAppearance('custom')
    const reselected = await loadAppearancePreference()
    applyAppearance(reselected)
    expect(reselected.appearance).toBe('custom')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#e11d48')
    expect(stored.get(THEME_KEY)).toBe(seededPayload)
  })

  it('applies native palettes without custom inline color overrides', () => {
    applyTheme(presetThemes.rose)
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#e11d48')

    applyNativeAppearance('native-light')
    expect(document.documentElement.dataset.appearance).toBe('native-light')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('')
    expect(document.documentElement).not.toHaveClass('dark')

    applyNativeAppearance('native-dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('keeps legacy custom font modes valid', () => {
    applyTheme({ ...defaultTheme, fontPreset: 'modern' })
    expect(document.documentElement.style.getPropertyValue('--font-heading')).toContain('Inter')
    applyTheme({ ...defaultTheme, fontPreset: 'editorial' })
    expect(document.documentElement.style.getPropertyValue('--font-heading')).toContain(
      'Playfair Display'
    )
    applyTheme({ ...defaultTheme, fontPreset: 'current' })
    expect(document.documentElement.style.getPropertyValue('--font-heading')).toContain(
      'Space Grotesk'
    )
  })

  it('keeps the original 16 presets and saved 8-token schema unchanged', () => {
    expect(Object.keys(defaultTheme).sort()).toEqual([
      'accent',
      'background',
      'border',
      'fontPreset',
      'foreground',
      'mutedForeground',
      'radiusMd',
      'surface',
    ])
    expect(Object.keys(presetThemes)).toHaveLength(40)
    expect(Object.keys(presetThemes).slice(0, 16)).toEqual(Object.keys(ORIGINAL_PRESETS))
    expect(presetThemes.default).toBe(defaultTheme)
    for (const [name, tokens] of Object.entries(ORIGINAL_PRESETS)) {
      expect(presetThemes[name as keyof typeof presetThemes]).toEqual(tokens)
    }
  })

  it('validates all 40 presets and keeps new light and dark themes readable', () => {
    const names = Object.keys(presetThemes)
    expect(names).toHaveLength(40)
    expect(new Set(names).size).toBe(40)
    for (const theme of Object.values(presetThemes)) expect(isValidTheme(theme)).toBe(true)

    const added = Object.entries(presetThemes).filter(([name]) => !(name in ORIGINAL_PRESETS))
    expect(added).toHaveLength(24)
    const light = added.filter(([, theme]) => themeTone(theme) === 'light')
    const dark = added.filter(([, theme]) => themeTone(theme) === 'dark')
    expect(light.length).toBeGreaterThanOrEqual(10)
    expect(dark.length).toBeGreaterThanOrEqual(10)
    expect(light.length + dark.length).toBe(24)

    const signatures = new Set(Object.values(presetThemes).map((theme) => JSON.stringify(theme)))
    expect(signatures.size).toBe(40)

    for (const [name, theme] of added) {
      expect(themeTone(theme), name).toBe(contrastTone(theme.background))
      for (const surface of [theme.background, theme.surface]) {
        expect(contrast(theme.foreground, surface), `${name} foreground`).toBeGreaterThanOrEqual(
          4.5
        )
        expect(contrast(theme.mutedForeground, surface), `${name} muted`).toBeGreaterThanOrEqual(
          4.5
        )
        expect(contrast(theme.accent, surface), `${name} accent`).toBeGreaterThanOrEqual(4.5)
      }
      const label = customAccentForeground(theme.accent)
      expect(contrast(label, theme.accent), `${name} label`).toBeGreaterThanOrEqual(4.5)
      expect(label).toBe(themeTone(theme) === 'light' ? '#ffffff' : '#101010')
      expect(theme.background + theme.border).not.toMatch(/gradient|glass|glow/i)
    }
  })

  it('has authored English and Spanish names for every preset', () => {
    for (const name of Object.keys(presetThemes)) {
      expect(enSettings.theme.presets, name).toHaveProperty(name)
      expect(esSettings.theme.presets, name).toHaveProperty(name)
      expect(enSettings.theme.presetDescriptions, name).toHaveProperty(name)
      expect(esSettings.theme.presetDescriptions, name).toHaveProperty(name)
      const enName = enSettings.theme.presets[name as keyof typeof enSettings.theme.presets]
      const esName = esSettings.theme.presets[name as keyof typeof esSettings.theme.presets]
      const enDescription =
        enSettings.theme.presetDescriptions[
          name as keyof typeof enSettings.theme.presetDescriptions
        ]
      const esDescription =
        esSettings.theme.presetDescriptions[
          name as keyof typeof esSettings.theme.presetDescriptions
        ]
      expect(enName.trim().length).toBeGreaterThan(0)
      expect(esName.trim().length).toBeGreaterThan(0)
      expect(enDescription.trim().length).toBeGreaterThan(0)
      expect(esDescription.trim().length).toBeGreaterThan(0)
      if (!(name in ORIGINAL_PRESETS)) {
        expect(esName).not.toBe(enName)
        expect(esDescription).not.toBe(enDescription)
      }
    }
    for (const [name, label] of Object.entries(ORIGINAL_EN_PRESET_NAMES)) {
      expect(enSettings.theme.presets[name as keyof typeof enSettings.theme.presets]).toBe(label)
    }
    expect(esSettings.theme.presets.default).toBe('Predeterminado')
    expect(esSettings.theme.custom).toBe('Personalizada guardada')
    expect(enSettings.theme.searchLabel.trim().length).toBeGreaterThan(0)
    expect(esSettings.theme.searchLabel.trim().length).toBeGreaterThan(0)
    expect(esSettings.theme.searchLabel).not.toBe(enSettings.theme.searchLabel)
    expect(esSettings.theme.searchPlaceholder).not.toBe(enSettings.theme.searchPlaceholder)
    expect(esSettings.theme.emptyResults).not.toBe(enSettings.theme.emptyResults)
  })

  it('chooses a custom accent label from actual contrast and keeps native reset', () => {
    expect(customAccentForeground('#fde68a')).toBe('#101010')
    expect(customAccentForeground('#FDE68A')).toBe('#101010')
    expect(customAccentForeground('#fda')).toBe('#101010')
    expect(customAccentForeground('#ffddaa')).toBe('#101010')
    expect(customAccentForeground('#ffddaaff')).toBe('#101010')
    expect(customAccentForeground('rgb(253, 230, 138)')).toBe('#101010')
    expect(customAccentForeground('rgb(100%, 90%, 54%)')).toBe('#101010')
    expect(customAccentForeground('rgba(253, 230, 138, 1)')).toBe('#101010')
    expect(customAccentForeground('#123')).toBe('#ffffff')
    expect(customAccentForeground('#112233')).toBe('#ffffff')
    expect(customAccentForeground('rgb(17, 34, 51)')).toBe('#ffffff')
    expect(customAccentForeground('#e11d48')).toBe('#ffffff')
    expect(customAccentForeground('#7C5CFF')).toBe('#101010')
    expect(customAccentForeground('rgba(253, 230, 138, 0.4)')).toBe('#ffffff')
    expect(customAccentForeground('#ffddaa80')).toBe('#ffffff')
    expect(customAccentForeground('#fff8')).toBe('#ffffff')
    expect(customAccentForeground('#12345')).toBe('#ffffff')
    expect(customAccentForeground('rgb(300, 0, 0)')).toBe('#ffffff')
    expect(customAccentForeground('not-a-color')).toBe('#ffffff')

    applyTheme({ ...defaultTheme, accent: '#fde68a' })
    expect(document.documentElement.style.getPropertyValue('--color-accent-foreground')).toBe(
      '#101010'
    )
    expect(document.documentElement.style.getPropertyValue('--color-primary-foreground')).toBe(
      '#101010'
    )
    expect(contrast('#101010', '#fde68a')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#101010', '#fde68a')).toBeGreaterThan(contrast('#ffffff', '#fde68a'))

    applyTheme({ ...defaultTheme, accent: 'rgba(17, 34, 51, 0.5)' })
    expect(document.documentElement.style.getPropertyValue('--color-accent-foreground')).toBe(
      '#ffffff'
    )

    applyTheme(presetThemes.rose)
    expect(document.documentElement.style.getPropertyValue('--color-accent-foreground')).toBe(
      '#ffffff'
    )
    applyNativeAppearance('native-light')
    expect(document.documentElement.dataset.appearance).toBe('native-light')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--color-accent-foreground')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--color-primary-foreground')).toBe('')
    expect(document.documentElement).not.toHaveClass('dark')
  })
})

const ORIGINAL_PRESETS = {
  default: {
    background: '#020203',
    surface: '#101016',
    foreground: '#FFFFFF',
    accent: '#7C5CFF',
    mutedForeground: '#A9A9B4',
    border: '#FFFFFF14',
    radiusMd: '16px',
    fontPreset: 'current',
  },
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
} as const

const ORIGINAL_EN_PRESET_NAMES = {
  default: 'Default',
  midnight: 'Midnight',
  forest: 'Forest',
  rose: 'Rose',
  aurora: 'Aurora',
  ember: 'Ember',
  slate: 'Slate',
  paper: 'Paper',
  nord: 'Nord',
  mono: 'Mono',
  sunset: 'Sunset',
  ocean: 'Ocean',
  matcha: 'Matcha',
  terracotta: 'Terracotta',
  violetGlass: 'Violet Glass',
  latte: 'Latte',
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

function linear(value: number): number {
  const channelValue = value / 255
  return channelValue <= 0.04045 ? channelValue / 12.92 : ((channelValue + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const normalized = hex.toLowerCase()
  const red = channel(normalized, 1)
  const green = channel(normalized, 3)
  const blue = channel(normalized, 5)
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function contrastTone(background: string): 'light' | 'dark' {
  const red = channel(background, 1)
  const green = channel(background, 3)
  const blue = channel(background, 5)
  return red * 0.299 + green * 0.587 + blue * 0.114 < 150 ? 'dark' : 'light'
}
