import { describe, it, expect, beforeEach, vi } from 'vitest'
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
    localStorage.clear()
    vi.clearAllMocks()
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

  it('saves and loads a valid theme', () => {
    saveTheme(presetThemes.midnight)
    const loaded = loadSavedTheme()
    expect(loaded).toEqual(presetThemes.midnight)
  })

  it('does not save invalid theme payloads', () => {
    saveTheme({ ...defaultTheme, accent: 'not-a-color' } as unknown as typeof defaultTheme)
    expect(localStorage.getItem('valute_theme')).toBeNull()
  })

  it('returns default theme when no saved theme exists or saved is invalid', () => {
    expect(loadSavedTheme()).toEqual(defaultTheme)

    localStorage.setItem('valute_theme', 'invalid json')
    expect(loadSavedTheme()).toEqual(defaultTheme)

    localStorage.setItem('valute_theme', JSON.stringify({ bg: 'red' })) // invalid schema
    expect(loadSavedTheme()).toEqual(defaultTheme)
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
