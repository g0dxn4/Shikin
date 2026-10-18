import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const stored = vi.hoisted(() => new Map<string, unknown>())
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
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ThemeSettings } from '../ThemeSettings'
import { APPEARANCE_KEY, THEME_KEY, presetThemes } from '@/lib/theme'

describe('ThemeSettings', () => {
  beforeEach(() => {
    cleanup()
    stored.clear()
    storageSet.mockClear()
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
})
