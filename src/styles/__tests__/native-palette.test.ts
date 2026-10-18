import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'

const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8')
const themeSource = readFileSync(resolve(process.cwd(), 'src/lib/theme.ts'), 'utf8')
const buttonSource = readFileSync(resolve(process.cwd(), 'src/components/ui/button.tsx'), 'utf8')
const LEGACY_CUSTOM_CHART_3 = '#8eb7ed'

function block(source: string, header: string): string {
  const start = source.indexOf(header)
  expect(start, header).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error(`unclosed block: ${header}`)
}

function colors(blockText: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const match of blockText.matchAll(/--(color-[\w-]+):\s*([^;]+);/g)) {
    parsed[match[1]] = match[2].trim().toLowerCase()
  }
  return parsed
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

function channels(hex: string): [number, number, number] {
  const normalized = hex.toLowerCase()
  expect(normalized).toMatch(/^#[0-9a-f]{6}$/)
  return [channel(normalized, 1), channel(normalized, 3), channel(normalized, 5)]
}

function linear(value: number): number {
  const channelValue = value / 255
  return channelValue <= 0.04045 ? channelValue / 12.92 : ((channelValue + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex)
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function themeColor(header: string, field: string): string {
  const match = block(themeSource, header).match(
    new RegExp(`^\\s*${field}:\\s*'(#[0-9a-fA-F]{6})'`, 'm')
  )
  expect(match, `${header} ${field}`).not.toBeNull()
  return match![1].toLowerCase()
}

function composite(foreground: string, background: string, amount: number): string {
  const [frontRed, frontGreen, frontBlue] = channels(foreground)
  const [backRed, backGreen, backBlue] = channels(background)
  const mix = (front: number, back: number) => Math.round(front * amount + back * (1 - amount))
  const mixed = [mix(frontRed, backRed), mix(frontGreen, backGreen), mix(frontBlue, backBlue)]
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [red, green, blue] = channels(hex).map((value) => value / 255) as [number, number, number]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta === 0) return { hue: 0, saturation: 0 }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const hue =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4
  return { hue: (hue * 60 + 360) % 360, saturation }
}

const light = colors(block(css, '@theme {'))
const dark = colors(block(css, "html[data-appearance='native-dark']"))
const custom = block(css, "html[data-appearance='custom']")

const lightSurfaces = ['#f5f5f2', '#ffffff', '#eeeeea', '#f0f0ed', '#deded8']
const darkSurfaces = ['#101010', '#181818', '#1e1e1e', '#0c0c0c', '#262626']

describe('native ink violet palette', () => {
  it('keeps native light surfaces and replaces blue selection with neutral chips', () => {
    expect(light['color-background']).toBe('#f5f5f2')
    expect(light['color-sidebar']).toBe('#eeeeea')
    expect(light['color-surface']).toBe('#ffffff')
    expect(light['color-surface-elevated']).toBe('#ffffff')
    expect(light['color-card']).toBe('#ffffff')
    expect(light['color-popover']).toBe('#ffffff')
    expect(light['color-foreground']).toBe('#202124')
    expect(light['color-muted']).toBe('#f0f0ed')
    expect(light['color-secondary']).toBe('#f0f0ed')
    expect(light['color-border']).toBe('#deded8')
    expect(light['color-input']).toBe('#deded8')
    expect(light['color-accent-muted']).toBe('#deded8')
    expect(light['color-sidebar-accent']).toBe('#ffffff')
    expect(light['color-accent-muted']).not.toBe('#e9f1fc')
    expect(light['color-sidebar-accent']).not.toBe('#e9f1fc')
  })

  it('uses the authoritative equal-channel dark surfaces', () => {
    expect(dark['color-background']).toBe('#101010')
    expect(dark['color-sidebar']).toBe('#0c0c0c')
    expect(dark['color-surface']).toBe('#181818')
    expect(dark['color-card']).toBe('#181818')
    expect(dark['color-surface-elevated']).toBe('#1e1e1e')
    expect(dark['color-popover']).toBe('#1e1e1e')
    expect(dark['color-glass']).toBe('#181818')
    expect(dark['color-border']).toBe('#3a3a3a')
    expect(dark['color-sidebar-border']).toBe('#3a3a3a')
    expect(dark['color-input']).toBe('#6e6e6e')
    expect(dark['color-border-hover']).toBe('#6e6e6e')
    expect(dark['color-muted']).toBe('#262626')
    expect(dark['color-secondary']).toBe('#262626')
    expect(dark['color-accent-muted']).toBe('#262626')
    expect(dark['color-sidebar-accent']).toBe('#262626')
    expect(dark['color-foreground']).toBe('#f4f2ec')
    expect(dark['color-muted-foreground']).toBe('#a7a8ad')

    for (const token of [
      'color-background',
      'color-sidebar',
      'color-surface',
      'color-card',
      'color-surface-elevated',
      'color-popover',
      'color-border',
      'color-input',
      'color-muted',
    ]) {
      const [red, green, blue] = channels(dark[token])
      expect(red, token).toBe(green)
      expect(green, token).toBe(blue)
    }
  })

  it('keeps primary and accent as distinct tokens with researched contrast', () => {
    expect(light['color-primary']).toBe('#6f29ae')
    expect(light['color-accent']).toBe('#6f29ae')
    expect(light['color-primary']).not.toContain('var(')
    expect(light['color-accent']).not.toContain('var(')
    expect(light['color-primary-foreground']).toBe('#ffffff')
    expect(light['color-ring']).toBe('#6f29ae')
    expect(light['color-accent-hover']).toBe('#591f8a')

    expect(dark['color-primary']).toBe('#9448d8')
    expect(dark['color-accent']).toBe('#c4a0e3')
    expect(dark['color-primary']).not.toBe(dark['color-accent'])
    expect(dark['color-primary-foreground']).toBe('#ffffff')
    expect(dark['color-ring']).toBe('#c4a0e3')
    expect(dark['color-accent-hover']).toBe('#d4b8ec')
    expect(dark['color-accent-foreground']).toBe('#101010')

    expect(contrast(dark['color-primary'], dark['color-primary-foreground'])).toBeCloseTo(5.03, 2)
    expect(
      contrast(dark['color-primary'], dark['color-primary-foreground'])
    ).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark['color-accent'], dark['color-card'])).toBeCloseTo(8.02, 2)
    expect(contrast(dark['color-accent'], dark['color-card'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark['color-primary'], dark['color-card'])).toBeLessThan(4.5)
    expect(contrast(light['color-primary'], '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light['color-accent'], light['color-background'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light['color-accent'], light['color-sidebar'])).toBeGreaterThanOrEqual(4.5)
  })

  it('gives accent fills a contrasting foreground, including dark text on pale violet', () => {
    expect(contrast(dark['color-accent-foreground'], dark['color-accent'])).toBeGreaterThanOrEqual(
      4.5
    )
    expect(luminance(dark['color-accent-foreground'])).toBeLessThan(luminance(dark['color-accent']))
    expect(
      contrast(light['color-accent-foreground'], light['color-accent'])
    ).toBeGreaterThanOrEqual(4.5)
    expect(luminance(light['color-accent-foreground'])).toBeGreaterThan(
      luminance(light['color-accent'])
    )
    expect(contrast(dark['color-accent'], dark['color-accent-muted'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light['color-accent'], light['color-accent-muted'])).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(dark['color-sidebar-accent-foreground'], dark['color-sidebar-accent'])
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(light['color-sidebar-accent-foreground'], light['color-sidebar-accent'])
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps native text pairs at least AA on canvas, card, and selected surfaces', () => {
    for (const surface of lightSurfaces) {
      expect(contrast(light['color-foreground'], surface), surface).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light['color-accent'], surface), surface).toBeGreaterThanOrEqual(4.5)
    }
    for (const surface of darkSurfaces) {
      expect(contrast(dark['color-foreground'], surface), surface).toBeGreaterThanOrEqual(4.5)
      expect(contrast(dark['color-accent'], surface), surface).toBeGreaterThanOrEqual(4.5)
      expect(contrast(dark['color-muted-foreground'], surface), surface).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(dark['color-accent-hover'], dark['color-card'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light['color-accent-hover'], light['color-background'])).toBeGreaterThanOrEqual(
      4.5
    )
  })

  it('preserves status colors and uses neutral, legible chart series', () => {
    expect(light['color-success']).toBe('#18783c')
    expect(light['color-warning']).toBe('#a96108')
    expect(light['color-destructive']).toBe('#c43b3b')
    expect(light['color-income']).toBe('#18783c')
    expect(light['color-expense']).toBe('#c43b3b')
    expect(dark['color-success']).toBe('#4dcc78')
    expect(dark['color-warning']).toBe('#e9a84d')
    expect(dark['color-destructive']).toBe('#f07474')
    expect(dark['color-success-foreground']).toBe('#101113')
    expect(dark['color-warning-foreground']).toBe('#101113')
    expect(dark['color-destructive-foreground']).toBe('#18191b')

    expect(light['color-chart-1']).toBe('#3b362b')
    expect(light['color-chart-2']).toBe('#18783c')
    expect(light['color-chart-3']).toBe('#44525f')
    expect(light['color-chart-4']).toBe('#a96108')
    expect(light['color-chart-5']).toBe('#c43b3b')
    expect(dark['color-chart-1']).toBe('#e6e1d6')
    expect(dark['color-chart-2']).toBe('#4dcc78')
    expect(dark['color-chart-3']).toBe('#a9b7c4')
    expect(dark['color-chart-4']).toBe('#e9a84d')
    expect(dark['color-chart-5']).toBe('#f07474')

    for (const hex of [
      light['color-chart-1'],
      light['color-chart-3'],
      dark['color-chart-1'],
      dark['color-chart-3'],
    ]) {
      const { hue, saturation } = hueAndSaturation(hex)
      expect(hue < 250 || hue > 330, hex).toBe(true)
      expect(saturation, hex).toBeLessThan(0.3)
      expect(hex).not.toBe(light['color-primary'])
      expect(hex).not.toBe(dark['color-primary'])
      expect(hex).not.toBe(dark['color-accent'])
    }
    expect(hueAndSaturation(light['color-chart-1']).hue).toBeLessThan(60)
    expect(hueAndSaturation(dark['color-chart-1']).hue).toBeLessThan(60)
    expect(hueAndSaturation(light['color-chart-3']).hue).toBeGreaterThan(190)
    expect(hueAndSaturation(light['color-chart-3']).hue).toBeLessThan(230)
    expect(hueAndSaturation(dark['color-chart-3']).hue).toBeGreaterThan(190)
    expect(hueAndSaturation(dark['color-chart-3']).hue).toBeLessThan(230)

    for (const surface of ['#ffffff', '#f5f5f2']) {
      expect(contrast(light['color-chart-1'], surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light['color-chart-3'], surface)).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(dark['color-chart-1'], dark['color-card'])).toBeGreaterThanOrEqual(3)
    expect(contrast(dark['color-chart-3'], dark['color-card'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light['color-chart-1'], light['color-chart-3'])).toBeGreaterThan(1.3)
    expect(contrast(dark['color-chart-1'], dark['color-chart-3'])).toBeGreaterThan(1.3)
  })

  it('does not tint the canvas or add decorative gradients and font downloads', () => {
    expect(css).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/)
    expect(block(css, 'body {')).toContain('background: var(--color-background)')
    expect(css).not.toContain('box-shadow: 0 0 24px')
    expect(dark['color-background']).not.toBe(dark['color-primary'])
    expect(dark['color-background']).not.toBe(dark['color-accent'])

    const fontUrls = [...css.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1])
    expect(fontUrls).toEqual([
      '/fonts/SpaceGrotesk-Variable.ttf',
      '/fonts/Outfit-Variable.ttf',
      '/fonts/SpaceMono-Regular.ttf',
    ])
  })

  it('leaves category colors and custom appearance fallbacks untouched', () => {
    expect(light['color-cat-food']).toBe('#f97316')
    expect(light['color-cat-transport']).toBe('#3b82f6')
    expect(light['color-cat-housing']).toBe('#8b5cf6')
    expect(light['color-cat-entertainment']).toBe('#ec4899')
    expect(light['color-cat-health']).toBe('#ef4444')
    expect(light['color-cat-shopping']).toBe('#f59e0b')
    expect(light['color-cat-education']).toBe('#06b6d4')
    expect(light['color-cat-income']).toBe('#34d399')
    expect(light['color-cat-investments']).toBe('#7c5cff')
    expect(light['color-cat-savings']).toBe('#2563eb')
    expect(dark['color-cat-food']).toBeUndefined()
    expect(dark['color-cat-investments']).toBeUndefined()

    expect(custom).toContain('--color-card: var(--color-surface)')
    expect(custom).toContain('--color-card-foreground: var(--color-foreground)')
    expect(custom).toContain('--color-popover: var(--color-surface-elevated)')
    expect(custom).toContain('--color-sidebar: var(--color-surface)')
    expect(custom).toContain('--color-sidebar-accent: var(--color-accent-muted)')
    expect(custom).toContain('--color-sidebar-accent-foreground: var(--color-accent)')
    expect(custom).toContain('--color-chart-grid: var(--color-border)')
    expect(custom).toContain('--color-chart-axis: var(--color-muted-foreground)')
    expect(css).toContain('Saved legacy themes keep their custom token and typography behavior.')
  })

  it('keeps legacy custom chart-3 legible without changing native series', () => {
    const customColors = colors(custom)
    const declarations = [...css.matchAll(/--color-chart-3:\s*([^;]+);/g)].map((match) =>
      match[1].trim().toLowerCase()
    )
    const midnightSurface = themeColor('midnight: {', 'surface')
    const midnightBackground = themeColor('midnight: {', 'background')
    const midnightForeground = themeColor('midnight: {', 'foreground')
    const defaultSurface = themeColor('export const defaultTheme: ThemeTokens = {', 'surface')
    const defaultBackground = themeColor('export const defaultTheme: ThemeTokens = {', 'background')
    const defaultForeground = themeColor('export const defaultTheme: ThemeTokens = {', 'foreground')

    expect(light['color-chart-3']).toBe('#44525f')
    expect(dark['color-chart-3']).toBe('#a9b7c4')
    expect(declarations).toEqual(['#44525f', '#a9b7c4', LEGACY_CUSTOM_CHART_3])
    expect(customColors['color-chart-3']).toBe(LEGACY_CUSTOM_CHART_3)
    expect(customColors['color-chart-1']).toBeUndefined()
    expect(custom).not.toMatch(/--color-(?:accent|background|foreground|surface)\s*:/)
    expect(custom).not.toMatch(/--font-/)
    expect(themeSource).toContain("root.style.setProperty('--color-chart-1', theme.accent)")
    expect(themeSource).not.toMatch(/setProperty\(\s*'--color-chart-3'/)

    const legacy = customColors['color-chart-3']
    // Snowball chip uses bg-muted: 7% foreground mixed over the surface.
    expect(contrast(legacy, midnightSurface)).toBeCloseTo(7.07, 2)
    expect(contrast(legacy, midnightSurface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(legacy, midnightBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(legacy, defaultSurface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(legacy, defaultBackground)).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(legacy, composite(midnightForeground, midnightSurface, 0.07))
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(legacy, composite(defaultForeground, defaultSurface, 0.07))
    ).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light['color-chart-3'], midnightSurface)).toBeCloseTo(1.82, 2)
    expect(contrast(light['color-chart-3'], midnightSurface)).toBeLessThan(4.5)
    expect(contrast(light['color-chart-3'], defaultSurface)).toBeLessThan(4.5)
  })

  it('styles link buttons with accent text instead of the low-contrast primary fill', () => {
    expect(buttonSource).toContain("link: 'text-accent underline-offset-4 hover:underline'")
    expect(buttonSource).not.toContain("link: 'text-primary")

    render(createElement(Button, { variant: 'link' }, 'View ledger'))
    const link = screen.getByRole('button', { name: 'View ledger' })
    expect(link.className).toContain('text-accent')
    expect(link.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/)
  })
})
