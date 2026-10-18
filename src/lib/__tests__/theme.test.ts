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
  customFinancialColors,
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

  it('derives readable financial colors for every custom preset without rewriting tokens', () => {
    const added = Object.entries(presetThemes).filter(([name]) => !(name in ORIGINAL_PRESETS))
    expect(added).toHaveLength(24)
    const before = JSON.stringify(presetThemes)

    for (const [name, theme] of Object.entries(presetThemes)) {
      const colors = customFinancialColors(theme)
      expect(colors.income, name).toBe(colors.success)
      expect(colors.expense, name).toBe(colors.destructive)
      expect(colors.chart2, name).toBe(colors.success)
      expect(colors.chart4, name).toBe(colors.warning)
      expect(colors.chart5, name).toBe(colors.destructive)
      expect(keepsMeaning('success', colors.success), `${name} success`).toBe(true)
      expect(keepsMeaning('warning', colors.warning), `${name} warning`).toBe(true)
      expect(keepsMeaning('destructive', colors.destructive), `${name} destructive`).toBe(true)
      expect(keepsMeaning('cool', colors.chart3), `${name} chart3`).toBe(true)

      for (const surface of [theme.background, theme.surface]) {
        for (const [role, color] of [
          ['success', colors.success],
          ['warning', colors.warning],
          ['destructive', colors.destructive],
          ['chart2', colors.chart2],
          ['chart3', colors.chart3],
          ['chart4', colors.chart4],
          ['chart5', colors.chart5],
        ] as const) {
          expect(contrast(color, surface), `${name} ${role} on ${surface}`).toBeGreaterThanOrEqual(
            4.5
          )
          expect(
            contrast(color, mixHex(color, surface, 0.1)),
            `${name} ${role} 10% badge`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
      expect(
        contrast(colors.chart3, mixHex(theme.foreground, theme.surface, 0.07)),
        `${name} snowball`
      ).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.successForeground, colors.success), name).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.warningForeground, colors.warning), name).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(colors.destructiveForeground, colors.destructive),
        name
      ).toBeGreaterThanOrEqual(4.5)
      for (const color of [colors.chart2, colors.chart3, colors.chart4, colors.chart5]) {
        expect(contrast(customAccentForeground(color), color), name).toBeGreaterThanOrEqual(4.5)
      }
    }

    expect(JSON.stringify(presetThemes)).toBe(before)
    expect(Object.keys(presetThemes.sand)).toEqual(Object.keys(defaultTheme))
  })

  it('corrects Sand and Harbor inherited financial contrast and keeps Harbor bases', () => {
    const sand = customFinancialColors(presetThemes.sand)
    const harbor = customFinancialColors(presetThemes.harbor)

    expect(contrast('#a96108', presetThemes.sand.surface)).toBeCloseTo(3.75, 2)
    expect(contrast('#18783c', presetThemes.sand.surface)).toBeCloseTo(4.35, 2)
    expect(contrast('#8eb7ed', presetThemes.sand.surface)).toBeCloseTo(1.62, 2)
    expect(contrast('#18783c', presetThemes.harbor.surface)).toBeCloseTo(2.84, 2)

    expect(contrast(sand.warning, presetThemes.sand.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(sand.warning, presetThemes.sand.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(sand.success, presetThemes.sand.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(sand.chart3, presetThemes.sand.surface)).toBeGreaterThanOrEqual(4.5)
    expect(sand.chart3).not.toBe('#8eb7ed')
    expect(contrast(sand.warningForeground, sand.warning)).toBeGreaterThanOrEqual(4.5)

    expect(harbor.success).toBe('#4dcc78')
    expect(harbor.warning).toBe('#e9a84d')
    expect(harbor.destructive).toBe('#f07474')
    expect(harbor.income).toBe('#4dcc78')
    expect(harbor.chart2).toBe('#4dcc78')
    expect(harbor.chart3).toBe('#8eb7ed')
    expect(harbor.chart4).toBe('#e9a84d')
    expect(harbor.chart5).toBe('#f07474')
    expect(harbor.successForeground).toBe('#101010')
    expect(contrast(harbor.success, presetThemes.harbor.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(harbor.success, presetThemes.harbor.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(harbor.destructiveForeground, harbor.destructive)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps readable legacy chart-3 exact and clears it when returning to native', async () => {
    expect(customFinancialColors(defaultTheme).chart3).toBe('#8eb7ed')
    expect(customFinancialColors(presetThemes.midnight).chart3).toBe('#8eb7ed')
    applyTheme(defaultTheme)
    expect(document.documentElement.style.getPropertyValue('--color-chart-3')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--color-success')).toBe('#4dcc78')
    expect(document.documentElement.style.getPropertyValue('--color-income')).toBe('#4dcc78')

    applyTheme(presetThemes.sand)
    const sand = customFinancialColors(presetThemes.sand)
    expect(document.documentElement.style.getPropertyValue('--color-chart-3')).toBe(sand.chart3)
    expect(document.documentElement.style.getPropertyValue('--color-warning')).toBe(sand.warning)
    expect(document.documentElement.style.getPropertyValue('--color-warning-foreground')).toBe(
      sand.warningForeground
    )
    expect(document.documentElement.style.getPropertyValue('--color-expense')).toBe(
      sand.destructive
    )

    applyTheme(defaultTheme)
    expect(document.documentElement.style.getPropertyValue('--color-chart-3')).toBe('')
    expect(customFinancialColors(defaultTheme).chart3).toBe('#8eb7ed')

    applyNativeAppearance('native-light')
    for (const property of FINANCIAL_INLINE_PROPERTIES) {
      expect(document.documentElement.style.getPropertyValue(property), property).toBe('')
    }
    expect(document.documentElement.dataset.appearance).toBe('native-light')
    expect(document.documentElement).not.toHaveClass('dark')

    applyTheme(presetThemes.sand)
    expect(document.documentElement.style.getPropertyValue('--color-success')).toBe(sand.success)
    applyNativeAppearance('native-dark')
    for (const property of FINANCIAL_INLINE_PROPERTIES) {
      expect(document.documentElement.style.getPropertyValue(property), property).toBe('')
    }
    expect(document.documentElement).toHaveClass('dark')

    await saveTheme(presetThemes.harbor)
    applyTheme(presetThemes.harbor)
    expect(stored.get(THEME_KEY)).toBe(JSON.stringify(presetThemes.harbor))
    expect(Object.keys(JSON.parse(String(stored.get(THEME_KEY))))).toEqual(
      Object.keys(defaultTheme)
    )
    expect(document.documentElement.style.getPropertyValue('--color-chart-3')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--color-success')).toBe('#4dcc78')
  })

  it('accepts opaque rgb financial surfaces and does not throw on translucent legacy colors', () => {
    const rgbSand = {
      ...presetThemes.sand,
      background: 'rgb(246, 240, 228)',
      surface: 'rgb(236, 227, 210)',
      foreground: 'rgb(44, 36, 24)',
    }
    expect(customFinancialColors(rgbSand)).toEqual(customFinancialColors(presetThemes.sand))

    expect(() =>
      applyTheme({
        ...defaultTheme,
        background: 'rgba(246, 240, 228, 0.4)',
        surface: '#ece3d280',
        foreground: 'rgba(44, 36, 24, 0.2)',
      })
    ).not.toThrow()
    expect(document.documentElement.style.getPropertyValue('--color-success')).toMatch(
      /^#[0-9a-f]{6}$/
    )
    expect(document.documentElement.style.getPropertyValue('--color-warning-foreground')).toMatch(
      /^#(ffffff|101010)$/
    )

    applyTheme({ ...presetThemes.sand, background: '#f6f0e480', surface: '#ece3d280' })
    expect(document.documentElement.style.getPropertyValue('--color-success')).toBe('#18783c')
    expect(document.documentElement.style.getPropertyValue('--color-chart-3')).toBe('#1d5fad')
    expect(document.documentElement.style.getPropertyValue('--color-destructive-foreground')).toBe(
      '#ffffff'
    )

    expect(() =>
      customFinancialColors({
        background: 'not-a-color',
        surface: '#ffffff14',
        foreground: 'rgba(255, 255, 255, 0.4)',
      })
    ).not.toThrow()
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

const FINANCIAL_INLINE_PROPERTIES = [
  '--color-success',
  '--color-success-foreground',
  '--color-warning',
  '--color-warning-foreground',
  '--color-destructive',
  '--color-destructive-foreground',
  '--color-income',
  '--color-expense',
  '--color-chart-2',
  '--color-chart-3',
  '--color-chart-4',
  '--color-chart-5',
]

function mixHex(front: string, back: string, amount: number): string {
  const mix = (from: number, to: number) => Math.round(from * amount + to * (1 - amount))
  const channels = [1, 3, 5].map((offset) =>
    mix(channel(front.toLowerCase(), offset), channel(back.toLowerCase(), offset))
  )
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [red, green, blue] = [1, 3, 5].map((offset) => channel(hex.toLowerCase(), offset) / 255)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta === 0) return { hue: 0, saturation: 0 }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const hueSector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4
  return { hue: (hueSector * 60 + 360) % 360, saturation }
}

function keepsMeaning(role: 'success' | 'warning' | 'destructive' | 'cool', hex: string): boolean {
  const { hue, saturation } = hueAndSaturation(hex)
  if (saturation < 0.42) return false
  if (role === 'success') return hue >= 90 && hue <= 165
  if (role === 'warning') return hue >= 18 && hue <= 52
  if (role === 'destructive') return hue <= 16 || hue >= 345
  return hue >= 190 && hue <= 235
}
