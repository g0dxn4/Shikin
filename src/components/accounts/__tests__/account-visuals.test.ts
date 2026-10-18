import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_RAIL_WIDTH_PX,
  accountAccentColor,
  accountCardSurfaceStyle,
  accountIconAccentStyle,
  accountRailColor,
  toColorPickerValue,
} from '../account-visuals'

describe('account visuals', () => {
  it('uses persisted color for accents and tinted surfaces', () => {
    expect(accountAccentColor('  #3d6ea8  ')).toBe('#3d6ea8')
    expect(accountAccentColor(null)).toBe('var(--color-accent)')
    expect(accountCardSurfaceStyle(null)).toEqual({})
    expect(accountCardSurfaceStyle('#3d6ea8').backgroundColor).toContain('#3d6ea8')
    expect(accountCardSurfaceStyle('#3d6ea8', true).backgroundColor).toContain('8%')
  })

  it('uses a 3px rail only from a persisted color and does not invent a type color', () => {
    expect(ACCOUNT_RAIL_WIDTH_PX).toBe(3)
    expect(accountRailColor('  #3d6ea8  ')).toBe('#3d6ea8')
    expect(accountRailColor(null)).toBeNull()
    expect(accountRailColor('   ')).toBeNull()
    expect(accountIconAccentStyle(null)).toBeUndefined()
    expect(accountIconAccentStyle('#a15c3a')?.color).toBe('#a15c3a')
    expect(accountIconAccentStyle('#a15c3a')?.backgroundColor).toContain('#a15c3a')
  })

  it('expands short hex for the native color picker without inventing a stored value', () => {
    expect(toColorPickerValue('#abc')).toBe('#aabbcc')
    expect(toColorPickerValue('#3d6ea8')).toBe('#3d6ea8')
    expect(toColorPickerValue(null)).toBe('#3d6ea8')
  })
})
