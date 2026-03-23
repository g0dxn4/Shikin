import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockStore = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue(mockStore),
}))

import {
  isValidTheme,
  defaultTheme,
  presetThemes,
  loadSavedTheme,
  saveTheme,
  applyTheme,
} from '../theme'

describe('Theme Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.get.mockResolvedValue(null)
    document.documentElement.style.cssText = '' // clear styles
  })

  it('validates a correct theme', () => {
    expect(isValidTheme(defaultTheme)).toBe(true)
    expect(isValidTheme(presetThemes.midnight)).toBe(true)
  })

  it('rejects invalid themes', () => {
    expect(isValidTheme(null)).toBe(false)
    expect(isValidTheme({})).toBe(false)
    expect(isValidTheme({ background: '#000' })).toBe(false) // missing fields
    expect(isValidTheme({ ...defaultTheme, fontPreset: 'invalid' })).toBe(false)
  })

  it('saves and loads a valid theme', async () => {
    await saveTheme(presetThemes.midnight)
    expect(mockStore.set).toHaveBeenCalledWith('theme', JSON.stringify(presetThemes.midnight))

    mockStore.get.mockResolvedValueOnce(JSON.stringify(presetThemes.midnight))
    const loaded = await loadSavedTheme()
    expect(loaded).toEqual(presetThemes.midnight)
  })

  it('does not save invalid theme payloads', async () => {
    await saveTheme({ ...defaultTheme, accent: 'not-a-color' } as unknown as typeof defaultTheme)
    expect(mockStore.set).not.toHaveBeenCalled()
  })

  it('returns default theme when no saved theme exists or saved is invalid', async () => {
    expect(await loadSavedTheme()).toEqual(defaultTheme)

    mockStore.get.mockResolvedValueOnce('invalid json')
    expect(await loadSavedTheme()).toEqual(defaultTheme)

    mockStore.get.mockResolvedValueOnce(JSON.stringify({ bg: 'red' })) // invalid schema
    expect(await loadSavedTheme()).toEqual(defaultTheme)
  })

  it('applies theme to document root', () => {
    applyTheme(presetThemes.rose)
    const style = document.documentElement.style
    expect(style.getPropertyValue('--color-background')).toBe(presetThemes.rose.background)
    expect(style.getPropertyValue('--color-accent')).toBe(presetThemes.rose.accent)
    expect(style.getPropertyValue('--radius-md')).toBe(presetThemes.rose.radiusMd)
  })

  it('sets font styles correctly based on preset', () => {
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
