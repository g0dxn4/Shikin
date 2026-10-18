import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const stored = vi.hoisted(() => new Map<string, unknown>())
const translationOverrides = vi.hoisted(() => new Map<string, string>())
const storageSet = vi.hoisted(() =>
  vi.fn(async (key: string, value: unknown) => {
    stored.set(key, value)
  })
)

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue({
    get: (key: string) => Promise.resolve(stored.get(key) ?? null),
    set: storageSet,
    save: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translationOverrides.get(key) ?? key,
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ThemeSettings } from '../ThemeSettings'
import { APPEARANCE_KEY, THEME_KEY, presetThemes } from '@/lib/theme'

describe('ThemeSettings', () => {
  beforeEach(() => {
    cleanup()
    stored.clear()
    translationOverrides.clear()
    storageSet.mockClear()
    document.documentElement.style.cssText = ''
    document.documentElement.className = ''
    delete document.documentElement.dataset.appearance
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
  })

  it('keeps preset and custom controls behind the advanced disclosure', async () => {
    const user = userEvent.setup()
    render(<ThemeSettings />)

    const saveButton = screen.getByText('theme.save').closest('button')
    expect(saveButton).not.toBeVisible()
    await user.click(screen.getByText('theme.advanced'))
    expect(saveButton).toBeVisible()
    expect(screen.getByLabelText('theme.fields.background')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /theme.presets.paper/ })).not.toHaveLength(0)
  })

  it('switches native appearance without rewriting a seeded custom theme and can reselect it', async () => {
    const user = userEvent.setup()
    const seededTheme = `  ${JSON.stringify(presetThemes.rose)}  `
    stored.set(THEME_KEY, seededTheme)

    const firstRender = render(<ThemeSettings />)
    const custom = screen.getByRole('radio', { name: /theme.custom/ })
    await waitFor(() => expect(custom).toHaveAttribute('aria-checked', 'true'))

    await user.click(screen.getByRole('radio', { name: /theme.nativeLight/ }))
    await waitFor(() => expect(stored.get(APPEARANCE_KEY)).toBe('native-light'))
    expect(stored.get(THEME_KEY)).toBe(seededTheme)
    expect(storageSet).toHaveBeenCalledWith(APPEARANCE_KEY, 'native-light')
    expect(storageSet).not.toHaveBeenCalledWith(THEME_KEY, expect.anything())

    firstRender.unmount()
    render(<ThemeSettings />)
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /theme.nativeLight/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    )

    await user.click(screen.getByRole('radio', { name: /theme.custom/ }))
    await waitFor(() => expect(stored.get(APPEARANCE_KEY)).toBe('custom'))
    expect(stored.get(THEME_KEY)).toBe(seededTheme)
  })

  it('previews saved custom colors without applying or saving the unsaved draft', async () => {
    const user = userEvent.setup()
    stored.set(THEME_KEY, JSON.stringify(presetThemes.rose))
    render(<ThemeSettings />)

    const custom = screen.getByRole('radio', { name: /theme.custom/ })
    await waitFor(() => expect(custom).toHaveAttribute('aria-checked', 'true'))
    const preview = custom.querySelector('[data-appearance-preview="custom"]')
    expect(preview).toHaveAttribute('data-preview-source', 'saved')
    expect(preview).toHaveAttribute('data-saved-background', presetThemes.rose.background)
    expect(preview).toHaveStyle({ backgroundColor: presetThemes.rose.background })
    expect(preview).toHaveAttribute('aria-hidden', 'true')
    expect(preview?.tagName).not.toBe('BUTTON')
    expect(storageSet).not.toHaveBeenCalled()

    const light = screen.getByRole('radio', { name: /theme.nativeLight/ })
    expect(light.querySelector('[data-appearance-preview="native-light"]')).toHaveAttribute(
      'data-preview-source',
      'native'
    )
    expect(light.querySelector('[data-saved-background]')).toBeNull()
    expect(screen.queryByText('theme.nativeLightDescription')).not.toBeInTheDocument()

    await user.click(screen.getByText('theme.advanced'))
    expect(storageSet).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('theme.fields.background'), {
      target: { value: '#123456' },
    })
    expect(screen.getByLabelText('theme.fields.background')).toHaveValue('#123456')
    expect(preview).toHaveAttribute('data-saved-background', presetThemes.rose.background)
    expect(storageSet).not.toHaveBeenCalled()

    await user.click(screen.getByText('theme.save'))
    await waitFor(() => expect(preview).toHaveAttribute('data-saved-background', '#123456'))
    expect(storageSet).toHaveBeenCalledWith(THEME_KEY, expect.stringContaining('#123456'))
    expect(stored.get(APPEARANCE_KEY)).toBe('custom')
  })

  it('keeps native appearance previews on the fixed approved palette', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8')
    const start = css.indexOf('Appearance previews only')
    const end = css.indexOf('.theme-preset {')
    const block = css.slice(start, end)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(block).toContain("[data-appearance-preview='native-light']")
    expect(block).toContain('background: #f5f5f2')
    expect(block).toContain('--preview-sidebar: #eeeeea')
    expect(block).toContain('--preview-action: #6f29ae')
    expect(block).toContain("[data-appearance-preview='native-dark']")
    expect(block).toContain('background: #101010')
    expect(block).toContain('--preview-sidebar: #0c0c0c')
    expect(block).toContain('--preview-card: #181818')
    expect(block).toContain('--preview-action: #9448d8')
    expect(block).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/)
    expect(block).not.toContain('--color-chart-3')
  })

  it('keeps the saved custom label fully wrapped without mid-word squeezing', () => {
    render(<ThemeSettings />)
    const group = screen.getByRole('radiogroup', { name: 'theme.appearance' })
    expect(group.className.split(/\s+/)).toContain('grid-cols-1')
    expect(group.className.split(/\s+/)).toContain('sm:grid-cols-3')
    expect(group.className.split(/\s+/)).not.toContain('grid-cols-3')

    const custom = screen.getByRole('radio', { name: /theme.custom/ })
    expect(custom.className).toContain('max-sm:!flex-row')
    const label = custom.querySelector('[data-appearance-label]')
    expect(label).toHaveTextContent('theme.custom')
    expect(label).toHaveStyle({
      overflowWrap: 'normal',
      wordBreak: 'normal',
      whiteSpace: 'normal',
    })
    expect(label?.className ?? '').not.toMatch(/truncate|ellipsis/)
    expect(custom.innerHTML).not.toContain('text-ellipsis')
    expect(custom.querySelector('.appearance-option-check')).toHaveClass('shrink-0')
  })

  it('does not write preferences or apply a theme on render, open, search, or filter', async () => {
    const user = userEvent.setup()
    stored.set(THEME_KEY, JSON.stringify(presetThemes.paper))
    render(<ThemeSettings />)

    expect(storageSet).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /theme.custom/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    )
    expect(storageSet).not.toHaveBeenCalled()
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
    expect(document.documentElement.dataset.appearance).toBeUndefined()

    await user.click(screen.getByText('theme.advanced'))
    expect(storageSet).not.toHaveBeenCalled()
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('')

    await user.type(screen.getByRole('searchbox', { name: 'theme.searchLabel' }), 'harbor')
    expect(storageSet).not.toHaveBeenCalled()
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')

    await user.click(screen.getByRole('button', { name: 'theme.filters.dark' }))
    expect(screen.getByRole('button', { name: 'theme.filters.dark' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(storageSet).not.toHaveBeenCalled()
    expect(stored.get(THEME_KEY)).toBe(JSON.stringify(presetThemes.paper))
    expect(document.documentElement.dataset.appearance).toBeUndefined()
  })

  it('filters and searches the catalog, including an empty result, without hiding featured picks', async () => {
    const user = userEvent.setup()
    translationOverrides.set('theme.presets.dusk', 'Crepúsculo')
    translationOverrides.set(
      'theme.presetDescriptions.dusk',
      'Violeta nocturna y marca lila pálida'
    )
    render(<ThemeSettings />)
    await user.click(screen.getByText('theme.advanced'))

    const catalog = screen.getByRole('region', { name: 'theme.allPresets' })
    const featured = screen.getByRole('region', { name: 'theme.featured.title' })
    expect(within(catalog).getAllByRole('button')).toHaveLength(40)
    expect(
      within(featured)
        .getAllByRole('button')
        .map((button) => button.getAttribute('data-preset-name'))
    ).toEqual(['paper', 'linen', 'sage'])
    const preview = within(catalog).getAllByRole('button')[0].querySelector('[data-preset-preview]')
    expect(preview).toHaveAttribute('aria-hidden', 'true')
    expect(preview?.textContent ?? '').not.toMatch(/\d/)
    expect(preview?.querySelector('table, img')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'theme.filters.light' }))
    expect(within(catalog).queryByRole('button', { name: /theme.presets.harbor/ })).toBeNull()
    expect(within(catalog).getByRole('button', { name: /theme.presets.linen/ })).toBeVisible()
    expect(within(featured).getByRole('button', { name: /theme.presets.paper/ })).toBeVisible()

    await user.type(screen.getByRole('searchbox', { name: 'theme.searchLabel' }), 'harbor')
    expect(within(catalog).getByRole('status')).toHaveTextContent('theme.emptyResults')
    expect(within(catalog).queryByRole('button')).toBeNull()
    expect(storageSet).not.toHaveBeenCalled()

    await user.clear(screen.getByRole('searchbox', { name: 'theme.searchLabel' }))
    await user.click(screen.getByRole('button', { name: 'theme.filters.dark' }))
    await user.type(screen.getByRole('searchbox', { name: 'theme.searchLabel' }), 'crepusculo')
    expect(within(catalog).getByRole('button', { name: /Crepúsculo/ })).toHaveAttribute(
      'data-preset-name',
      'dusk'
    )
    expect(within(catalog).queryByRole('button', { name: /theme.presets.harbor/ })).toBeNull()
  })

  it('selects a preset from the keyboard as a draft and recognizes it after reload', async () => {
    const user = userEvent.setup()
    stored.set(APPEARANCE_KEY, 'custom')
    stored.set(THEME_KEY, JSON.stringify(presetThemes.harbor))
    render(<ThemeSettings />)

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /theme.custom/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    )
    const savedPreview = screen
      .getByRole('radio', { name: /theme.custom/ })
      .querySelector('[data-appearance-preview="custom"]')
    expect(savedPreview).toHaveAttribute('data-preview-source', 'saved')
    expect(savedPreview).toHaveAttribute('data-saved-background', presetThemes.harbor.background)

    await user.click(screen.getByText('theme.advanced'))
    const catalog = screen.getByRole('region', { name: 'theme.allPresets' })
    const harbor = within(catalog).getByRole('button', { name: /theme.presets.harbor/ })
    await waitFor(() => expect(harbor).toHaveAttribute('aria-pressed', 'true'))
    expect(harbor).not.toHaveAttribute('tabindex', '-1')

    const linen = within(catalog).getByRole('button', { name: /theme.presets.linen/ })
    linen.focus()
    expect(linen).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(linen).toHaveAttribute('aria-pressed', 'true')
    expect(harbor).toHaveAttribute('aria-pressed', 'false')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
      presetThemes.linen.accent
    )
    expect(storageSet).not.toHaveBeenCalled()
    expect(stored.get(THEME_KEY)).toBe(JSON.stringify(presetThemes.harbor))
    expect(savedPreview).toHaveAttribute('data-saved-background', presetThemes.harbor.background)

    await user.click(screen.getByText('theme.save'))
    await waitFor(() =>
      expect(savedPreview).toHaveAttribute('data-saved-background', presetThemes.linen.background)
    )
    expect(storageSet).toHaveBeenCalledWith(THEME_KEY, JSON.stringify(presetThemes.linen))
    expect(stored.get(APPEARANCE_KEY)).toBe('custom')
    expect(screen.getByText('theme.save').closest('button')).toBeEnabled()
  })

  it('reverts an unsaved preset draft and keeps native switching from rewriting custom tokens', async () => {
    const user = userEvent.setup()
    const seeded = JSON.stringify(presetThemes.rose)
    stored.set(THEME_KEY, seeded)
    stored.set(APPEARANCE_KEY, 'custom')
    render(<ThemeSettings />)
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /theme.custom/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    )
    await user.click(screen.getByText('theme.advanced'))
    const catalog = screen.getByRole('region', { name: 'theme.allPresets' })
    await user.click(within(catalog).getByRole('button', { name: /theme.presets.harbor/ }))
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
      presetThemes.harbor.accent
    )
    expect(stored.get(THEME_KEY)).toBe(seeded)

    await user.click(screen.getByText('theme.revert'))
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
        presetThemes.rose.accent
      )
    )
    expect(stored.get(THEME_KEY)).toBe(seeded)
    expect(storageSet).not.toHaveBeenCalled()
    expect(within(catalog).getByRole('button', { name: /theme.presets.rose/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(catalog).getByRole('button', { name: /theme.presets.harbor/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    await user.click(screen.getByRole('radio', { name: /theme.nativeDark/ }))
    await waitFor(() => expect(stored.get(APPEARANCE_KEY)).toBe('native-dark'))
    expect(stored.get(THEME_KEY)).toBe(seeded)
    expect(document.documentElement.dataset.appearance).toBe('native-dark')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
    expect(
      screen
        .getByRole('radio', { name: /theme.nativeDark/ })
        .querySelector('[data-appearance-preview="native-dark"]')
    ).toHaveAttribute('data-preview-source', 'native')
  })

  it('keeps featured picks deterministic for dark system appearance', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    render(<ThemeSettings />)
    await user.click(screen.getByText('theme.advanced'))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'theme.featured.title' }))
          .getAllByRole('button')
          .map((button) => button.getAttribute('data-preset-name'))
      ).toEqual(['nord', 'harbor', 'inkwell'])
    )
    expect(storageSet).not.toHaveBeenCalled()
  })
})
