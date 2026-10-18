import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, ChevronRight, RotateCcw, Save, Undo } from 'lucide-react'
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
  sameThemeTokens,
  saveAppearance,
  saveTheme,
  subscribeAppearance,
  themeTone,
} from '@/lib/theme'

const FEATURED_LIGHT_PRESETS = ['paper', 'linen', 'sage'] as const
const FEATURED_DARK_PRESETS = ['nord', 'harbor', 'inkwell'] as const
const BOLD_PRESETS = new Set<PresetName>([
  'aurora',
  'ember',
  'mono',
  'sunset',
  'ocean',
  'violetGlass',
  'chalk',
  'daybreak',
  'basalt',
  'wine',
  'copper',
  'hearth',
])

export function ThemeSettings() {
  const { t } = useTranslation('settings')
  const [theme, setTheme] = useState<ThemeTokens>(defaultTheme)
  const [savedTheme, setSavedTheme] = useState<ThemeTokens>(defaultTheme)
  const [appearance, setAppearanceState] = useState<Appearance>('native-light')
  const [activeFilter, setActiveFilter] = useState<ThemeFilter>('all')
  const [presetQuery, setPresetQuery] = useState('')
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
    () => (prefersDark ? [...FEATURED_DARK_PRESETS] : [...FEATURED_LIGHT_PRESETS]),
    [prefersDark]
  )
  const catalogNames = (Object.keys(presetThemes) as PresetName[]).filter(
    (name) =>
      matchesThemeFilter(name, activeFilter) &&
      matchesPresetQuery(
        presetQuery,
        t(`theme.presets.${name}`),
        t(`theme.presetDescriptions.${name}`)
      )
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
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        role="radiogroup"
        aria-label={t('theme.appearance')}
      >
        <AppearanceOption
          label={t('theme.nativeLight')}
          variant="native-light"
          selected={appearance === 'native-light'}
          onClick={() => void selectAppearance('native-light')}
        />
        <AppearanceOption
          label={t('theme.nativeDark')}
          variant="native-dark"
          selected={appearance === 'native-dark'}
          onClick={() => void selectAppearance('native-dark')}
        />
        <AppearanceOption
          label={t('theme.custom')}
          variant="custom"
          savedTheme={savedTheme}
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
            list="featured"
          />

          <div className="space-y-2">
            <Label htmlFor="theme-preset-search">{t('theme.searchLabel')}</Label>
            <Input
              id="theme-preset-search"
              type="search"
              value={presetQuery}
              onChange={(event) => setPresetQuery(event.target.value)}
              placeholder={t('theme.searchPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              className="h-11"
            />
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label={t('theme.filtersLabel')}>
            {THEME_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                aria-pressed={activeFilter === filter}
                className="filter-pill focus-visible:ring-ring !min-h-11 px-3 focus-visible:ring-2 focus-visible:outline-none"
              >
                {t(`theme.filters.${filter}`)}
              </button>
            ))}
          </div>

          <PresetPicker
            names={catalogNames}
            theme={theme}
            onSelect={previewCustomTheme}
            label={t('theme.allPresets')}
            emptyLabel={t('theme.emptyResults')}
            list="all"
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
  variant,
  savedTheme,
  selected,
  onClick,
}: {
  label: string
  variant: Appearance
  savedTheme?: ThemeTokens
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="appearance-option max-sm:!flex-row max-sm:!items-center max-sm:gap-3"
    >
      <AppearancePreview variant={variant} savedTheme={savedTheme} />
      <span className="appearance-option-meta min-w-0 flex-1">
        <strong
          data-appearance-label=""
          style={{
            overflowWrap: 'normal',
            wordBreak: 'normal',
            minWidth: 'min-content',
            whiteSpace: 'normal',
          }}
        >
          {label}
        </strong>
        <Check
          aria-hidden="true"
          className="appearance-option-check shrink-0"
          data-hidden={selected ? 'false' : 'true'}
        />
      </span>
    </button>
  )
}

