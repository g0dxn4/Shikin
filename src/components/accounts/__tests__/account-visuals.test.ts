import { describe, expect, it } from 'vitest'
import { accountAccentColor, accountCardSurfaceStyle, toColorPickerValue } from '../account-visuals'

describe('account visuals', () => {
  it('uses persisted color for accents and tinted surfaces', () => {
    expect(accountAccentColor('  #3d6ea8  ')).toBe('#3d6ea8')
    expect(accountAccentColor(null)).toBe('var(--color-accent)')
    expect(accountCardSurfaceStyle(null)).toEqual({})
    expect(accountCardSurfaceStyle('#3d6ea8').backgroundColor).toContain('#3d6ea8')
    expect(accountCardSurfaceStyle('#3d6ea8', true).backgroundColor).toContain('8%')
  })

  it('expands short hex for the native color picker without inventing a stored value', () => {
    expect(toColorPickerValue('#abc')).toBe('#aabbcc')
    expect(toColorPickerValue('#3d6ea8')).toBe('#3d6ea8')
    expect(toColorPickerValue(null)).toBe('#3d6ea8')
  })
})
