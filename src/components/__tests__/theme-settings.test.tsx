import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
})