function AppearancePreview({
  variant,
  savedTheme,
}: {
  variant: Appearance
  savedTheme?: ThemeTokens
}) {
  const savedStyle =
    variant === 'custom' && savedTheme
      ? ({
          backgroundColor: savedTheme.background,
          color: savedTheme.foreground,
          borderColor: savedTheme.border,
          borderRadius: savedTheme.radiusMd,
          '--preview-sidebar': savedTheme.surface,
          '--preview-card': savedTheme.surface,
          '--preview-ink': savedTheme.foreground,
          '--preview-muted': savedTheme.mutedForeground,
          '--preview-line': savedTheme.border,
          '--preview-action': savedTheme.accent,
          '--preview-nav': savedTheme.mutedForeground,
          '--preview-nav-active': savedTheme.accent,
        } as React.CSSProperties)
      : undefined

  return (
    <span
      className="appearance-preview max-sm:!h-11 max-sm:w-[4.5rem] max-sm:shrink-0"
      data-appearance-preview={variant}
      data-preview-source={variant === 'custom' ? 'saved' : 'native'}
      data-saved-background={variant === 'custom' ? savedTheme?.background : undefined}
      style={savedStyle}
      aria-hidden="true"
    >
      <span className="appearance-preview-sidebar">
        <span className="appearance-preview-nav" />
        <span className="appearance-preview-nav appearance-preview-nav-active" />
        <span className="appearance-preview-nav" />
      </span>
      <span className="appearance-preview-main">
        <span className="appearance-preview-card">
          <span className="appearance-preview-line" />
          <span className="appearance-preview-line appearance-preview-line-short" />
        </span>
        <span className="appearance-preview-action" />
      </span>
    </span>
  )
}

function ThemeMiniPreview({ tokens }: { tokens: ThemeTokens }) {
  return (
    <span
      className="appearance-preview"
      data-preset-preview=""
      style={
        {
          backgroundColor: tokens.background,
          color: tokens.foreground,
          borderColor: tokens.border,
          borderRadius: tokens.radiusMd,
          width: '4.5rem',
          height: '2.75rem',
          flex: 'none',
          '--preview-sidebar': tokens.surface,
          '--preview-card': tokens.surface,
          '--preview-ink': tokens.foreground,
          '--preview-muted': tokens.mutedForeground,
          '--preview-line': tokens.border,
          '--preview-action': tokens.accent,
          '--preview-nav': tokens.mutedForeground,
          '--preview-nav-active': tokens.accent,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <span className="appearance-preview-sidebar">
        <span className="appearance-preview-nav" />
        <span className="appearance-preview-nav appearance-preview-nav-active" />
        <span className="appearance-preview-nav" />
      </span>
      <span className="appearance-preview-main">
        <span className="appearance-preview-card">
          <span className="appearance-preview-line" />
          <span className="appearance-preview-line appearance-preview-line-short" />
        </span>
        <span className="appearance-preview-action" />
      </span>
    </span>
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
  emptyLabel,
  list,
}: {
  names: readonly PresetName[]
  theme: ThemeTokens
  onSelect: (theme: ThemeTokens) => void
  label: string
  description?: string
  emptyLabel?: string
  list: 'featured' | 'all'
}) {
  const { t } = useTranslation('settings')

  return (
    <section className="space-y-2" aria-label={label} data-preset-list={list}>
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        {description ? <p className="text-muted-foreground mt-1 text-xs">{description}</p> : null}
      </div>
      {names.length === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          {emptyLabel}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {names.map((name) => {
            const preset = presetThemes[name]
            if (!preset) return null
            const selected = sameThemeTokens(preset, theme)
            return (
              <button
                key={name}
                type="button"
                data-preset-name={name}
                onClick={() => onSelect(preset)}
                aria-pressed={selected}
                className="theme-preset focus-visible:ring-ring !min-h-11 w-full !flex-row !items-center gap-3 focus-visible:ring-2 focus-visible:outline-none"
              >
                <ThemeMiniPreview tokens={preset} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t(`theme.presets.${name}`)}</span>
                  <span className="text-muted-foreground block text-xs">
                    {t(`theme.presetDescriptions.${name}`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

function matchesPresetQuery(query: string, label: string, description: string): boolean {
  const needle = normalizeSearch(query)
  if (!needle) return true
  return normalizeSearch(label).includes(needle) || normalizeSearch(description).includes(needle)
}

function matchesThemeFilter(name: PresetName, filter: ThemeFilter): boolean {
  if (filter === 'all') return true
  const preset = presetThemes[name]
  if (filter === 'light') return themeTone(preset) === 'light'
  if (filter === 'dark') return themeTone(preset) === 'dark'
  if (filter === 'editorial') return preset.fontPreset === 'editorial'
  return BOLD_PRESETS.has(name)
}

type PresetName = keyof typeof presetThemes
type ThemeFilter = 'all' | 'dark' | 'light' | 'editorial' | 'bold'
const THEME_FILTERS: readonly ThemeFilter[] = ['all', 'dark', 'light', 'editorial', 'bold']
