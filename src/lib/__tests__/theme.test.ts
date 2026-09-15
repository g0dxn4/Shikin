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

import {
  APPEARANCE_KEY,
  THEME_KEY,
  applyAppearance,
  applyNativeAppearance,
  applyTheme,
  defaultTheme,
  isValidTheme,
  loadAppearancePreference,
  loadSavedTheme,
  presetThemes,
  saveAppearance,
  saveTheme,
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
})
