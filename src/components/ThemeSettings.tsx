import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronRight, Moon, Palette, RotateCcw, Save, Sun, Undo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Appearance, ThemeTokens } from '@/lib/theme'
import {
  applyAppearance,
  applyTheme,
  defaultTheme,
  loadAppearancePreference,
  loadSavedTheme,
  presetThemes,
  saveAppearance,
  saveTheme,
  subscribeAppearance,
} from '@/lib/theme'

export function ThemeSettings() {
  const { t } = useTranslation('settings')
  const [theme, setTheme] = useState<ThemeTokens>(defaultTheme)
  const [savedTheme, setSavedTheme] = useState<ThemeTokens>(defaultTheme)
  const [appearance, setAppearanceState] = useState<Appearance>('native-light')
  const [activeFilter, setActiveFilter] = useState<ThemeFilter>('all')
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    void loadAppearancePreference().then((preference) => {
      setTheme(preference.customTheme)
      setSavedTheme(preference.customTheme)
      setAppearanceState(preference.appearance)
    })
  }, [])

  useEffect(() => subscribeAppearance(setAppearanceState), [])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const onChange = () => setPrefersDark(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const featuredPresetNames = useMemo<PresetName[]>(
    () => (prefersDark ? ['nord', 'aurora', 'mono'] : ['paper', 'latte', 'rose']),
    [prefersDark]
  )

  const selectAppearance = async (nextAppearance: Appearance) => {
    await saveAppearance(nextAppearance)
    setAppearanceState(nextAppearance)
    applyAppearance({ appearance: nextAppearance, customTheme: savedTheme })
  }

  const previewCustomTheme = (nextTheme: ThemeTokens) => {
    setTheme(nextTheme)
    setAppearanceState('custom')
    applyTheme(nextTheme)
  }

  const handleSave = async () => {
    await saveTheme(theme)
    await saveAppearance('custom')
    setSavedTheme(theme)
    setAppearanceState('custom')
    applyTheme(theme)
    toast.success(t('theme.saveSuccess'))
  }

  const handleReset = async () => {
    setTheme(defaultTheme)
    setSavedTheme(defaultTheme)
    await saveTheme(defaultTheme)
    await saveAppearance('custom')
    setAppearanceState('custom')
    applyTheme(defaultTheme)
    toast.success(t('theme.resetSuccess'))
  }

  const handleRevert = async () => {
    const saved = await loadSavedTheme()
    setTheme(saved)
    setSavedTheme(saved)
    setAppearanceState('custom')
    applyTheme(saved)
    toast.success(t('theme.revertSuccess'))
  }

  return (
    <div className="space-y-4">
      <div
        className="grid gap-2 sm:grid-cols-3"
        role="radiogroup"
        aria-label={t('theme.appearance')}
      >
        <AppearanceOption
          label={t('theme.nativeLight')}
          description={t('theme.nativeLightDescription')}
          icon={<Sun aria-hidden="true" />}
          selected={appearance === 'native-light'}
          onClick={() => void selectAppearance('native-light')}
        />
        <AppearanceOption
          label={t('theme.nativeDark')}
          description={t('theme.nativeDarkDescription')}
          icon={<Moon aria-hidden="true" />}
          selected={appearance === 'native-dark'}
          onClick={() => void selectAppearance('native-dark')}
        />
        <AppearanceOption
          label={t('theme.custom')}
          description={t('theme.customDescription')}
          icon={<Palette aria-hidden="true" />}
          selected={appearance === 'custom'}
          onClick={() => void selectAppearance('custom')}
        />
      </div>

      <details className="native-disclosure group">
        <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-1 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
          <ChevronRight
            size={16}
            className="text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
          {t('theme.advanced')}
        </summary>
        <div className="border-border mt-2 space-y-5 border-t pt-5">
          <PresetPicker
            names={featuredPresetNames}
            theme={theme}
            onSelect={previewCustomTheme}
            label={t('theme.featured.title')}
            description={t('theme.featured.description')}
          />

          <div className="flex flex-wrap gap-2" role="group" aria-label={t('theme.filtersLabel')}>
            {THEME_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                aria-pressed={activeFilter === filter}
                className="filter-pill"
              >
                {t(`theme.filters.${filter}`)}
              </button>
            ))}
          </div>

          <PresetPicker
            names={(Object.keys(presetThemes) as PresetName[]).filter((name) =>
              activeFilter === 'all'
                ? true
                : (PRESET_FILTER_BY_NAME[name] ?? []).includes(activeFilter)
            )}
            theme={theme}
            onSelect={previewCustomTheme}
            label={t('theme.allPresets')}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <ColorField
              id="theme-background"
              label={t('theme.fields.background')}
              value={theme.background}
              onChange={(background) => previewCustomTheme({ ...theme, background })}
            />
            <ColorField
              id="theme-surface"
              label={t('theme.fields.surface')}
              value={theme.surface}
              onChange={(surface) => previewCustomTheme({ ...theme, surface })}
            />
            <ColorField
              id="theme-accent"
              label={t('theme.fields.accent')}
              value={theme.accent}
              onChange={(accent) => previewCustomTheme({ ...theme, accent })}
            />
            <div className="space-y-2">
              <Label htmlFor="theme-radius">{t('theme.fields.radius')}</Label>
              <select
                id="theme-radius"
                className="native-select w-full"
                value={theme.radiusMd}
                onChange={(event) => previewCustomTheme({ ...theme, radiusMd: event.target.value })}
              >
                <option value="0px">{t('theme.options.radius.brutalist')}</option>
                <option value="8px">{t('theme.options.radius.subtle')}</option>
                <option value="12px">{t('theme.options.radius.rounded')}</option>
                <option value="16px">{t('theme.options.radius.pill')}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="theme-font-preset">{t('theme.fields.fontPreset')}</Label>
              <select
                id="theme-font-preset"
                className="native-select w-full"
                value={theme.fontPreset}
                onChange={(event) =>
                  previewCustomTheme({
                    ...theme,
                    fontPreset: event.target.value as ThemeTokens['fontPreset'],
                  })
                }
              >
                <option value="current">{t('theme.options.font.current')}</option>
                <option value="modern">{t('theme.options.font.modern')}</option>
                <option value="editorial">{t('theme.options.font.editorial')}</option>
              </select>
            </div>
          </div>

          <div className="border-border flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button variant="ghost" onClick={() => void handleReset()}>
              <RotateCcw />
              {t('theme.reset')}
            </Button>
            <Button variant="outline" onClick={() => void handleRevert()}>
              <Undo />
              {t('theme.revert')}
            </Button>
            <Button onClick={() => void handleSave()}>
              <Save />
              {t('theme.save')}
            </Button>
          </div>
        </div>
      </details>
    </div>
  )
}

function AppearanceOption({
  label,
  description,
  icon,
  selected,
  onClick,
}: {
  label: string
  description: string
  icon: React.ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="appearance-option"
    >
      <span className="appearance-option-icon">{icon}</span>
      <span className="min-w-0 text-left">
        <strong className="block text-sm font-semibold">{label}</strong>
        <span className="text-muted-foreground mt-0.5 block text-xs">{description}</span>
      </span>
    </button>
  )
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-12 p-1"
        />
        <Input value={value} readOnly className="flex-1" aria-label={`${label} value`} />
      </div>
    </div>
  )
}

function PresetPicker({
  names,
  theme,
  onSelect,
  label,
  description,
}: {
  names: PresetName[]
  theme: ThemeTokens
  onSelect: (theme: ThemeTokens) => void
  label: string
  description?: string
}) {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        {description ? <p className="text-muted-foreground mt-1 text-xs">{description}</p> : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {names.map((name) => {
          const preset = presetThemes[name]
          if (!preset) return null
          const selected = preset === theme
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(preset)}
              aria-pressed={selected}
              className="theme-preset"
            >
              <span className="font-medium">{t(`theme.presets.${name}`)}</span>
              <span className="text-muted-foreground text-xs">
                {t(`theme.presetDescriptions.${name}`)}
              </span>
              <span className="flex gap-1" aria-hidden="true">
                {[preset.background, preset.surface, preset.accent].map((color) => (
                  <span
                    key={color}
                    className="border-border size-4 rounded-full border"
                    style={{ background: color }}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

type PresetName = keyof typeof presetThemes
type ThemeFilter = 'all' | 'dark' | 'light' | 'editorial' | 'bold'
const THEME_FILTERS: readonly ThemeFilter[] = ['all', 'dark', 'light', 'editorial', 'bold']
const PRESET_FILTER_BY_NAME: Record<PresetName, ThemeFilter[]> = {
  default: ['dark'],
  midnight: ['dark'],
  forest: ['dark'],
  rose: ['light', 'editorial'],
  aurora: ['dark', 'bold'],
  ember: ['dark', 'bold'],
  slate: ['dark'],
  paper: ['light', 'editorial'],
  nord: ['dark'],
  mono: ['dark', 'bold'],
  sunset: ['dark', 'bold', 'editorial'],
  ocean: ['dark', 'bold'],
  matcha: ['dark'],
  terracotta: ['dark', 'editorial'],
  violetGlass: ['dark', 'bold'],
  latte: ['light', 'editorial'],
}
